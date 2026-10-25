import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, checkWinner, createGame, getAgentContext, getNextTurn, toPlayerView } from './engine';
import type { GameAction, GameState, Role, Turn } from './types';

function fixture(): GameState {
  const state = createGame({ id: 'fixture', seed: 42 });
  const roles: Role[] = ['villager', 'werewolf', 'werewolf', 'werewolf', 'villager', 'villager', 'seer', 'witch', 'hunter'];
  state.players.forEach((p, i) => { p.role = roles[i]; });
  state.queue = [2, 3, 4].map((actorSeat) => ({ id: `fixture:d1:wolf_chat:wolf_chat:${actorSeat}`, actorSeat, kind: 'wolf_chat', choices: [], canSkip: false }));
  return state;
}

function act(state: GameState, overrides: Partial<GameAction> = {}): GameState {
  const current = getNextTurn(state)!;
  assert.ok(current, 'Expected a playable turn');
  const defaults: Partial<GameAction> = ['speech', 'pk_speech', 'last_words', 'wolf_chat'].includes(current.kind)
    ? { text: `我是 ${current.actorSeat} 号，先核对公开发言与票型。` }
    : current.kind === 'witch' ? { use: 'pass' }
    : { targetSeat: current.kind === 'wolf_vote' ? 5 : current.kind === 'seer' ? current.choices[0] : null };
  return applyAction(state, { turnId: current.id, actorSeat: current.actorSeat, kind: current.kind, ...defaults, ...overrides });
}

function until(state: GameState, predicate: (s: GameState, t: Turn | null) => boolean, choose?: (s: GameState, t: Turn) => Partial<GameAction>): GameState {
  for (let n = 0; n < 250; n++) {
    const current = getNextTurn(state);
    if (predicate(state, current)) return state;
    assert.ok(current, `Game ended before predicate, phase=${state.phase}`);
    state = act(state, choose?.(state, current) || {});
  }
  throw new Error('Fixture exceeded turn limit');
}

test('createGame produces repeatable role assignments, all preferred identities, and stable personas', () => {
  const a = createGame({ id: 'a', seed: 88 });
  const b = createGame({ id: 'b', seed: 88 });
  assert.deepEqual(a.players, b.players);
  assert.equal(a.players.filter((p) => p.role === 'werewolf').length, 3);
  assert.equal(a.players.filter((p) => p.role === 'villager').length, 3);
  assert.equal(a.players.filter((p) => p.isHuman).length, 1);
  assert.equal(new Set(a.players.map((p) => p.persona)).size, 9);
  for (const role of ['villager', 'werewolf', 'seer', 'witch', 'hunter'] as const) {
    assert.equal(createGame({ preferredRole: role, seed: 9 }).players[0].role, role);
  }
  assert.equal(createGame({ name: '  测试旅人  ' }).players[0].name, '测试旅人');
  assert.throws(() => createGame({ preferredRole: 'not-a-role' as Role }), /身份无效/);
});

test('ordinary human view redacts all other roles, private actions and night actor identities', () => {
  const state = fixture();
  state.events.push(
    { id: 'seer-secret', day: 1, type: 'private', visibility: 'private', visibleTo: [7], text: '仅预言家知道的结果' },
    { id: 'wolf-secret', day: 1, type: 'wolf_chat', visibility: 'wolves', text: '仅狼队知道的计划' },
  );
  const view = toPlayerView(state);
  assert.equal(view.me.role, 'villager');
  assert.ok(view.players.slice(1).every((p) => p.role === undefined));
  assert.equal(view.turn, null);
  assert.equal(view.currentSpeaker, null);
  assert.ok(!JSON.stringify(view).includes('仅预言家'));
  assert.ok(!JSON.stringify(view).includes('仅狼队'));
  assert.ok(!('seed' in view));
  assert.ok(!('queue' in view));
  assert.ok(!('night' in view));
});

test('wolves see exactly their teammates; endgame reveals roles but not other private events', () => {
  const state = createGame({ preferredRole: 'werewolf', seed: 4 });
  const view = toPlayerView(state);
  assert.equal(view.me.teammates.length, 2);
  assert.equal(view.players.filter((p) => p.role).length, 3);
  state.phase = 'ended'; state.winner = 'wolves'; state.queue = [];
  assert.equal(toPlayerView(state).players.filter((p) => p.role).length, 9);
});

