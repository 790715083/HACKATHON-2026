import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createGame } from '@/lib/game/engine';
import { cacheAudio, isIdentifier, readGame, readSession, runtimeState, saveGame, saveSession, withLock } from './store';
import { currentGameId, ensureSameOrigin, HttpError } from './http';
test('origin check uses actual HTTP Host when Next normalizes the URL, preserving host and port boundaries', () => {
  const normalized = (origin: string, host = '127.0.0.1:3000', extra: Record<string, string> = {}) => new Request('http://localhost:3000/api/game', { method: 'POST', headers: { Host: host, Origin: origin, ...extra } });
  assert.doesNotThrow(() => ensureSameOrigin(normalized('http://127.0.0.1:3000')));
  assert.doesNotThrow(() => ensureSameOrigin(normalized('http://localhost:3000', 'localhost:3000')));
  assert.throws(() => ensureSameOrigin(normalized('http://localhost:3000')), /跨站/);
  assert.throws(() => ensureSameOrigin(normalized('http://127.0.0.1:3001')), /跨站/);
  assert.throws(() => ensureSameOrigin(normalized('https://127.0.0.1:3000')), /跨站/);
  assert.throws(() => ensureSameOrigin(normalized('https://attacker.example', '127.0.0.1:3000', { 'x-forwarded-host': 'attacker.example', 'x-forwarded-proto': 'https' })), /跨站/);
});
test('atomic checkpoints survive a fresh read; invalid ids and other sessions cannot read them', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'moonlit-store-')); const previousDir = process.env.MOONLIT_DATA_DIR; process.env.MOONLIT_DATA_DIR = directory;
  try {
    const game = createGame({ id: 'test-game-1234567890', seed: 42 }); await saveGame(game); await saveSession('session-1234567890', game.id);
    assert.deepEqual(await readGame(game.id), game); assert.equal(await readGame('../../etc/passwd'), null); assert.equal(isIdentifier('../secret'), false);
    assert.equal(await readSession('session-1234567890'), game.id); assert.equal((await stat(path.join(directory, 'games', `${game.id}.json`))).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(path.join(directory, 'games')), [`${game.id}.json`]);
    const request = new Request('http://localhost:3000/api/game', { headers: { cookie: 'moonlit_session=session-1234567890' } });
    await assert.rejects(() => currentGameId(request, 'other-game-1234567890'), (error: unknown) => error instanceof HttpError && error.status === 409);
  } finally { if (previousDir === undefined) delete process.env.MOONLIT_DATA_DIR; else process.env.MOONLIT_DATA_DIR = previousDir; await rm(directory, { recursive: true, force: true }); }
});
test('per-game lock serializes overlapping mutations and releases after failure', async () => {
  const order: number[] = [];
  await Promise.all([withLock('test-lock', async () => { await new Promise(resolve => setTimeout(resolve, 15)); order.push(1); }), withLock('test-lock', async () => { order.push(2); })]);
  assert.deepEqual(order, [1, 2]); await assert.rejects(() => withLock('test-lock', async () => { throw new Error('test'); }));
  assert.equal(await withLock('test-lock', async () => 3), 3); assert.equal(runtimeState.locks.has('test-lock'), false);
});
test('audio cache is bounded and evicts older clips', () => {
  runtimeState.audio.clear(); for (let index = 0; index < 30; index++) cacheAudio(`clip-${index}`, new Uint8Array(10));
  assert.equal(runtimeState.audio.size, 24); assert.equal(runtimeState.audio.has('clip-0'), false); runtimeState.audio.clear();
});
