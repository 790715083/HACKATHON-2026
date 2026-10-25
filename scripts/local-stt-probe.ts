import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { transcribeSpeech, wavMetadata } from '../src/lib/server/speech';
import { sttConfiguration } from '../src/lib/server/stt-config';

async function main() {
  const configuration = sttConfiguration();
  assert.equal(configuration.provider, 'local', 'stt:probe 只验证本地推理，请使用 STT_PROVIDER=local。');
  const sample = process.argv[2] || '.data/stt/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/test_wavs/zh.wav';
  const bytes = await readFile(sample);
  const metadata = wavMetadata(bytes);
  const started = performance.now();
  const text = await transcribeSpeech(bytes, ['预言家', '查杀', '金水']);
  assert.ok(text.trim());
  if (!process.argv[2]) {
    assert.match(text, /时间/); assert.match(text, /早上9点/); assert.match(text, /下午5点/);
  }
  const report = { ok: true, verifiedAt: new Date().toISOString(), ...configuration, sample,
    ...metadata, elapsedMs: Math.round(performance.now() - started), text,
    ...(!process.argv[2] ? { reference: '开放时间早上9点至下午5点。', exactMatch: text === '开放时间早上9点至下午5点。' } : {}) };
  await mkdir('.data/audit', { recursive: true });
  await writeFile('.data/audit/local-stt.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : '本地识别验证失败'); process.exitCode = 1; });