test('agent contexts include public speech and historic votes but only their own private information', () => {
  const state = fixture();
  state.events.push(
    { id: 'public', day: 1, type: 'speech', seat: 5, visibility: 'public', text: '我声称自己是预言家，2 号查杀。' },
    { id: 'seer', day: 1, type: 'private', seat: 7, visibility: 'private', visibleTo: [7], text: 'SEER_ONLY' },
    { id: 'witch', day: 1, type: 'private', seat: 8, visibility: 'private', visibleTo: [8], text: 'WITCH_ONLY' },
    { id: 'wolves', day: 1, type: 'wolf_chat', visibility: 'wolves', text: 'WOLF_ONLY' },
  );
  state.players[4].alive = false;
  state.voteRounds.push({ day: 1, round: 1, ballots: [{ seat: 5, targetSeat: 2 }], candidates: [2, 5], executedSeat: 5, tiedSeats: [] });
  const villager = getAgentContext(state, 6);
  assert.match(villager, /我声称自己是预言家/);
  assert.match(villager, /玩家声明/);
  assert.match(villager, /voteRounds/);
  assert.ok(!villager.includes('SEER_ONLY') && !villager.includes('WITCH_ONLY') && !villager.includes('WOLF_ONLY'));
  assert.match(getAgentContext(state, 7), /SEER_ONLY/);
  assert.ok(!getAgentContext(state, 7).includes('WITCH_ONLY'));
  assert.match(getAgentContext(state, 2), /WOLF_ONLY/);
  assert.ok(!getAgentContext(state, 2).includes('SEER_ONLY'));
});

test('actions are immutable, stale turns rejected, paused games rejected', () => {
  const before = fixture();
  const copy = structuredClone(before);
  const after = act(before);
  assert.deepEqual(before, copy);
  assert.equal(after.revision, before.revision + 1);
  assert.notEqual(getNextTurn(after)?.id, getNextTurn(before)?.id);
  const old = getNextTurn(before)!;
  assert.throws(() => applyAction(after, { turnId: old.id, actorSeat: old.actorSeat, kind: old.kind, text: '重复' }), /回合已经变化/);
  before.paused = true;
  assert.throws(() => act(before), /暂停/);
});

test('wolf votes forbid self/team targets and majority attack is hidden until dawn', () => {
  let state = until(fixture(), (_, current) => current?.kind === 'wolf_vote');
  assert.deepEqual(getNextTurn(state)?.choices, [1, 5, 6, 7, 8, 9]);
  assert.throws(() => act(state, { targetSeat: 2 }), /不可选择/);
  state = act(state, { targetSeat: 5 });
  state = act(state, { targetSeat: 6 });
  state = act(state, { targetSeat: 5 });
  assert.equal(state.night.victim, 5);
  assert.ok(state.players[4].alive);
  assert.ok(!JSON.stringify(toPlayerView(state)).includes('最终选择袭击'));
  state = until(state, (s) => s.phase === 'day');
  assert.equal(state.players[4].alive, false);
  const announcement = toPlayerView(state).events.find((e) => e.type === 'death')!;
  assert.match(announcement.text, /5 号/);
  assert.ok(!announcement.text.includes('狼刀'));
});

test('wolf tie choice is deterministic for a saved random seed', () => {
  let state = until(fixture(), (_, current) => current?.kind === 'wolf_vote');
  state = act(state, { targetSeat: 5 });
  state = act(state, { targetSeat: 6 });
  const a = act(state, { targetSeat: 7 });
  const b = act(structuredClone(state), { targetSeat: 7 });
  assert.equal(a.night.victim, b.night.victim);
  assert.ok([5, 6, 7].includes(a.night.victim!));
});

