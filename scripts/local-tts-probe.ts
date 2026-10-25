import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { synthesizeSpeech, wavMetadata } from '../src/lib/server/speech';
import { ttsModel } from '../src/lib/server/local-tts';

const text = '我是三号玩家。预言家的查验和昨天的投票记录，应该结合起来分析。';
const directory = '.data/audit';
async function main() {
  await mkdir(directory, { recursive: true });
  const samples = [];
  for (const seat of [0, 2, 3, 4, 5, 6, 7, 8, 9]) {
    const started = performance.now();
    const bytes = await synthesizeSpeech(text, seat);
    const elapsedMs = Math.round(performance.now() - started);
    const metadata = wavMetadata(bytes);
    assert.equal(metadata.sampleRate, 24000);
    assert.equal(metadata.channels, 1);
    assert.ok(metadata.duration > 1);
    const file = `${directory}/local-tts-seat-${seat}.wav`;
    await writeFile(file, bytes);
    samples.push({ seat, elapsedMs, bytes: bytes.length, ...metadata, file });
    console.log(`席位 ${seat}：${metadata.duration.toFixed(2)} 秒 WAV，合成 ${elapsedMs} ms`);
  }
  const report = { ok: true, verifiedAt: new Date().toISOString(), model: ttsModel(), text, samples };
  await writeFile(`${directory}/local-tts.json`, JSON.stringify(report, null, 2));
  console.log(`本地配音验证通过；报告：${directory}/local-tts.json`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : '本地配音验证失败'); process.exitCode = 1; });
