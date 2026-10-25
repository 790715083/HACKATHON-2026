import assert from 'node:assert/strict';
import test from 'node:test';
import { synthesizeSpeech } from './speech';
import { modelConfiguration } from './model';

function wav() {
  const bytes = Buffer.alloc(46);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(24000, 24); bytes.writeUInt32LE(48000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(2, 40);
  return bytes;
}
function mockFetch(t: { after(fn: () => void): void }, replacement: typeof fetch) {
  const original = globalThis.fetch;
  globalThis.fetch = replacement;
  t.after(() => { globalThis.fetch = original; });
}

test('TTS defaults to local Kokoro without a cloud key, and keeps distinct AI voices', async t => {
  const previous = { key: process.env.ZHIPU_API_KEY, model: process.env.ZHIPU_TTS_MODEL, base: process.env.TTS_BASE_URL, localModel: process.env.TTS_MODEL };
  delete process.env.ZHIPU_API_KEY; delete process.env.TTS_BASE_URL; delete process.env.TTS_MODEL;
  process.env.ZHIPU_TTS_MODEL = 'old-cloud-model';
  t.after(() => {
    for (const [name, value] of Object.entries({ ZHIPU_API_KEY: previous.key, ZHIPU_TTS_MODEL: previous.model, TTS_BASE_URL: previous.base, TTS_MODEL: previous.localModel })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  const seen = new Set();
  mockFetch(t, async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:8880/v1/audio/speech');
    assert.equal(new Headers(init?.headers).get('Authorization'), null);
    const body = JSON.parse(init?.body as string);
    assert.equal(body.model, 'kokoro-v1.1-zh'); assert.equal(body.input, '先看票型。');
    assert.equal(body.response_format, 'wav'); assert.equal(body.stream, false);
    assert.equal(init?.redirect, 'error'); assert.ok(init?.signal);
    seen.add(body.voice);
    return new Response(wav(), { headers: { 'Content-Type': 'audio/wav' } });
  });
  assert.equal(modelConfiguration().tts, 'kokoro-v1.1-zh');
  for (let seat = 2; seat <= 9; seat++) assert.deepEqual(await synthesizeSpeech('先看票型。', seat), wav());
  assert.equal(seen.size, 8);
});

test('local TTS configuration reaches the selected deployment', async t => {
  const previousBase = process.env.TTS_BASE_URL, previousModel = process.env.TTS_MODEL;
  process.env.TTS_BASE_URL = 'http://127.0.0.1:9000/v1/'; process.env.TTS_MODEL = 'local-test';
  t.after(() => { if (previousBase === undefined) delete process.env.TTS_BASE_URL; else process.env.TTS_BASE_URL = previousBase; if (previousModel === undefined) delete process.env.TTS_MODEL; else process.env.TTS_MODEL = previousModel; });
  mockFetch(t, async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:9000/v1/audio/speech'); assert.equal(JSON.parse(init?.body as string).model, 'local-test');
    return new Response(wav(), { headers: { 'Content-Type': 'audio/wav' } });
  });
  await synthesizeSpeech('配音测试。', 0);
});

test('local TTS reports offline/busy services without falling back or exposing upstream bodies', async t => {
  let calls = 0;
  mockFetch(t, async () => { calls++; throw new TypeError('ECONNREFUSED'); });
  await assert.rejects(synthesizeSpeech('测试。', 2), /pnpm tts:start/); assert.equal(calls, 1);
  globalThis.fetch = async () => new Response('private upstream detail', { status: 503 });
  await assert.rejects(synthesizeSpeech('测试。', 2), /服务忙/);
  globalThis.fetch = async () => new Response('private upstream detail', { status: 400 });
  await assert.rejects(synthesizeSpeech('测试。', 2), /TTS_BASE_URL/);
});

test('local TTS rejects non-WAV, truncated and oversized audio', async t => {
  mockFetch(t, async () => Response.json({ url: 'https://untrusted.example/audio.wav' }));
  await assert.rejects(synthesizeSpeech('测试。', 2), /WAV/);
  globalThis.fetch = async () => new Response(Buffer.from('RIFFnot-valid'), { headers: { 'Content-Type': 'audio/wav' } });
  await assert.rejects(synthesizeSpeech('测试。', 2), /不完整/);
  const truncated = wav(); truncated.writeUInt32LE(999, 4);
  globalThis.fetch = async () => new Response(truncated, { headers: { 'Content-Type': 'audio/wav' } });
  await assert.rejects(synthesizeSpeech('测试。', 2), /不完整/);
  globalThis.fetch = async () => new Response(wav(), { headers: { 'Content-Type': 'audio/wav', 'Content-Length': String(13 * 1024 * 1024) } });
  await assert.rejects(synthesizeSpeech('测试。', 2), /WAV/);
  globalThis.fetch = async () => new Response(new Uint8Array(13 * 1024 * 1024), { headers: { 'Content-Type': 'audio/wav' } });
  await assert.rejects(synthesizeSpeech('测试。', 2), /过大/);
});

test('stopping playback aborts the local synthesis request', async t => {
  const controller = new AbortController(); let combined: AbortSignal | null | undefined;
  mockFetch(t, async (_url, init) => {
    combined = init?.signal;
    return new Promise((_resolve, reject) => combined?.addEventListener('abort', () => reject(combined?.reason), { once: true }));
  });
  const pending = synthesizeSpeech('测试。', 2, controller.signal); controller.abort();
  await assert.rejects(pending, { name: 'AbortError' }); assert.ok(combined?.aborted);
});