test('witch may save herself only on night one and cannot reuse a completed potion turn', () => {
  let state = until(fixture(), (_, current) => current?.kind === 'witch', (_, current) => current.kind === 'wolf_vote' ? { targetSeat: 8 } : {});
  assert.equal(getNextTurn(state)?.canSave, true);
  const before = structuredClone(state);
  state = act(state, { use: 'save' });
  assert.equal(state.witch.antidote, false);
  const stale = getNextTurn(before)!;
  assert.throws(() => applyAction(state, { turnId: stale.id, actorSeat: 8, kind: 'witch', use: 'poison', targetSeat: 2 }), /回合已经变化/);
  state = until(state, (s) => s.phase === 'day');
  assert.ok(state.players[7].alive);
  assert.ok(state.events.some((e) => e.text.includes('平安夜')));

  let second = fixture(); second.day = 2;
  second = until(second, (_, current) => current?.kind === 'witch', (_, current) => current.kind === 'wolf_vote' ? { targetSeat: 8 } : {});
  assert.equal(getNextTurn(second)?.wolfVictim, 8);
  assert.equal(getNextTurn(second)?.canSave, false);
  assert.throws(() => act(second, { use: 'save' }), /首夜可以自救/);
});

test('witch without antidote cannot learn the wolf victim, and poison cannot target self', () => {
  const state = until(fixture(), (_, current) => current?.kind === 'witch');
  state.witch.antidote = false;
  assert.equal(getNextTurn(state)?.wolfVictim, undefined);
  assert.equal(getNextTurn(state)?.canSave, false);
  assert.throws(() => act(state, { use: 'poison', targetSeat: 8 }), /不可选择/);
});

test('poison kills a wolf and wolf-poison overlap disables hunter shooting', () => {
  let state = until(fixture(), (_, current) => current?.kind === 'witch', (_, current) => current.kind === 'wolf_vote' ? { targetSeat: 9 } : {});
  state = act(state, { use: 'poison', targetSeat: 9 });
  state = until(state, (s) => s.phase === 'day');
  assert.equal(state.players[8].deathCause, 'poison');
  assert.ok(!state.queue.some((t) => t.kind === 'hunter'));
  assert.equal(state.queue.filter((t) => t.kind === 'last_words').length, 1);

  let poisonWolf = until(fixture(), (_, current) => current?.kind === 'witch');
  poisonWolf = act(poisonWolf, { use: 'poison', targetSeat: 2 });
  poisonWolf = until(poisonWolf, (s) => s.phase === 'day');
  assert.equal(poisonWolf.players[1].alive, false);
  assert.equal(poisonWolf.players[4].alive, false);
});

test('seer checks are private, reject self, and return faction rather than exact god role', () => {
  let state = until(fixture(), (_, current) => current?.kind === 'seer');
  assert.throws(() => act(state, { targetSeat: 7 }), /不可选择/);
  state = act(state, { targetSeat: 8 });
  const result = state.events.find((e) => e.type === 'private' && e.text.includes('查验'))!;
  assert.match(result.text, /好人阵营/);
  assert.ok(!result.text.includes('女巫'));
  assert.ok(!toPlayerView(state).events.some((e) => e.id === result.id));
  assert.match(getAgentContext(state, 7), /好人阵营/);
});

test('hunter shot resolves before victory and simultaneous extinction is a draw', () => {
  let state = fixture();
  for (const seat of [3, 4, 7, 8]) state.players[seat - 1].alive = false;
  state.queue = state.queue.filter((t) => t.actorSeat === 2);
  state = until(state, (_, current) => current?.kind === 'hunter', (_, current) => current.kind === 'wolf_vote' ? { targetSeat: 9 } : {});
  assert.equal(state.phase, 'day');
  assert.equal(checkWinner(state), null);
  state = act(state, { targetSeat: 2 });
  assert.equal(state.winner, 'draw');
  assert.equal(state.phase, 'ended');
  assert.equal(getNextTurn(state), null);
  assert.equal(toPlayerView(state).players.filter((p) => p.role).length, 9);
});

test('hunter can decline shot and the pending god extinction then awards wolves victory', () => {
  let state = fixture();
  state.players[6].alive = false; state.players[7].alive = false;
  state = until(state, (_, current) => current?.kind === 'hunter', (_, current) => current.kind === 'wolf_vote' ? { targetSeat: 9 } : {});
  state = act(state, { targetSeat: null });
  assert.equal(state.winner, 'wolves');
});

