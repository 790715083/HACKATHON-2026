import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { applyAction, createGame, getNextTurn } from '@/lib/game/engine';
import { readGame, saveGame, saveSession, SESSION_COOKIE } from './store';
import { splitSpeech } from './speech';
import { GET as getGame, POST as create } from '@/app/api/game/route';
import { POST as act } from '@/app/api/game/actions/route';
import { POST as advance } from '@/app/api/game/advance/route';
import { POST as tts } from '@/app/api/tts/route';
import { POST as stt } from '@/app/api/stt/route';
import type { PlayerView } from '@/lib/game/types';

function request(route: string, body?: unknown, cookie?: string) {
  return new Request(`http://localhost:3000/api/${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
test('route contract: session view, idempotent actions, stale rejection and unauthorized voice access', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'moonlit-api-')); const previousDir = process.env.MOONLIT_DATA_DIR; process.env.MOONLIT_DATA_DIR = directory;
  try {
    const fresh = await getGame(request('game')); assert.equal((await fresh.json()).game, null);
    const created = await create(request('game', { preferredRole: 'werewolf', name: '测试玩家' })); assert.equal(created.status, 200);
    const cookie = created.headers.get('set-cookie')!.split(';')[0]; let game: PlayerView = (await created.json()).game;
    assert.equal(game.me.role, 'werewolf'); assert.ok(game.turn); assert.equal(game.players.filter(p => p.role).length, 3);
    assert.ok(created.headers.get('set-cookie')?.includes('HttpOnly'));
    const body = { gameId: game.id, revision: game.revision, turnId: game.turn!.id, kind: 'wolf_chat', text: '先听听大家的判断。', actionId: 'test-action-1234567890', actorSeat: 9 };
    const first = await act(request('game/actions', body, cookie)); assert.equal(first.status, 200); game = (await first.json()).game;
    const replay = await act(request('game/actions', body, cookie)); assert.equal(replay.status, 200); assert.equal((await replay.json()).game.revision, game.revision);
    const stale = await act(request('game/actions', { ...body, actionId: 'second-action-1234567890' }, cookie)); assert.equal(stale.status, 409);
    const crossGame = await act(request('game/actions', { ...body, gameId: 'not-your-game-1234567890' }, cookie)); assert.equal(crossGame.status, 409);
    const hidden = await tts(request('tts', { gameId: game.id, eventId: 'hidden-nonexistent-event' }, cookie)); assert.equal(hidden.status, 400);
    const missing = await stt(new Request('http://localhost:3000/api/stt', { method: 'POST' })); assert.equal(missing.status, 401);
    const crossOrigin = new Request('http://localhost:3000/api/game', { method: 'POST', headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal((await create(crossOrigin)).status, 403);
  } finally { if (previousDir === undefined) delete process.env.MOONLIT_DATA_DIR; else process.env.MOONLIT_DATA_DIR = previousDir; await rm(directory, { recursive: true, force: true }); }
});

test('pause cancels an in-flight AI call and preserves its uncommitted turn for restart', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'moonlit-cancel-')); const previousDir = process.env.MOONLIT_DATA_DIR; const previousKey = process.env.ZHIPU_API_KEY; const originalFetch = globalThis.fetch;
  process.env.MOONLIT_DATA_DIR = directory; process.env.ZHIPU_API_KEY = 'test-only-key';
  let started!: () => void; const waiting = new Promise<void>(resolve => { started = resolve; }); let canceled = false;
  globalThis.fetch = async (_url, init) => { started(); return new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => { canceled = true; reject(new DOMException('aborted', 'AbortError')); }, { once: true }); }); };
  try {
    const created = await create(request('game', { preferredRole: 'villager' })); const cookie = created.headers.get('set-cookie')!.split(';')[0]; const initial: PlayerView = (await created.json()).game;
    const stream = await advance(request('game/advance', { gameId: initial.id }, cookie)); assert.equal(stream.status, 200); const reading = stream.text(); await waiting;
    const pausedResponse = await act(request('game/actions', { gameId: initial.id, revision: initial.revision, control: 'pause', actionId: 'pause-action-1234567890' }, cookie));
    assert.equal(pausedResponse.status, 200); const paused: PlayerView = (await pausedResponse.json()).game; assert.equal(paused.paused, true); assert.equal(canceled, true);
    assert.deepEqual(paused.events, initial.events); await reading;
    const recovered = (await (await getGame(request('game', undefined, cookie))).json()).game as PlayerView; assert.equal(recovered.paused, true); assert.equal(recovered.revision, paused.revision);
  } finally { globalThis.fetch = originalFetch; if (previousDir === undefined) delete process.env.MOONLIT_DATA_DIR; else process.env.MOONLIT_DATA_DIR = previousDir; if (previousKey === undefined) delete process.env.ZHIPU_API_KEY; else process.env.ZHIPU_API_KEY = previousKey; await rm(directory, { recursive: true, force: true }); }
});

test('TTS routes recover from a busy model, synthesize only committed chunks and reuse the audio cache', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'moonlit-tts-')); const previousDir = process.env.MOONLIT_DATA_DIR; const originalFetch = globalThis.fetch;
  process.env.MOONLIT_DATA_DIR = directory;
  try {
    let state = createGame({ id: randomUUID(), preferredRole: 'werewolf' }); const turn = getNextTurn(state)!;
    const text = '先看票型，再判断发言。'.repeat(55);
    state = applyAction(state, { turnId: turn.id, actorSeat: turn.actorSeat, kind: turn.kind, text });
    const event = state.events.find(item => item.text === text)!;
    await saveGame(state); const session = randomUUID(); await saveSession(session, state.id); const cookie = `${SESSION_COOKIE}=${session}`;
    const bytes = Buffer.alloc(46); bytes.write('RIFF'); bytes.writeUInt32LE(38, 4); bytes.write('WAVE', 8);
    bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(24000, 24); bytes.writeUInt32LE(48000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(2, 40);
    const spoken: string[] = []; const chunks = splitSpeech(text); assert.ok(chunks.length > 1); let attempts = 0;
    globalThis.fetch = async (_url, init) => {
      if (attempts++ === 0) return new Response('busy', { status: 503 });
      spoken.push(JSON.parse(init?.body as string).input); return new Response(bytes, { headers: { 'Content-Type': 'audio/wav' } });
    };
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const response = await tts(request('tts', { gameId: state.id, eventId: event.id, chunkIndex, text: '不能由客户端注入的其他文本' }, cookie));
      assert.equal(response.status, 200); assert.equal(response.headers.get('X-Audio-Chunks'), String(chunks.length));
      assert.equal(response.headers.get('Cache-Control'), 'private, no-store'); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    }
    const cached = await tts(request('tts', { gameId: state.id, eventId: event.id, chunkIndex: 0 }, cookie)); assert.equal(cached.status, 200);
    const invalid = await tts(request('tts', { gameId: state.id, eventId: event.id, chunkIndex: chunks.length }, cookie)); assert.equal(invalid.status, 400);
    const unsigned = await tts(request('tts', { gameId: state.id, eventId: event.id })); assert.equal(unsigned.status, 401);
    assert.equal(attempts, chunks.length + 1); assert.deepEqual(spoken, chunks); assert.deepEqual(await readGame(state.id), state);
  } finally { globalThis.fetch = originalFetch; if (previousDir === undefined) delete process.env.MOONLIT_DATA_DIR; else process.env.MOONLIT_DATA_DIR = previousDir; await rm(directory, { recursive: true, force: true }); }
});
