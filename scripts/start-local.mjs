import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { readSecret } from './read-secret.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const children = new Set();
const cancellation = new AbortController();
let stopping = false;

function launch(command, args, label, service = false) {
  if (stopping) throw new Error('启动已取消。');
  const child = spawn(command, args, {
    cwd: root, env: process.env, stdio: ['ignore', 'inherit', 'inherit'], detached: true,
  });
  const entry = { child, label };
  children.add(entry);
  entry.exited = new Promise(resolve => {
    child.once('error', () => resolve(1));
    child.once('exit', code => resolve(code ?? 1));
  }).then(code => {
    if (service && !stopping) {
      console.error(`${label}意外退出（${code}），正在停止本次启动的其他服务。`);
      void shutdown(code || 1);
    }
    return code;
  });
  return entry;
}

function signalGroup(entry, signal) {
  if (!entry.child.pid) return;
  try { process.kill(-entry.child.pid, signal); }
  catch (error) { if (error.code !== 'ESRCH') console.error(`无法停止${entry.label}。`); }
}

async function shutdown(code) {
  if (stopping) return;
  stopping = true;
  cancellation.abort();
  const owned = [...children];
  for (const entry of owned) signalGroup(entry, 'SIGTERM');
  await Promise.race([Promise.all(owned.map(entry => entry.exited)), delay(5000)]);
  // Also signal descendants if a group leader exited before its children.
  for (const entry of owned) signalGroup(entry, 'SIGKILL');
  process.exit(code);
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => { console.log('\n正在停止本次启动的服务……'); void shutdown(0); });
}

async function run(command, args, label) {
  const entry = launch(command, args, label);
  const code = await entry.exited;
  if (code !== 0) throw new Error(`${label}失败（${code}），请查看上方输出后重试。`);
  children.delete(entry);
}

async function installDependencies() {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const version = manifest.packageManager.replace(/^pnpm@/, '');
  const installed = spawnSync('pnpm', ['--version'], { encoding: 'utf8', timeout: 15_000 });
  let command = 'pnpm', prefix = [];
  if (installed.status !== 0 || installed.stdout.trim() !== version) {
    if (spawnSync('npm', ['--version'], { stdio: 'ignore', timeout: 15_000 }).status !== 0) {
      throw new Error(`需要 pnpm ${version} 或随 Node.js 安装的 npm，请安装后重试。`);
    }
    console.log(`将通过 npm 临时运行 pnpm ${version}。`);
    command = 'npm';
    prefix = ['exec', '--yes', `--package=pnpm@${version}`, '--', 'pnpm'];
  }
  const hash = createHash('sha256');
  for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
    hash.update(readFileSync(join(root, name)));
  }
  const fingerprint = hash.digest('hex');
  const marker = join(root, '.data/launcher/dependencies.sha256');
  const ready = existsSync(join(root, 'node_modules/next/package.json'))
    && existsSync(join(root, 'node_modules/@next/env/package.json'))
    && existsSync(marker) && readFileSync(marker, 'utf8').trim() === fingerprint;
  if (ready) return;
  console.log('检查并安装项目依赖……');
  await run(command, [...prefix, 'install', '--frozen-lockfile'], '项目依赖安装');
  mkdirSync(join(root, '.data/launcher'), { recursive: true });
  writeFileSync(marker, `${fingerprint}\n`);
}

function portNumber(value, label) {
  if (!/^\d+$/.test(value) || +value < 1 || +value > 65535) throw new Error(`${label}须为 1–65535 的端口号。`);
  return +value;
}

async function assertPortFree(port, label) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`${label}端口 ${port} 已被占用。${label === '网页' ? '请关闭已有网页服务，或使用 PORT=3001 ./start.sh 指定其他空闲端口。' : '请关闭占用程序，或在 .env.local 中修改对应 BASE_URL 的端口。'}`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

