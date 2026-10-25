import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { transcribeSpeech } from './speech';
import { modelConfiguration } from './model';

function wave(seconds = 1) {
  const bytes = Buffer.alloc(44 + Math.ceil(16000 * seconds) * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40); return bytes;
}
function environment(t: TestContext, values: Record<string, string> = {}) {
  const names = ['STT_PROVIDER', 'STT_BASE_URL', 'STT_MODEL', 'STT_API_KEY', 'ZHIPU_API_KEY', 'ZHIPU_BASE_URL', 'ZHIPU_STT_MODEL'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  for (const name of names) { if (name in values) process.env[name] = values[name]; else delete process.env[name]; }
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
}

test('STT defaults to loopback SenseVoice without credentials or a cloud fallback', async t => {
  environment(t, { ZHIPU_API_KEY: 'never-forward-this', STT_API_KEY: 'never-forward-either' });
  assert.equal(modelConfiguration().stt, 'sensevoice-small-int8'); assert.equal(modelConfiguration().sttProvider, 'local');
  assert.ok(!JSON.stringify(modelConfiguration()).includes('never-forward'));
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'http://127.0.0.1:8881/v1/audio/transcriptions');
    assert.equal(new Headers(init?.headers).get('Authorization'), null);
    const form = init?.body as FormData;
    assert.equal(form.get('model'), 'sensevoice-small-int8'); assert.equal(form.get('language'), 'zh');
    assert.equal(form.get('response_format'), 'json'); assert.match(String(form.get('prompt')), /预言家/);
    assert.deepEqual(Buffer.from(await (form.get('file') as File).arrayBuffer()), wave());
    assert.equal(init?.redirect, 'error'); assert.equal(init?.cache, 'no-store'); assert.ok(init?.signal);
    return Response.json({ text: '  三号值得怀疑。 ', reasoning_content: 'never-read' });
  };
  assert.equal(await transcribeSpeech(wave(), ['预言家']), '三号值得怀疑。');
  let calls = 0; globalThis.fetch = async () => { calls++; throw new TypeError('ECONNREFUSED: private details'); };
  await assert.rejects(transcribeSpeech(wave()), /pnpm stt:start/); assert.equal(calls, 1);
});

test('external STT sends its own model and server-only bearer token to a compatible API', async t => {
  environment(t, { STT_PROVIDER: 'external', STT_BASE_URL: 'https://speech.example/v1/', STT_MODEL: 'whisper-compatible', STT_API_KEY: 'stt-only', ZHIPU_API_KEY: 'chat-only' });
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://speech.example/v1/audio/transcriptions');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer stt-only');
    assert.equal((init?.body as FormData).get('model'), 'whisper-compatible');
    return Response.json({ text: '我选择弃票。' });
  };
  assert.equal(await transcribeSpeech(wave()), '我选择弃票。');
  const config = JSON.stringify(modelConfiguration()); assert.ok(!config.includes('speech.example')); assert.ok(!config.includes('stt-only'));
});

test('STT rejects invalid provider, missing external configuration and remote URLs in local mode before fetching', async t => {
  environment(t); let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ text: 'unexpected' }); };
  process.env.STT_PROVIDER = 'unknown'; await assert.rejects(transcribeSpeech(wave()), /STT_PROVIDER/);
  process.env.STT_PROVIDER = 'external'; await assert.rejects(transcribeSpeech(wave()), /STT_MODEL/);
  process.env.STT_MODEL = 'example'; await assert.rejects(transcribeSpeech(wave()), /STT_BASE_URL/);
  process.env.STT_PROVIDER = 'local'; process.env.STT_BASE_URL = 'https://remote.example/v1'; await assert.rejects(transcribeSpeech(wave()), /local 仅接受本机/);
  process.env.STT_BASE_URL = 'http://user:secret@localhost:8881/v1'; await assert.rejects(transcribeSpeech(wave()), /STT_BASE_URL/);
  process.env.STT_BASE_URL = 'file:///tmp'; await assert.rejects(transcribeSpeech(wave()), /STT_BASE_URL/);
  assert.equal(calls, 0);
});

test('STT bounds and validates response bodies without disclosing upstream content', async t => {
  environment(t);
  for (const [status, expected] of [[503, /服务忙/], [429, /服务忙/], [500, /HTTP 500/]] as const) {
    globalThis.fetch = async () => new Response('private upstream detail and token', { status });
    await assert.rejects(transcribeSpeech(wave()), error => { assert.match((error as Error).message, expected); assert.ok(!(error as Error).message.includes('private')); return true; });
  }
  for (const value of [null, {}, { text: 3 }, { text: '   ' }, { reasoning_content: '不是转写' }]) {
    globalThis.fetch = async () => Response.json(value); await assert.rejects(transcribeSpeech(wave()), /未识别到/);
  }
  globalThis.fetch = async () => new Response('not JSON'); await assert.rejects(transcribeSpeech(wave()), /格式无效/);
  globalThis.fetch = async () => Response.json({ text: '字'.repeat(3001) }); await assert.rejects(transcribeSpeech(wave()), /过长/);
  globalThis.fetch = async () => new Response('x'.repeat(65537)); await assert.rejects(transcribeSpeech(wave()), /过大/);
  globalThis.fetch = async () => new Response('{}', { headers: { 'Content-Length': '999999' } }); await assert.rejects(transcribeSpeech(wave()), /过大/);
});

test('recording cancellation aborts STT and invalid WAVs never reach a provider', async t => {
  environment(t); const controller = new AbortController(); let called = 0;
  globalThis.fetch = async (_url, init) => { called++; return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })); };
  const pending = transcribeSpeech(wave(), [], controller.signal); controller.abort();
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(called, 1);
  await assert.rejects(transcribeSpeech(wave(), [], controller.signal), { name: 'AbortError' }); assert.equal(called, 1);
  await assert.rejects(transcribeSpeech(wave(31)), /30 秒/);
  await assert.rejects(transcribeSpeech(wave(0.1)), /录音太短/);
  await assert.rejects(transcribeSpeech(Buffer.from('not-wav')), /WAV/); assert.equal(called, 1);
});
