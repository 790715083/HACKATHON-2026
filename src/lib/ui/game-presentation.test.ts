import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, toPlayerView } from '../game/engine';
import type { Turn, VisibleEvent, VoteRound } from '../game/types';
import { filterHistory, filterVoteRounds, readPlayerNotes, savePotionReason, tallyVotes, targetPresentation, unavailableTargetReason } from './game-presentation';

const view = toPlayerView(createGame({ id: 'presentation-test', seed: 18, preferredRole: 'witch' }));
const vote: Turn = { id: 'vote', actorSeat: 1, kind: 'vote', choices: [2, 3, 4, 5, 6, 7, 8, 9], canSkip: true };
const round: VoteRound = {
  day: 1, round: 1, candidates: [1, 2, 3, 4, 5, 6, 7, 8, 9], executedSeat: null, tiedSeats: [2, 3],
  ballots: [{ seat: 1, targetSeat: 2 }, { seat: 2, targetSeat: 3 }, { seat: 3, targetSeat: 2 }, { seat: 4, targetSeat: 3 }, { seat: 5, targetSeat: null }],
};

test('history filters visible records by exact author and day without interpreting claims as identities', () => {
  const events: VisibleEvent[] = [
    { id: 's', day: 1, type: 'system', text: '讨论开始' },
    { id: 'a', day: 1, type: 'speech', seat: 2, text: '我声称是预言家，怀疑3号。' },
    { id: 'b', day: 2, type: 'speech', seat: 3, text: '2号的声明尚未证实。' },
    { id: 'c', day: 2, type: 'private', seat: 1, text: '仅本人的可见记录' },
  ];
  assert.deepEqual(filterHistory(events, 1, 2).map(event => event.id), ['a']);
  assert.deepEqual(filterHistory(events, null, 2).map(event => event.id), ['a']);
  assert.equal(filterHistory(events, null, null).length, 4);
  assert.equal(filterHistory(events, 3, 2).length, 0);
});

test('vote tally preserves ties, abstentions and full-round totals after player filtering', () => {
  const filtered = filterVoteRounds([round], 1, 1);
  assert.equal(filtered.length, 1);
  assert.deepEqual(tallyVotes(filtered[0]), [
    { targetSeat: 2, count: 2, voters: [1, 3] },
    { targetSeat: 3, count: 2, voters: [2, 4] },
    { targetSeat: null, count: 1, voters: [5] },
  ]);
  assert.equal(filterVoteRounds([round], null, 3).length, 1, 'Receiving a vote also makes a round relevant');
  assert.equal(filterVoteRounds([round], null, 9).length, 0);
  assert.equal(filterVoteRounds([{ ...round, day: 2, round: 2 }], 1, null).length, 0);
  assert.equal(round.ballots.length, 5, 'History must not mutate saved ballots');
});

test('personal notes accept only known seats, stances and claimed roles', () => {
  assert.deepEqual(readPlayerNotes({
    2: { stance: 'suspect', claim: 'seer', role: 'werewolf' },
    3: { stance: 'trusted', claim: 'villager' },
    4: { stance: 'confirmed-wolf', claim: 'admin' },
    5: null, 10: { stance: 'trusted' },
  }), { 2: { stance: 'suspect', claim: 'seer' }, 3: { stance: 'trusted', claim: 'villager' } });
  assert.deepEqual(readPlayerNotes([]), {});
  assert.deepEqual(readPlayerNotes({ 2: { stance: '', claim: '' } }), {}, 'Clearing a note removes the stored entry');
  assert.equal(view.players[1].role, undefined, 'Notes never require or supply a hidden role');
});

test('confirmation includes the chosen seat and name and rejects stale or ineligible targets', () => {
  const decision = targetPresentation(vote, view.players, 5, 'pass');
  assert.equal(decision.valid, true);
  assert.equal(decision.label, '投给 5 号');
  assert.ok(decision.summary.includes(view.players[4].name));
  assert.equal(targetPresentation(vote, view.players, 1, 'pass').valid, false);
  assert.equal(targetPresentation(vote, view.players, null, 'pass').valid, false);
  assert.equal(targetPresentation({ ...vote, kind: 'pk_vote', choices: [2, 3] }, view.players, 5, 'pass').valid, false);
  const dead = view.players.map(player => player.seat === 5 ? { ...player, alive: false } : player);
  assert.equal(targetPresentation(vote, dead, 5, 'pass').valid, false);
});

test('skill confirmation distinguishes seer, wolf attack and hunter actions', () => {
  assert.equal(targetPresentation({ ...vote, kind: 'seer' }, view.players, 3, 'pass').label, '查验 3 号');
  assert.equal(targetPresentation({ ...vote, kind: 'wolf_vote' }, view.players, 3, 'pass').label, '袭击 3 号');
  const hunter = targetPresentation({ ...vote, kind: 'hunter' }, view.players, 3, 'pass');
  assert.equal(hunter.label, '向 3 号开枪');
  assert.equal(hunter.tone, 'danger');
});

test('witch confirmation honors potion availability, victim and poison eligibility', () => {
  const witch: Turn = { ...vote, kind: 'witch', canSave: true, canPoison: true, wolfVictim: 1 };
  assert.equal(targetPresentation(witch, view.players, null, 'save').label, '救下 1 号');
  assert.equal(targetPresentation(witch, view.players, null, 'save').valid, true, 'First-night self-save is allowed by the supplied turn');
  assert.equal(targetPresentation({ ...witch, canSave: false }, view.players, 1, 'save').valid, false);
  assert.equal(targetPresentation(witch, view.players, null, 'poison').valid, false);
  assert.equal(targetPresentation(witch, view.players, 3, 'poison').label, '对 3 号用毒');
  assert.equal(targetPresentation({ ...witch, canPoison: false }, view.players, 3, 'poison').valid, false);
  assert.equal(targetPresentation({ ...witch, canPoison: false, canSave: false }, view.players, null, 'pass').valid, true);
  assert.equal(savePotionReason({ ...witch, canSave: false }, view.me, 2), '只有首夜可以自救');
  assert.equal(savePotionReason({ ...witch, canSave: false }, { ...view.me, antidote: false }, 2), '解药已用完');
});

test('unavailable target explanations use only public eligibility and known teammates', () => {
  assert.equal(unavailableTargetReason(view.players[0], vote, view.me), '本次行动不能选择自己');
  assert.equal(unavailableTargetReason({ ...view.players[2], alive: false }, vote, view.me), '该玩家已出局');
  assert.equal(unavailableTargetReason(view.players[2], { ...vote, kind: 'pk_vote', choices: [2] }, view.me), '本轮只能投给 PK 候选人');
  assert.equal(unavailableTargetReason(view.players[2], { ...vote, kind: 'wolf_vote', choices: [2] }, { ...view.me, role: 'werewolf', teammates: [3] }), '不能袭击狼队友');
  assert.equal(unavailableTargetReason(view.players[2], vote, view.me), null);
});
