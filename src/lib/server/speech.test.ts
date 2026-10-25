import assert from 'node:assert/strict';
import test from 'node:test';
import { splitSpeech, transcribeSpeech, wavMetadata } from './speech';
export function wave(seconds: number) {
  const rate = 16000; const count = Math.ceil(rate * seconds); const bytes = Buffer.alloc(44 + count * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8); bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(count * 2, 40); return bytes;
}
test('WAV validation bounds duration independently of file size or extension', () => {
  assert.equal(wavMetadata(wave(1)).duration, 1);
  assert.throws(() => wavMetadata(wave(31)), /30 秒/);
  assert.throws(() => wavMetadata(Buffer.from('renamed-webm.wav')), /WAV/);
  const truncated = wave(1).subarray(0, 50); assert.throws(() => wavMetadata(truncated), /不完整/);
  const forged = wave(1); forged.writeUInt16LE(0, 32); assert.throws(() => wavMetadata(forged), /PCM/);
});
test('speech splitting preserves every character within provider text limit', () => {
  const text = '先看票型。'.repeat(400) + '再看发言'; const chunks = splitSpeech(text);
  assert.equal(chunks.join(''), text); assert.ok(chunks.every(chunk => chunk.length <= 300));
});
test('ASR uses WAV bytes and model endpoint, parses final transcript only', async () => {
  const originalFetch = globalThis.fetch; const previousKey = process.env.ZHIPU_API_KEY; process.env.ZHIPU_API_KEY = 'test-only-key';
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /audio\/transcriptions$/); const form = init?.body as FormData;
    assert.equal(form.get('model'), 'glm-asr-2512'); assert.equal((form.get('file') as File).type, 'audio/wav'); assert.equal(form.get('stream'), 'false');
    return Response.json({ text: '我怀疑三号的发言。' });
  };
  try { assert.equal(await transcribeSpeech(wave(1), ['预言家']), '我怀疑三号的发言。'); }
  finally { globalThis.fetch = originalFetch; if (previousKey === undefined) delete process.env.ZHIPU_API_KEY; else process.env.ZHIPU_API_KEY = previousKey; }
});
