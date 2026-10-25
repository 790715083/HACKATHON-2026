import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { applyAction, createGame, getNextTurn } from '@/lib/game/engine';
import { POST as stt } from '@/app/api/stt/route';
import { readGame, saveGame, saveSession, SESSION_COOKIE } from './store';

function wave() {
  const bytes = Buffer.alloc(32044); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(32000, 40); return bytes;
}

test('STT route returns a private editable transcript without mutating state and rejects stale/cross-origin uploads', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'moonlit-stt-'));
  const previousDir = process.env.MOONLIT_DATA_DIR, previousProvider = process.env.STT_PROVIDER, originalFetch = globalThis.fetch;
  process.env.MOONLIT_DATA_DIR = directory; process.env.STT_PROVIDER = 'local';
  t.after(async () => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries({ MOONLIT_DATA_DIR: previousDir, STT_PROVIDER: previousProvider })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(directory, { recursive: true, force: true });
  });
  const state = createGame({ id: randomUUID(), preferredRole: 'werewolf' }); const turn = getNextTurn(state)!;
  assert.equal(turn.actorSeat, 1); assert.equal(turn.kind, 'wolf_chat');
  const session = randomUUID(); await saveGame(state); await saveSession(session, state.id);
  function upload(options: { gameId?: string; turnId?: string; origin?: string; bytes?: Uint8Array } = {}) {
    const form = new FormData(); form.set('gameId', options.gameId ?? state.id); form.set('turnId', options.turnId ?? turn.id);
    form.set('file', new Blob([new Uint8Array(options.bytes ?? wave()).buffer], { type: 'audio/wav' }), 'speech.wav');
    return new Request('http://localhost:3000/api/stt', { method: 'POST', headers: { Cookie: `${SESSION_COOKIE}=${session}`, Origin: options.origin ?? 'http://localhost:3000' }, body: form });
  }
  let calls = 0; globalThis.fetch = async () => { calls++; return Response.json({ text: '先听大家发言。' }); };
  const response = await stt(upload()); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { text: '先听大家发言。' });
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store'); assert.deepEqual(await readGame(state.id), state);
  assert.equal((await stt(upload({ gameId: randomUUID() }))).status, 409);
  assert.equal((await stt(upload({ turnId: randomUUID() }))).status, 409);
  assert.equal((await stt(upload({ origin: 'https://untrusted.example' }))).status, 403);
  assert.equal((await stt(upload({ bytes: Buffer.from('not wav') }))).status, 400); assert.equal(calls, 1);
  const malformed = new Request('http://localhost:3000/api/stt', { method: 'POST', headers: { Cookie: `${SESSION_COOKIE}=${session}`, 'Content-Type': 'audio/wav' }, body: wave() });
  assert.equal((await stt(malformed)).status, 400); assert.equal(calls, 1);
  globalThis.fetch = async () => {
    await saveGame(applyAction(state, { turnId: turn.id, actorSeat: 1, kind: 'wolf_chat', text: '该回合已经提交。' }));
    return Response.json({ text: '不应填入下一回合的文字' });
  };
  const stale = await stt(upload()); assert.equal(stale.status, 409); assert.ok(!JSON.stringify(await stale.json()).includes('不应填入'));
  await saveGame(state);
  globalThis.fetch = async () => { await saveSession(session, randomUUID()); return Response.json({ text: '不应跨对局返回' }); };
  assert.equal((await stt(upload())).status, 409);
});

test('STT bounds actual streamed upload bytes and cancels oversized chunked or forged-length requests', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'moonlit-stt-limit-'));
  const previousDir = process.env.MOONLIT_DATA_DIR, originalFetch = globalThis.fetch;
  process.env.MOONLIT_DATA_DIR = directory;
  t.after(async () => {
    globalThis.fetch = originalFetch;
    if (previousDir === undefined) delete process.env.MOONLIT_DATA_DIR; else process.env.MOONLIT_DATA_DIR = previousDir;
    await rm(directory, { recursive: true, force: true });
  });
  const state = createGame({ id: randomUUID(), preferredRole: 'werewolf' }), session = randomUUID();
  await saveGame(state); await saveSession(session, state.id);
  let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('must not call a provider for oversized audio'); };
  for (const declaredLength of [undefined, '100']) {
    let chunks = 0, cancelled = false;
    const bytes = new Uint8Array(1024 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunks === 0) controller.enqueue(Buffer.from('--upload\r\nContent-Disposition: form-data; name="file"; filename="speech.wav"\r\nContent-Type: audio/wav\r\n\r\n'));
        else if (chunks <= 64) controller.enqueue(bytes);
        else { controller.enqueue(Buffer.from('\r\n--upload--\r\n')); controller.close(); }
        chunks++;
      },
      cancel() { cancelled = true; },
    });
    const headers = new Headers({ Cookie: `${SESSION_COOKIE}=${session}`, 'Content-Type': 'multipart/form-data; boundary=upload' });
    if (declaredLength !== undefined) headers.set('Content-Length', declaredLength);
    const request = new Request('http://localhost:3000/api/stt', { method: 'POST', headers, body: stream, duplex: 'half' } as RequestInit & { duplex: 'half' });
    const response = await stt(request);
    assert.equal(response.status, 413); assert.match((await response.json()).error, /过大/);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(cancelled, true); assert.ok(chunks < 32, `read ${chunks} chunks before rejecting`);
  }
  assert.equal(calls, 0); assert.deepEqual(await readGame(state.id), state);
});
