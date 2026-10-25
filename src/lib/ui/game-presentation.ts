import { ROLE_NAMES, type PlayerView, type Role, type Turn, type VisibleEvent, type VisiblePlayer, type VoteRound } from '../game/types';

export type PotionChoice = 'save' | 'poison' | 'pass';
export type PlayerNote = { stance: '' | 'suspect' | 'trusted'; claim: Role | '' };
export type PlayerNotes = Record<number, PlayerNote>;

export function readPlayerNotes(value: unknown): PlayerNotes {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const notes: PlayerNotes = {};
  for (const [key, item] of Object.entries(value)) {
    const seat = Number(key);
    if (!Number.isInteger(seat) || seat < 1 || seat > 9 || !item || typeof item !== 'object') continue;
    const note = item as Partial<PlayerNote>;
    const stance = note.stance === 'suspect' || note.stance === 'trusted' ? note.stance : '';
    const claim = typeof note.claim === 'string' && Object.hasOwn(ROLE_NAMES, note.claim) ? note.claim as Role : '';
    if (stance || claim) notes[seat] = { stance, claim };
  }
  return notes;
}

export function filterHistory(events: VisibleEvent[], day: number | null, seat: number | null) {
  return events.filter(event => (day === null || event.day === day) && (seat === null || event.seat === seat));
}

export function filterVoteRounds(rounds: VoteRound[], day: number | null, seat: number | null) {
  return rounds.filter(round => (day === null || round.day === day) &&
    (seat === null || round.ballots.some(ballot => ballot.seat === seat || ballot.targetSeat === seat)));
}

// Always tally the complete round, even when the history is filtered by a player.
export function tallyVotes(round: VoteRound) {
  const groups = new Map<number | null, number[]>();
  for (const ballot of round.ballots) {
    const voters = groups.get(ballot.targetSeat) ?? [];
    voters.push(ballot.seat);
    groups.set(ballot.targetSeat, voters);
  }
  return [...groups].map(([targetSeat, voters]) => ({ targetSeat, voters, count: voters.length }))
    .sort((a, b) => b.count - a.count || (a.targetSeat ?? Infinity) - (b.targetSeat ?? Infinity));
}

export function unavailableTargetReason(player: VisiblePlayer, turn: Turn, me: PlayerView['me']): string | null {
  if (!player.alive) return '该玩家已出局';
  if (turn.choices.includes(player.seat)) return null;
  if (player.seat === me.seat) return '本次行动不能选择自己';
  if (turn.kind === 'wolf_vote' && me.teammates.includes(player.seat)) return '不能袭击狼队友';
  if (turn.kind === 'pk_vote') return '本轮只能投给 PK 候选人';
  return '该玩家不在本轮可选范围';
}

export function savePotionReason(turn: Turn, me: PlayerView['me'], day: number) {
  if (turn.canSave) return `救下 ${turn.wolfVictim} 号玩家`;
  if (!me.antidote) return '解药已用完';
  if (day > 1 && turn.wolfVictim === me.seat) return '只有首夜可以自救';
  return '今夜没有可救的狼刀目标';
}

export function targetPresentation(turn: Turn, players: VisiblePlayer[], selected: number | null, potion: PotionChoice) {
  const seat = turn.kind === 'witch' && potion === 'save' ? turn.wolfVictim : selected;
  const player = players.find(item => item.seat === seat);
  const target = player ? `${player.seat} 号 · ${player.name}` : '';
  const validTarget = !!player?.alive && turn.choices.includes(player.seat);
  if (turn.kind === 'witch') {
    if (potion === 'pass') return { valid: true, label: '保留药剂', summary: '今夜不使用解药或毒药。', tone: 'neutral' };
    if (potion === 'save') return {
      valid: !!turn.canSave && !!player?.alive,
      label: player ? `救下 ${player.seat} 号` : '选择救人目标',
      summary: turn.canSave && player ? `你将用解药救下 ${target}，仅解除狼刀伤害。` : '今夜不能使用解药。', tone: 'safe',
    };
    return {
      valid: !!turn.canPoison && validTarget,
      label: validTarget ? `对 ${seat} 号用毒` : '选择毒药目标',
      summary: !turn.canPoison ? '毒药已用完。' : validTarget ? `你将对 ${target} 使用毒药。` : '请从存活玩家中选择毒药目标。', tone: 'danger',
    };
  }
  const verb = turn.kind === 'seer' ? '查验' : turn.kind === 'wolf_vote' ? '袭击' : turn.kind === 'hunter' ? '开枪' : '投票';
  const label = !validTarget ? `选择${verb}目标` : turn.kind === 'vote' || turn.kind === 'pk_vote' ? `投给 ${seat} 号` :
    turn.kind === 'hunter' ? `向 ${seat} 号开枪` : `${verb} ${seat} 号`;
  return {
    valid: validTarget, label,
    summary: validTarget ? `已选择 ${target}。确认后提交${verb}，本回合不能更改。` : '点击可选玩家或下方号码，选择目标后再确认。',
    tone: turn.kind === 'hunter' || turn.kind === 'wolf_vote' ? 'danger' : 'neutral',
  };
}