function localEndpoint(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`请检查 ${label}_BASE_URL。`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`请检查 ${label}_BASE_URL：需要无凭据的 HTTP(S) 服务地址。`);
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (label === 'STT' && !loopback) throw new Error('本地 STT 需要本机地址；外部识别请显式设置 STT_PROVIDER=external。');
  if (!loopback || url.protocol !== 'http:' || !/^\/v1\/?$/.test(url.pathname) || url.hostname === '[::1]') {
    console.log(`${label} 使用自定义服务，请确保该服务已启动。`);
    return null;
  }
  const port = portNumber(url.port || '80', label);
  // The Python services bind IPv4. Avoid a localhost -> ::1 resolution mismatch.
  process.env[`${label}_BASE_URL`] = `http://127.0.0.1:${port}/v1`;
  return { port, health: `http://127.0.0.1:${port}/health` };
}

async function healthy(url, model) {
  try {
    const response = await fetch(url, { signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(2000)]) });
    if (!response.ok) { await response.body?.cancel(); return false; }
    const body = await response.json();
    return model ? body.status === 'ok' && body.model === model : typeof body.configured === 'boolean' && 'game' in body;
  } catch { return false; }
}

async function waitReady(url, model, label) {
  const deadline = Date.now() + 180_000;
  while (!cancellation.signal.aborted && Date.now() < deadline) {
    if (await healthy(url, model)) return;
    await delay(500, undefined, { signal: cancellation.signal });
  }
  throw new Error(`${label}在 180 秒内未就绪，请查看上方输出。`);
}

function pythonForSetup() {
  const candidates = process.env.PYTHON_BIN ? [process.env.PYTHON_BIN] : ['python3', 'python3.14', 'python3.13', 'python3.12', 'python'];
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)'], { stdio: 'ignore', timeout: 5000 });
    if (result.status === 0) return candidate;
  }
  throw new Error('首次安装本地语音需要 Python 3.12+。请安装后重试，或通过 PYTHON_BIN 指定解释器路径。');
}

const audio = {
  tts: {
    label: '本地配音', model: 'kokoro-v1.1-zh', directory: 'kokoro-int8-multi-lang-v1_1',
    sha256: 'a1e94694776049035c4f2c6529f003aaece993c76aae9a78995831c3c4dcafc6',
    files: ['model.int8.onnx', 'voices.bin', 'tokens.txt', 'lexicon-zh.txt', 'lexicon-us-en.txt', 'phone-zh.fst', 'date-zh.fst', 'number-zh.fst'],
  },
  stt: {
    label: '本地识别', model: 'sensevoice-small-int8', directory: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17',
    sha256: '7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e',
    files: ['model.int8.onnx', 'tokens.txt', 'test_wavs/zh.wav'],
  },
};

async function startAudio(kind, endpoint) {
  if (!endpoint) return;
  const config = audio[kind];
  const model = process.env[`${kind.toUpperCase()}_MODEL`]?.trim() || config.model;
  if (await healthy(endpoint.health, model)) {
    console.log(`${config.label}已就绪，复用现有服务（端口 ${endpoint.port}）。`);
    return;
  }
  await assertPortFree(endpoint.port, config.label);
  if (model !== config.model) throw new Error(`${kind.toUpperCase()}_MODEL 与内置模型不符，请先启动自定义服务或恢复默认模型配置。`);
  const data = join(root, '.data', kind);
  const python = join(data, 'venv/bin/python');
  const directory = join(data, config.directory);
  const marker = join(directory, '.verified-sha256');
  const installed = existsSync(python) && existsSync(marker)
    && readFileSync(marker, 'utf8').trim() === config.sha256
    && config.files.every(name => existsSync(join(directory, name)))
    && spawnSync(python, ['-c', 'import sherpa_onnx, numpy'], { stdio: 'ignore', timeout: 15_000 }).status === 0;
  if (!installed) {
    console.log(`首次安装或修复${config.label}（需要联网下载模型，请稍候）……`);
    await run(pythonForSetup(), [join(root, `scripts/setup-local-${kind}.py`)], `${config.label}安装`);
  }
  console.log(`正在启动${config.label}（端口 ${endpoint.port}）……`);
  launch(python, ['-u', join(root, `services/local-${kind}/server.py`), '--port', String(endpoint.port)], config.label, true);
  await waitReady(endpoint.health, model, config.label);
}

