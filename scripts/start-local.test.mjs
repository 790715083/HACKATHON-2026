import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const models = {
  tts: { model: 'kokoro-v1.1-zh', directory: 'kokoro-int8-multi-lang-v1_1', hash: 'a1e94694776049035c4f2c6529f003aaece993c76aae9a78995831c3c4dcafc6', files: ['model.int8.onnx', 'voices.bin', 'tokens.txt', 'lexicon-zh.txt', 'lexicon-us-en.txt', 'phone-zh.fst', 'date-zh.fst', 'number-zh.fst'] },
  stt: { model: 'sensevoice-small-int8', directory: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17', hash: '7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e', files: ['model.int8.onnx', 'tokens.txt', 'test_wavs/zh.wav'] },
};

// Exercise real launcher subprocesses without downloading or loading speech models.
const fakeProcess = `#!${process.execPath}
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
const root = process.env.FIXTURE_ROOT;
const args = process.argv.slice(2);
const name = process.argv[1].split('/').pop();
const models = JSON.parse(readFileSync(join(root, 'models.json')));
const log = entry => appendFileSync(join(root, 'events.jsonl'), JSON.stringify(entry) + '\\n');
if (name === 'open' || name === 'xdg-open') { log({ event: 'browser', args }); process.exit(0); }
if (name === 'pnpm' || name === 'npm') {
  if (args[0] === '--version') console.log(name === 'pnpm' ? (process.env.FIXTURE_PNPM_VERSION || '11.25.0') : '11.0.0');
  else log({ event: 'install', command: name, args });
  process.exit(0);
}
if (args[0] === '-c') process.exit(0);
const setup = args.find(arg => /setup-local-(tts|stt)\\.py$/.test(arg));
if (setup) {
  const kind = setup.includes('tts') ? 'tts' : 'stt';
  const config = models[kind], data = join(root, '.data', kind);
  const python = join(data, 'venv/bin/python');
  mkdirSync(dirname(python), { recursive: true });
  copyFileSync(join(root, 'bin/python3'), python);
  for (const file of [...config.files, '.verified-sha256']) {
    const path = join(data, config.directory, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file === '.verified-sha256' ? config.hash : 'fixture');
  }
  log({ event: 'setup', kind });
  process.exit(0);
}
const kind = name === 'next' ? 'web' : (args.some(arg => arg.includes('local-tts')) ? 'tts' : 'stt');
if (kind === 'stt' && process.env.FIXTURE_FAIL_STT) process.exit(17);
const port = Number(args[args.indexOf('--port') + 1]);
if (kind === 'web') spawn(process.execPath, [join(root, 'grandchild.mjs')], { stdio: 'ignore' });
createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(kind === 'web' ? { configured: true, game: null } : { status: 'ok', model: models[kind].model }));
}).listen(port, '127.0.0.1', () => log({ event: 'server', kind, port, pid: process.pid }));
`;

async function poll(check, message) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) { if (await check()) return; await delay(40); }
  assert.fail(typeof message === 'function' ? message() : message);
}

async function listeningServer(t, body) {
  const server = createServer((request, response) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(body)); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return server;
}