test('first vote hides ballots until complete, forbids self/dead targets and supports abstention', () => {
  let state = until(fixture(), (_, current) => current?.kind === 'vote');
  const current = getNextTurn(state)!;
  assert.throws(() => act(state, { targetSeat: current.actorSeat }), /不可选择/);
  assert.throws(() => act(state, { targetSeat: 5 }), /不可选择/);
  state = act(state, { targetSeat: null });
  assert.deepEqual(toPlayerView(state).voteRounds, []);
  state = until(state, (s) => s.day === 2);
  assert.equal(state.voteRounds.length, 1);
  assert.ok(state.voteRounds[0].ballots.every((b) => b.targetSeat === null));
  assert.equal(state.voteRounds[0].executedSeat, null);
});

test('one PK round excludes candidates from voting and second tie ends day without execution', () => {
  let state = until(fixture(), (_, current) => current?.kind === 'vote');
  const ballots: Record<number, number | null> = { 1: 2, 2: 1, 3: 2, 4: 1, 6: null, 7: null, 8: null, 9: null };
  state = until(state, (_, current) => current?.kind === 'pk_speech', (_, current) => ({ targetSeat: ballots[current.actorSeat] }));
  assert.deepEqual(state.pkCandidates, [1, 2]);
  assert.deepEqual(state.queue.map((t) => t.actorSeat), [1, 2]);
  state = until(state, (_, current) => current?.kind === 'pk_vote');
  assert.ok(state.queue.every((t) => ![1, 2].includes(t.actorSeat)));
  assert.deepEqual(getNextTurn(state)?.choices, [1, 2]);
  state = until(state, (s) => s.day === 2, (_, current) => ({ targetSeat: current.actorSeat === 3 ? 1 : current.actorSeat === 4 ? 2 : null }));
  assert.equal(state.voteRounds.length, 2);
  assert.deepEqual(state.voteRounds[1].tiedSeats, [1, 2]);
  assert.equal(state.players[0].alive, true);
  assert.equal(state.players[1].alive, true);
});

test('exiled hunter gives last words, shoots, then resumes next night without a second last-words round', () => {
  let state = until(fixture(), (_, current) => current?.kind === 'vote');
  state = until(state, (_, current) => current?.kind === 'last_words', (_, current) => ({ targetSeat: current.actorSeat === 9 ? 2 : 9 }));
  assert.equal(getNextTurn(state)?.actorSeat, 9);
  assert.equal(state.players[8].deathCause, 'execution');
  state = act(state);
  assert.equal(getNextTurn(state)?.kind, 'hunter');
  state = act(state, { targetSeat: 2 });
  assert.equal(state.day, 2);
  assert.equal(state.phase, 'night');
  assert.equal(state.players[1].deathCause, 'shot');
});

test('late-night victims get no last words, dead human can continue watching through end', () => {
  let state = until(fixture(), (s) => s.day === 2);
  state = until(state, (s) => s.day === 2 && s.phase === 'day', (_, current) => current.kind === 'wolf_vote' ? { targetSeat: 1 } : {});
  assert.equal(toPlayerView(state).me.alive, false);
  assert.ok(!state.queue.some((t) => t.kind === 'last_words'));
  for (let n = 0; n < 300 && state.phase !== 'ended'; n++) {
    const current = getNextTurn(state)!;
    const target = current.kind === 'wolf_vote' ? current.choices[0] : undefined;
    state = act(state, target === undefined ? {} : { targetSeat: target });
  }
  assert.equal(state.phase, 'ended');
  assert.equal(state.winner, 'wolves');
});

test('checkWinner is elimination-of-side rather than wolf parity', () => {
  const state = fixture();
  for (const seat of [1, 5]) state.players[seat - 1].alive = false;
  assert.equal(state.players.filter((p) => p.alive && p.role !== 'werewolf').length, 4);
  state.players[6].alive = false;
  assert.equal(checkWinner(state), null); // 3 wolves, 3 good players; both good sides survive.
  state.players[5].alive = false;
  assert.equal(checkWinner(state), 'wolves');
  state.players[1].alive = false; state.players[2].alive = false; state.players[3].alive = false;
  assert.equal(checkWinner(state), 'draw');
});

