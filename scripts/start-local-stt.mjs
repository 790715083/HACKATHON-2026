import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const python = `${root}.data/stt/venv/${process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'}`;
if (!existsSync(python)) {
  console.error('请先运行 pnpm stt:setup 安装本地识别模型。');
  process.exit(1);
}
const child = spawn(python, ['-u', `${root}services/local-stt/server.py`, ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', () => { console.error('本地识别服务启动失败，请重新运行 pnpm stt:setup。'); process.exit(1); });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