function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(command, [url], { stdio: 'ignore' });
  child.on('error', () => console.log(`请手动打开 ${url}`));
  child.on('exit', code => { if (code) console.log(`请手动打开 ${url}`); });
  child.unref();
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--help') || args.has('-h')) {
    console.log('用法：./start.sh [--no-browser] [--no-prompt]\n自动安装依赖/模型，启动网页和本地语音。\nPORT=3001 可更改网页端口；PYTHON_BIN 可指定 Python 3.12+。\n--no-browser 不自动打开浏览器；--no-prompt 不交互询问 API Key。\n按 Ctrl+C 停止本次启动的服务。');
    return;
  }
  for (const arg of args) if (!['--no-browser', '--no-prompt'].includes(arg)) throw new Error(`未知参数：${arg}。使用 --help 查看用法。`);
  if (+process.versions.node.split('.')[0] < 22) throw new Error('需要 Node.js 22+，请升级后重试。');
  if (process.platform === 'win32') throw new Error('请在 macOS、Linux 或 Windows WSL 中运行 ./start.sh。');
  console.log('月下疑局 · 一键启动');
  await installDependencies();
  const { loadEnvConfig } = require('@next/env');
  loadEnvConfig(root, true);
  const port = portNumber(process.env.PORT || '3000', 'PORT');
  await assertPortFree(port, '网页');
  const provider = process.env.STT_PROVIDER?.trim() || 'local';
  if (!['local', 'zhipu', 'external'].includes(provider)) throw new Error('STT_PROVIDER 须为 local、zhipu 或 external。');
  const tts = localEndpoint(process.env.TTS_BASE_URL?.trim() || 'http://127.0.0.1:8880/v1', 'TTS');
  const stt = provider === 'local' ? localEndpoint(process.env.STT_BASE_URL?.trim() || 'http://127.0.0.1:8881/v1', 'STT') : null;
  const ports = [port, tts?.port, stt?.port].filter(value => value !== undefined);
  if (new Set(ports).size !== ports.length) throw new Error('网页、TTS、STT 需要使用不同端口，请检查 PORT 和 BASE_URL 配置。');
  const key = process.env.ZHIPU_API_KEY?.trim();
  if (!key || /^your_|placeholder|example/i.test(key)) {
    delete process.env.ZHIPU_API_KEY;
    if (process.stdin.isTTY && !args.has('--no-prompt')) {
      process.env.ZHIPU_API_KEY = await readSecret({ allowEmpty: true, prompt: '请输入智谱 API Key（隐藏输入，直接回车跳过）：' });
    }
    if (!process.env.ZHIPU_API_KEY) console.log('未配置智谱 API Key，可浏览首页和规则；AI 对局需配置后重启。');
  }
  await startAudio('tts', tts);
  if (provider === 'local') await startAudio('stt', stt);
  else console.log(`语音识别使用 ${provider}，跳过本地 STT 安装和启动。`);
  const url = `http://127.0.0.1:${port}`;
  console.log('正在启动网页……');
  launch(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(port)], '网页服务', true);
  await waitReady(`${url}/api/game`, null, '网页服务');
  console.log(`\n启动完成：${url}\n保持此终端开启；按 Ctrl+C 停止本次启动的服务。`);
  if (!args.has('--no-browser')) openBrowser(url);
}

main().catch(error => {
  if (!stopping) console.error(`\n启动失败：${error.message}`);
  void shutdown(1);
});
