import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import type { GameAction, PlayerView, StreamEvent } from '../src/lib/game/types';

const base = process.env.AUDIT_URL || 'http://127.0.0.1:3000';
let cookie = '';
const report: { startedAt: string; source: string; turns: number; states: number; streamUpdates: number; committedAISpeeches?: number; transitions: string[]; winner?: string; day?: number; elapsedMs?: number; error?: string; final?: PlayerView } = { startedAt: new Date().toISOString(), source: 'real HTTP game API and configured GLM provider; voice disabled', turns: 0, states: 0, streamUpdates: 0, transitions: [] };
const started = Date.now();
let previousLabel = '';
function checkView(game: PlayerView) {
  report.states++;
  assert.equal(game.players.length, 9);
  assert.equal(game.players.filter(p => p.isHuman).length, 1);
  if (game.phase !== 'ended') {
    for (const p of game.players) if (!p.isHuman && !game.me.teammates.includes(p.seat)) assert.equal(p.role, undefined, 'Hidden role leaked to human');
    if (game.me.role !== 'werewolf') assert.equal(game.events.some(e => e.type === 'wolf_chat'), false, 'Wolf chat leaked');
    assert.equal(game.review, undefined, 'Review leaked before ending');
  }
  const ids = game.events.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length, 'Duplicate committed events');
  const label = `Day ${game.day} ${game.phase}${game.turn ? ` human:${game.turn.kind}` : ''}`;
  if (label !== previousLabel) { console.log(`${label} / revision ${game.revision}`); report.transitions.push(label); previousLabel = label; }
  if (game.paused) throw new Error('Game paused after a provider or protocol failure');
}
async function request(path: string, body?: unknown) {
  const r = await fetch(`${base}${path}`, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15 * 60 * 1000) });
  const nextCookie = r.headers.get('set-cookie');
  if (nextCookie) cookie = nextCookie.split(';')[0];
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r;
}
function humanAction(game: PlayerView): GameAction {
  const turn = game.turn!;
  const common = { kind: turn.kind, actorSeat: game.me.seat, turnId: turn.id };
  if (['speech', 'last_words', 'pk_speech', 'wolf_chat'].includes(turn.kind)) {
    const prior = game.voteRounds.at(-1);
    const evidence = prior ? `上一轮实际票型是${prior.ballots.map(v => `${v.seat}号投${v.targetSeat ?? '弃票'}`).join('、')}。` : '目前还没有完整的放逐票型可以对照。';
    return { ...common, text: `我是${game.me.seat}号玩家，我的身份是村民。${evidence}我会结合公开发言前后是否一致来判断，不会把任何人的身份声明当作已经确认的事实。` };
  }
  if (turn.kind === 'witch') return { ...common, use: 'pass' };
  // A human-like bounded choice from the redacted view, without reading server secrets.
  const targets = [...turn.choices];
  const target = targets.length ? targets[(game.day - 1) % targets.length] : null;
  return { ...common, targetSeat: target };
}
async function main() {
await mkdir('.data/audit', { recursive: true });
try {
  let game: PlayerView = (await (await request('/api/game', { name: '验收旅行者', preferredRole: 'villager' })).json()).game;
  checkView(game);
  let iterations = 0;
  while (game.phase !== 'ended') {
    if (++iterations > 100 || game.day > 12) throw new Error('Audit exceeded 100 boundaries or 12 days');
    if (game.turn) {
      const action = humanAction(game);
      const payload = { ...action, gameId: game.id, revision: game.revision, actionId: crypto.randomUUID() };
      const result = await (await request('/api/game/actions', payload)).json();
      game = result.game;
      report.turns++;
      checkView(game);
      // Re-submit the identical command to verify idempotence at the HTTP boundary.
      const again = await (await request('/api/game/actions', payload)).json();
      assert.equal(again.game.revision, game.revision, 'Duplicate command changed state');
      continue;
    }
    const response = await request('/api/game/advance', { gameId: game.id });
    assert.match(response.headers.get('content-type') || '', /text\/event-stream/);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder(); let buffer = '';
    while (true) {
      const next = await reader.read();
      buffer += decoder.decode(next.value, { stream: !next.done });
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const data = frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
        if (!data) continue;
        const event = JSON.parse(data) as StreamEvent;
        if (event.type === 'state') { game = event.game; checkView(game); }
        else if (event.type === 'error') throw new Error(event.message);
        else if (event.type === 'speech') { assert.equal(typeof event.text, 'string'); report.streamUpdates++; }
      }
      if (next.done) break;
    }
  }
  assert.ok(game.winner);
  assert.ok(game.players.every(p => p.role), 'Ended game did not reveal roles');
  const restored = await (await request('/api/game')).json();
  assert.equal(restored.game.revision, game.revision, 'Refresh did not restore checkpoint');
  report.winner = game.winner; report.day = game.day; report.final = game; report.committedAISpeeches = game.events.filter(e => e.type === 'speech' && e.seat !== game.me.seat).length;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  report.elapsedMs = Date.now() - started;
  await writeFile('.data/audit/full-game.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, final: report.final ? { id: report.final.id, winner: report.final.winner, events: report.final.events.length, voteRounds: report.final.voteRounds.length, review: report.final.review } : undefined }, null, 2));
}
}
void main();