test('JSON checkpoint survives reload and yields the identical next action result', () => {
  let state = until(fixture(), (_, current) => current?.kind === 'witch');
  state = act(state, { use: 'poison', targetSeat: 2 });
  const restored: GameState = JSON.parse(JSON.stringify(state));
  assert.deepEqual(getNextTurn(restored), getNextTurn(state));
  const a = act(state, { targetSeat: 3 });
  const b = act(restored, { targetSeat: 3 });
  a.updatedAt = ''; b.updatedAt = '';
  assert.deepEqual(a, b);
});

test('250 seeded games across all human roles preserve secrecy, potion limits, legal turns and deterministic restart', () => {
  for (const preferredRole of ['villager', 'werewolf', 'seer', 'witch', 'hunter'] as const) {
  for (let seed = 1; seed <= 50; seed++) {
    let state = createGame({ id: `simulation-${preferredRole}-${seed}`, seed, preferredRole });
    let pickSeed = seed;
    function pick(count: number): number {
      pickSeed = (Math.imul(pickSeed, 1664525) + 1013904223) >>> 0;
      return pickSeed % count;
    }
    let steps = 0;
    for (; state.phase !== 'ended' && steps < 500; steps++) {
      const current = getNextTurn(state)!;
      assert.ok(current, `Missing turn for seed ${seed}`);
      assert.ok(state.players[current.actorSeat - 1].alive || ['last_words', 'hunter'].includes(current.kind), `Dead actor in ${current.kind}`);
      assert.ok(current.choices.every((seat) => state.players[seat - 1].alive && seat !== current.actorSeat));
      if (current.kind === 'pk_vote') {
        assert.ok(!state.pkCandidates.includes(current.actorSeat));
        assert.ok(current.choices.every((seat) => state.pkCandidates.includes(seat)));
      }
      if (current.kind === 'wolf_vote') assert.ok(current.choices.every((seat) => state.players[seat - 1].role !== 'werewolf'));
      const target = current.choices[pick(current.choices.length || 1)];
      let action: Partial<GameAction>;
      if (['speech', 'pk_speech', 'last_words', 'wolf_chat'].includes(current.kind)) action = { text: '我会根据已公开发言和票型判断。' };
      else if (current.kind === 'witch') action = current.canSave && pick(2) === 0 ? { use: 'save' } : current.canPoison && pick(3) === 0 ? { use: 'poison', targetSeat: target } : { use: 'pass' };
      else action = { targetSeat: current.canSkip && pick(5) === 0 ? null : target };
      const next = act(state, action);
      const restored: GameState = JSON.parse(JSON.stringify(state));
      assert.deepEqual(getNextTurn(restored), current);
      const resumed = act(restored, action);
      assert.deepEqual({ ...resumed, updatedAt: '' }, { ...next, updatedAt: '' }, `Restart diverged for seed ${seed}, role ${preferredRole}, turn ${steps}`);
      assert.equal(next.revision, state.revision + 1);
      assert.equal(new Set(next.events.map((e) => e.id)).size, next.events.length);
      assert.ok(state.witch.antidote || !next.witch.antidote, 'Antidote was recreated');
      assert.ok(state.witch.poison || !next.witch.poison, 'Poison was recreated');
      assert.ok(next.events.filter((e) => e.type === 'private' && e.text.includes('你用解药')).length <= 1);
      assert.ok(next.events.filter((e) => e.type === 'private' && e.text.includes('使用了毒药')).length <= 1);
      const view = toPlayerView(next);
      assert.ok(view.players.every((p) => p.role === undefined || p.seat === 1 || view.me.teammates.includes(p.seat) || next.phase === 'ended'));
      for (const item of view.events) {
        const source = next.events.find((e) => e.id === item.id)!;
        assert.ok(source.visibility === 'public' || (source.visibility === 'private' && source.visibleTo?.includes(1)) || (source.visibility === 'wolves' && preferredRole === 'werewolf'), 'Private event leaked to browser');
      }
      if (next.phase === 'night') assert.equal(view.currentSpeaker, null);
      state = JSON.parse(JSON.stringify(next));
    }
    assert.equal(state.phase, 'ended', `Seed ${seed} exceeded ${steps} actions`);
    assert.ok(state.winner);
    assert.equal(state.queue.length, 0);
  }
  }
});
