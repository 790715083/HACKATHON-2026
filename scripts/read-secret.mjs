/** Read a runtime credential without echoing it or writing it to disk. */
export async function readSecret({ allowEmpty = false, prompt = 'Ready for API credential on stdin (input hidden).\n' } = {}) {
  if (process.env.ZHIPU_API_KEY?.trim()) return process.env.ZHIPU_API_KEY.trim();
  process.stdout.write(prompt);
  if (!process.stdin.isTTY) {
    const { createInterface } = await import('node:readline');
    const lines = createInterface({ input: process.stdin, terminal: false });
    for await (const line of lines) {
      lines.close();
      if (!line.trim() && !allowEmpty) throw new Error('API credential cannot be empty.');
      return line.trim();
    }
    throw new Error('No credential received. Use a terminal or pipe a runtime credential on stdin.');
  }
  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const onData = bytes => {
      for (const character of bytes.toString()) {
        if (character === '\u0003') { cleanup(); reject(new Error('Credential input canceled.')); return; }
        if (character === '\r' || character === '\n') {
          cleanup();
          if (!value.trim() && !allowEmpty) reject(new Error('API credential cannot be empty.'));
          else resolve(value.trim());
          return;
        }
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else if (character >= ' ') value += character;
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}