async function fixture(t, extra = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'moonlit launcher space '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of ['scripts', 'bin', 'node_modules/@next', 'node_modules/next/dist/bin']) await mkdir(join(directory, name), { recursive: true });
  for (const name of ['start.sh', 'start.command', 'scripts/start-local.mjs', 'scripts/read-secret.mjs', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) await copyFile(join(root, name), join(directory, name));
  await symlink(dirname(require.resolve('@next/env/package.json')), join(directory, 'node_modules/@next/env'));
  await writeFile(join(directory, 'node_modules/next/package.json'), '{"name":"next"}');
  for (const name of ['bin/pnpm', 'bin/npm', 'bin/python3', 'bin/open', 'bin/xdg-open', 'node_modules/next/dist/bin/next']) await writeFile(join(directory, name), fakeProcess, { mode: 0o755 });
  await writeFile(join(directory, 'models.json'), JSON.stringify(models));
  await writeFile(join(directory, 'grandchild.mjs'), `import { appendFileSync } from 'node:fs'; appendFileSync(process.env.FIXTURE_ROOT + '/events.jsonl', JSON.stringify({event:'server',kind:'grandchild',pid:process.pid}) + '\\n'); setInterval(() => {}, 1000);`);
  const ports = [];
  for (let i = 0; i < 3; i++) {
    const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    ports.push(server.address().port); await new Promise(resolve => server.close(resolve));
  }
  const [port, tts, stt] = ports;
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(ZHIPU_|STT_|TTS_|PORT$|NODE_ENV$|__NEXT_PROCESSED_ENV$|PYTHON_BIN$)/.test(key)) delete env[key];
  Object.assign(env, { PATH: `${directory}/bin:${process.env.PATH}`, PYTHON_BIN: join(directory, 'bin/python3'), FIXTURE_ROOT: directory, ...extra });
  await writeFile(join(directory, '.env.local'), `PORT=${port}\nTTS_BASE_URL=http://localhost:${tts}/v1\nSTT_BASE_URL=http://127.0.0.1:${stt}/v1\nZHIPU_API_KEY=fixture-secret-never-log\n`);
  const events = async () => {
    try { return (await readFile(join(directory, 'events.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  };
  const launch = ({ entry = 'start.sh', args = ['--no-browser', '--no-prompt'] } = {}) => {
    let output = '';
    const child = spawn(join(directory, entry), args, { cwd: tmpdir(), env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', bytes => { output += bytes; }); child.stderr.on('data', bytes => { output += bytes; });
    const exited = once(child, 'exit');
    t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await exited; } });
    return { child, exited, output: () => output };
  };
  return { directory, port, tts, stt, env, events, launch };
}

async function assertStopped(events) {
  await poll(() => events.filter(event => event.pid).every(event => {
    try { process.kill(event.pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; }
  }), 'owned service processes and descendants should exit');
}

test('cold and warm launches use env config, pinned pnpm fallback, and stop only owned process groups', async t => {
  const setup = await fixture(t, { FIXTURE_PNPM_VERSION: '9.0.0' });
  const first = setup.launch();
  await poll(() => first.output().includes('启动完成'), () => first.output());
  await poll(async () => (await setup.events()).some(event => event.kind === 'grandchild'), 'web descendant starts');
  const events = await setup.events();
  assert.deepEqual(events.filter(event => event.event === 'setup').map(event => event.kind), ['tts', 'stt']);
  assert.deepEqual(events.find(event => event.event === 'install').args, ['exec', '--yes', '--package=pnpm@11.25.0', '--', 'pnpm', 'install', '--frozen-lockfile']);
  assert(first.output().includes(`http://127.0.0.1:${setup.port}`));
  assert(!first.output().includes('fixture-secret-never-log'));
  assert(!events.some(event => event.event === 'browser'));
  first.child.kill('SIGINT'); assert.equal((await first.exited)[0], 0);
  await assertStopped(events);
  const second = setup.launch();
  await poll(() => second.output().includes('启动完成'), 'warm start ready');
  second.child.kill('SIGTERM'); assert.equal((await second.exited)[0], 0);
  const warm = await setup.events();
  assert.equal(warm.filter(event => event.event === 'install').length, 1);
  assert.equal(warm.filter(event => event.event === 'setup').length, 2);
  await assertStopped(warm);
});

test('a compatible STT service is reused and survives launcher shutdown', async t => {
  const existing = await listeningServer(t, { status: 'ok', model: models.stt.model });
  const setup = await fixture(t, { STT_BASE_URL: `http://127.0.0.1:${existing.address().port}/v1` });
  const run = setup.launch();
  await poll(() => run.output().includes('启动完成'), 'reuse start ready');
  assert(run.output().includes('复用现有服务'));
  assert(!(await setup.events()).some(event => event.kind === 'stt'));
  run.child.kill('SIGTERM'); await run.exited;
  assert.equal((await fetch(`http://127.0.0.1:${existing.address().port}/health`)).status, 200);
  await assertStopped(await setup.events());
});

test('the macOS entry opens the browser after readiness and skips external STT setup', async t => {
  const setup = await fixture(t, { STT_PROVIDER: 'external' });
  const run = setup.launch({ entry: 'start.command', args: ['--no-prompt'] });
  await poll(() => run.output().includes('启动完成'), 'external STT start ready');
  await poll(async () => (await setup.events()).some(event => event.event === 'browser'), 'browser opens after readiness');
  assert.deepEqual((await setup.events()).find(event => event.event === 'browser').args, [`http://127.0.0.1:${setup.port}`]);
  assert(run.output().includes('跳过本地 STT'));
  assert(!(await setup.events()).some(event => event.kind === 'stt'));
  run.child.kill('SIGTERM'); await run.exited;
  await assertStopped(await setup.events());
});

test('web port conflicts and incompatible audio services fail without replacing existing listeners', async t => {
  const existing = await listeningServer(t, { status: 'ok', model: 'another-model' });
  const setup = await fixture(t, { PORT: String(existing.address().port) });
  const web = setup.launch(); assert.equal((await web.exited)[0], 1);
  assert(web.output().includes('网页端口')); assert(web.output().includes('PORT=3001'));
  assert(!(await setup.events()).some(event => event.event === 'setup'));
  setup.env.PORT = String(setup.port); setup.env.TTS_BASE_URL = `http://127.0.0.1:${existing.address().port}/v1`;
  const audio = setup.launch(); assert.equal((await audio.exited)[0], 1);
  assert(audio.output().includes('本地配音端口'));
  assert.equal((await fetch(`http://127.0.0.1:${existing.address().port}/health`)).status, 200);
});

test('a speech service startup failure cleans up the service already started', async t => {
  const setup = await fixture(t, { FIXTURE_FAIL_STT: '1' });
  const run = setup.launch(); assert.equal((await run.exited)[0], 17);
  assert(run.output().includes('本地识别意外退出'));
  const events = await setup.events();
  assert(events.some(event => event.kind === 'tts' && event.event === 'server'));
  assert(!events.some(event => event.kind === 'web'));
  await assertStopped(events);
});
