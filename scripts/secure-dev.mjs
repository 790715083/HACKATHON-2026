import { spawn } from 'node:child_process';
import { readSecret } from './read-secret.mjs';
// Optional stdin launcher avoids writing a credential to disk or command history.
const key = await readSecret();
const child = spawn('pnpm', [process.argv[2] === 'start' ? 'start' : 'dev'], { env: { ...process.env, ZHIPU_API_KEY: key }, stdio: ['ignore', 'inherit', 'inherit'] });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code || 0));
