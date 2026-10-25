import { ROLE_NAMES, type GameAction, type GameEvent, type GameState, type Player, type PlayerView, type Role, type Turn, type TurnKind, type VoteRound, type Winner } from './types';

const ROLES: Role[] = ['werewolf', 'werewolf', 'werewolf', 'villager', 'villager', 'villager', 'seer', 'witch', 'hunter'];
const PERSONAS = [
  ['沈砚', '冷静的旧书店主，习惯按时间线核对细节，发言简练，不轻信权威。'],
  ['林雾', '敏锐的摄影师，关注措辞与反应，愿意提出大胆猜想，也会承认判断失误。'],
  ['许知夏', '温和而坚定的医生，喜欢追问证据，表达直接，会保护缺乏发言机会的人。'],
  ['陈渡', '健谈的电台主持，擅长总结争议，偶尔开轻松玩笑，但有自己的投票立场。'],
  ['苏晚', '谨慎的档案管理员，重视前后口径和历次票型，不轻易透露自己的判断。'],
  ['顾行舟', '果断的户外向导，愿意带队和承担压力，遇到反证会重新调整推断。'],
  ['唐梨', '机灵的插画师，语言活泼，善于察觉结盟关系，喜欢用简短比喻表达怀疑。'],
  ['周予', '寡言的数学老师，重视概率和行动一致性，避免没有事实支持的绝对判断。'],
] as const;
const SPEECH_KINDS = new Set<TurnKind>(['speech', 'pk_speech', 'last_words', 'wolf_chat']);
const PUBLIC_SPEECH_KINDS = new Set<TurnKind>(['speech', 'pk_speech', 'last_words']);

function random(state: GameState): number {
  let x = state.seed >>> 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  state.seed = (x >>> 0) || 0x6d2b79f5;
  return state.seed / 0x100000000;
}

function shuffled<T>(items: T[], state: GameState): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random(state) * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function event(state: GameState, type: GameEvent['type'], text: string, options: Partial<Pick<GameEvent, 'seat' | 'visibility' | 'visibleTo'>> = {}): void {
  state.events.push({ id: `${state.id}:e${state.events.length + 1}`, day: state.day, type, text, visibility: 'public', ...options });
}

function player(state: GameState, seat: number): Player {
  const found = state.players.find((p) => p.seat === seat);
  if (!found) throw new Error('玩家不存在。');
  return found;
}

function alive(state: GameState): Player[] { return state.players.filter((p) => p.alive); }

function turn(state: GameState, kind: TurnKind, actorSeat: number): Turn {
  const actor = player(state, actorSeat);
  const choices = alive(state).filter((p) => p.seat !== actorSeat && (kind !== 'wolf_vote' || p.role !== 'werewolf') && (kind !== 'pk_vote' || state.pkCandidates.includes(p.seat))).map((p) => p.seat);
  const next: Turn = { id: `${state.id}:d${state.day}:${state.stage}:${kind}:${actorSeat}`, kind, actorSeat, choices, canSkip: ['witch', 'hunter', 'vote', 'pk_vote'].includes(kind) };
  if (kind === 'witch') {
    next.canSave = state.witch.antidote && state.night.victim !== null && (state.day === 1 || state.night.victim !== actorSeat);
    next.canPoison = state.witch.poison;
    if (state.witch.antidote && state.night.victim !== null) next.wolfVictim = state.night.victim;
  }
  return next;
}

function setStage(state: GameState, stage: string, kind: TurnKind, actors: Player[]): void {
  state.stage = stage;
  state.queue = actors.map((p) => turn(state, kind, p.seat));
}

function startNight(state: GameState): void {
  state.phase = 'night';
  state.night = { wolfVotes: {}, victim: null, saved: false, poison: null };
  state.votes = {}; state.pkCandidates = [];
  event(state, 'system', `第 ${state.day} 夜降临。天黑请闭眼，夜间行动仅对相应身份可见。`);
  setStage(state, 'wolf_chat', 'wolf_chat', alive(state).filter((p) => p.role === 'werewolf'));
}

function startDaySpeech(state: GameState): void {
  const people = alive(state);
  const start = Math.floor(random(state) * people.length);
  const ordered = [...people.slice(start), ...people.slice(0, start)];
  event(state, 'system', `第 ${state.day} 天讨论开始。请按座位顺序发言，陈述你观察到的线索。`);
  setStage(state, 'day_speech', 'speech', ordered);
}

function death(state: GameState, seat: number, cause: Player['deathCause']): boolean {
  const target = player(state, seat);
  if (!target.alive) return false;
  target.alive = false; target.deathCause = cause;
  return true;
}

function addInterrupts(state: GameState, deaths: Player[], lastWords: boolean, continuation: 'start_day' | 'next_night'): void {
  state.stage = 'interrupts'; state.afterInterrupt = continuation; state.queue = [];
  if (lastWords) state.queue.push(...deaths.map((p) => turn(state, 'last_words', p.seat)));
  state.queue.push(...deaths.filter((p) => p.role === 'hunter' && p.deathCause !== 'poison').map((p) => turn(state, 'hunter', p.seat)));
}

function resolveNight(state: GameState): void {
  const deaths: Player[] = [];
  // Poison takes precedence when both sources hit one player: an antidote never cures poison.
  const causes = new Map<number, NonNullable<Player['deathCause']>>();
  if (state.night.victim !== null && !state.night.saved) causes.set(state.night.victim, 'wolf');
  if (state.night.poison !== null) causes.set(state.night.poison, 'poison');
  for (const [seat, cause] of [...causes].sort(([a], [b]) => a - b)) {
    if (death(state, seat, cause)) deaths.push(player(state, seat));
  }
  state.phase = 'day';
  if (deaths.length) {
    event(state, 'death', `天亮了，昨夜出局的是 ${deaths.map((p) => `${p.seat} 号 ${p.name}`).join('、')}。身份与死因暂不公开。`);
  } else {
    event(state, 'system', '天亮了，昨夜是平安夜。无人出局，不代表任何身份已被证实。');
  }
  addInterrupts(state, deaths, state.day === 1, 'start_day');
}

function chooseWolfVictim(state: GameState): number | null {
  const counts = new Map<number, number>();
  for (const value of Object.values(state.night.wolfVotes)) counts.set(value, (counts.get(value) || 0) + 1);
  const max = Math.max(0, ...counts.values());
  const tied = [...counts].filter(([, n]) => n === max).map(([seat]) => seat).sort((a, b) => a - b);
  return tied.length ? tied[Math.floor(random(state) * tied.length)] : null;
}

function resolveVote(state: GameState, isPk: boolean): void {
  const counts = new Map<number, number>();
  for (const value of Object.values(state.votes)) if (value !== null) counts.set(value, (counts.get(value) || 0) + 1);
  const max = Math.max(0, ...counts.values());
  const tied = [...counts].filter(([, count]) => count === max).map(([seat]) => seat).sort((a, b) => a - b);
  const executed = tied.length === 1 ? tied[0] : null;
  const round: VoteRound = {
    day: state.day, round: isPk ? 2 : 1,
    ballots: Object.entries(state.votes).map(([seat, targetSeat]) => ({ seat: Number(seat), targetSeat })).sort((a, b) => a.seat - b.seat),
    candidates: isPk ? [...state.pkCandidates] : alive(state).map((p) => p.seat),
    executedSeat: executed, tiedSeats: tied.length > 1 ? tied : [],
  };
  state.voteRounds.push(round);
  const ballotText = round.ballots.map((b) => `${b.seat}号→${b.targetSeat === null ? '弃票' : `${b.targetSeat}号`}`).join('，');
  event(state, 'vote_result', `第 ${state.day} 天${isPk ? ' PK 复投' : '放逐投票'}：${ballotText}。`);
  state.votes = {};
  if (executed !== null) {
    death(state, executed, 'execution');
    event(state, 'death', `${executed} 号 ${player(state, executed).name} 被放逐出局，请发表遗言。`);
    addInterrupts(state, [player(state, executed)], true, 'next_night');
  } else if (tied.length > 1 && !isPk) {
    state.pkCandidates = tied;
    event(state, 'system', `${tied.map((seat) => `${seat} 号`).join('、')} 最高票相同，进入一次 PK 发言。其余存活玩家随后复投。`);
    setStage(state, 'pk_speech', 'pk_speech', tied.map((seat) => player(state, seat)));
  } else {
    event(state, 'system', tied.length ? 'PK 再次平票，今天无人被放逐。' : '所有人弃票，今天无人被放逐。');
    addInterrupts(state, [], false, 'next_night');
  }
}

export function checkWinner(state: GameState): Winner | null {
  if (state.queue.some((t) => t.kind === 'hunter')) return null;
  const living = alive(state);
  const villageWins = !living.some((p) => p.role === 'werewolf');
  const wolvesWin = !living.some((p) => p.role === 'villager') || !living.some((p) => p.role !== 'villager' && p.role !== 'werewolf');
  if (villageWins && wolvesWin) return 'draw';
  if (villageWins) return 'village';
  if (wolvesWin) return 'wolves';
  return null;
}

function finishOrContinue(state: GameState): void {
  const winner = checkWinner(state);
  if (winner) {
    state.winner = winner; state.phase = 'ended'; state.stage = 'ended'; state.queue = [];
    event(state, 'system', winner === 'draw' ? '双方同时达成胜利条件，本局平局。全部身份现已揭晓。' : `${winner === 'village' ? '好人阵营' : '狼人阵营'}获胜。全部身份现已揭晓。`);
    return;
  }
  if (state.afterInterrupt === 'start_day') startDaySpeech(state);
  else { state.day += 1; startNight(state); }
}

function advanceEmptyStages(state: GameState): void {
  let limit = 0;
  while (!state.queue.length && state.phase !== 'ended') {
    if (++limit > 40) throw new Error('游戏阶段无法继续。');
    switch (state.stage) {
      case 'wolf_chat': setStage(state, 'wolf_vote', 'wolf_vote', alive(state).filter((p) => p.role === 'werewolf')); break;
      case 'wolf_vote': {
        state.night.victim = chooseWolfVictim(state);
        if (state.night.victim !== null) event(state, 'wolf_chat', `狼队最终选择袭击 ${state.night.victim} 号。`, { visibility: 'wolves' });
        setStage(state, 'witch', 'witch', alive(state).filter((p) => p.role === 'witch'));
        break;
      }
      case 'witch': setStage(state, 'seer', 'seer', alive(state).filter((p) => p.role === 'seer')); break;
      case 'seer': resolveNight(state); break;
      case 'interrupts': finishOrContinue(state); break;
      case 'day_speech': setStage(state, 'day_vote', 'vote', alive(state)); break;
      case 'day_vote': resolveVote(state, false); break;
      case 'pk_speech': setStage(state, 'pk_vote', 'pk_vote', alive(state).filter((p) => !state.pkCandidates.includes(p.seat))); break;
      case 'pk_vote': resolveVote(state, true); break;
      default: throw new Error(`未知游戏阶段：${state.stage}`);
    }
  }
}

export function createGame(options: { id?: string; seed?: number; preferredRole?: Role | 'random'; name?: string } = {}): GameState {
  if (options.preferredRole && options.preferredRole !== 'random' && !ROLES.includes(options.preferredRole)) throw new Error('身份无效。');
  const now = new Date().toISOString();
  const state: GameState = {
    schemaVersion: 1, id: options.id || crypto.randomUUID(), seed: (options.seed ?? crypto.getRandomValues(new Uint32Array(1))[0]) >>> 0 || 1,
    revision: 0, day: 1, phase: 'night', paused: false, winner: null,
    players: [], events: [], queue: [], voteRounds: [],
    night: { wolfVotes: {}, victim: null, saved: false, poison: null }, witch: { antidote: true, poison: true },
    votes: {}, pkCandidates: [], stage: '', afterInterrupt: '', processedActions: [], createdAt: now, updatedAt: now,
  };
  const roles = shuffled(ROLES, state);
  if (options.preferredRole && options.preferredRole !== 'random') {
    const index = roles.indexOf(options.preferredRole);
    [roles[0], roles[index]] = [roles[index], roles[0]];
  }
  state.players = roles.map((role, i) => ({
    seat: i + 1, name: i === 0 ? (options.name?.trim().slice(0, 20) || '旅行者') : PERSONAS[i - 1][0],
    role, alive: true, isHuman: i === 0, persona: i === 0 ? '来到月下小镇的旅行者。' : PERSONAS[i - 1][1], avatar: i,
  }));
  event(state, 'system', '九位旅人已经入席。三名狼人、三名村民、预言家、女巫与猎人，真相藏在每一次发言中。');
  startNight(state);
  return state;
}

export function getNextTurn(state: GameState): Turn | null {
  if (state.phase === 'ended' || !state.queue.length) return null;
  const first = state.queue[0];
  return { ...turn(state, first.kind, first.actorSeat), id: first.id };
}

function validateTarget(current: Turn, action: GameAction, allowNull: boolean): number | null {
  if (action.targetSeat === null || action.targetSeat === undefined) {
    if (allowNull) return null;
    throw new Error('请选择一个有效目标。');
  }
  if (!Number.isInteger(action.targetSeat) || !current.choices.includes(action.targetSeat)) throw new Error('此目标当前不可选择。');
  return action.targetSeat;
}

export function applyAction(original: GameState, action: GameAction): GameState {
  if (original.paused) throw new Error('游戏已暂停。');
  if (original.phase === 'ended') throw new Error('本局已经结束。');
  const current = getNextTurn(original);
  if (!current || current.id !== action.turnId || current.actorSeat !== action.actorSeat || current.kind !== action.kind) throw new Error('该回合已经变化，请刷新后重试。');
  const actor = player(original, action.actorSeat);
  if (!actor.alive && current.kind !== 'last_words' && current.kind !== 'hunter') throw new Error('出局玩家不能执行此操作。');
  const state: GameState = structuredClone(original);
  const actorName = `${actor.seat} 号 ${actor.name}`;
  if (SPEECH_KINDS.has(action.kind)) {
    const text = action.text?.trim();
    if (!text || text.length > 1600) throw new Error('发言须为 1—1600 个字符。');
    event(state, action.kind === 'wolf_chat' ? 'wolf_chat' : 'speech', text, { seat: actor.seat, visibility: action.kind === 'wolf_chat' ? 'wolves' : 'public' });
  } else if (action.kind === 'wolf_vote') {
    const target = validateTarget(current, action, false)!;
    state.night.wolfVotes[actor.seat] = target;
    event(state, 'wolf_chat', `${actorName} 的袭击提议：${target} 号。`, { seat: actor.seat, visibility: 'wolves' });
  } else if (action.kind === 'witch') {
    if (!['save', 'poison', 'pass'].includes(action.use || '')) throw new Error('请选择救人、用毒或不使用药品。');
    if (action.use === 'save') {
      if (!current.canSave) throw new Error('此时不能使用解药；女巫仅首夜可以自救。');
      state.witch.antidote = false; state.night.saved = true;
      event(state, 'private', `第 ${state.day} 夜，你用解药救下了 ${state.night.victim} 号（仅解除狼刀伤害）。`, { seat: actor.seat, visibility: 'private', visibleTo: [actor.seat] });
    } else if (action.use === 'poison') {
      if (!current.canPoison) throw new Error('毒药已经使用。');
      const target = validateTarget(current, action, false)!;
      state.witch.poison = false; state.night.poison = target;
      event(state, 'private', `第 ${state.day} 夜，你对 ${target} 号使用了毒药。`, { seat: actor.seat, visibility: 'private', visibleTo: [actor.seat] });
    } else event(state, 'private', `第 ${state.day} 夜，你没有使用药品。`, { seat: actor.seat, visibility: 'private', visibleTo: [actor.seat] });
  } else if (action.kind === 'seer') {
    const target = validateTarget(current, action, false)!;
    event(state, 'private', `第 ${state.day} 夜查验：${target} 号 ${player(state, target).name} 属于${player(state, target).role === 'werewolf' ? '狼人' : '好人'}阵营。`, { seat: actor.seat, visibility: 'private', visibleTo: [actor.seat] });
  } else if (action.kind === 'vote' || action.kind === 'pk_vote') {
    state.votes[actor.seat] = validateTarget(current, action, true);
  } else if (action.kind === 'hunter') {
    const target = validateTarget(current, action, true);
    if (actor.role !== 'hunter' || actor.deathCause === 'poison') throw new Error('此时不能开枪。');
    if (target === null) event(state, 'system', `${actorName} 放弃了猎人开枪。`);
    else {
      death(state, target, 'shot');
      event(state, 'death', `${actorName} 发动猎人技能，带走了 ${target} 号 ${player(state, target).name}。`);
    }
  } else throw new Error('未知行动。');
  state.queue.shift();
  state.processedActions.push(action.turnId);
  state.revision += 1; state.updatedAt = new Date().toISOString();
  advanceEmptyStages(state);
  return state;
}

function canSee(state: GameState, item: GameEvent, seat: number): boolean {
  return item.visibility === 'public' || (item.visibility === 'private' && !!item.visibleTo?.includes(seat)) || (item.visibility === 'wolves' && player(state, seat).role === 'werewolf');
}

export function toPlayerView(state: GameState): PlayerView {
  const me = player(state, 1);
  const current = getNextTurn(state);
  const teammates = me.role === 'werewolf' ? state.players.filter((p) => p.role === 'werewolf' && p.seat !== me.seat).map((p) => p.seat) : [];
  return {
    id: state.id, revision: state.revision, day: state.day, phase: state.phase, paused: state.paused, winner: state.winner,
    players: state.players.map((p) => ({ seat: p.seat, name: p.name, alive: p.alive, isHuman: p.isHuman, persona: p.persona, avatar: p.avatar,
      ...(state.phase === 'ended' || p.seat === 1 || teammates.includes(p.seat) ? { role: p.role } : {}),
    })),
    me: { seat: 1, role: me.role, alive: me.alive, teammates, ...(me.role === 'witch' ? { antidote: state.witch.antidote, poison: state.witch.poison } : {}) },
    turn: current?.actorSeat === 1 ? current : null,
    currentSpeaker: current && PUBLIC_SPEECH_KINDS.has(current.kind) ? current.actorSeat : null,
    events: state.events.filter((item) => canSee(state, item, 1)).map(({ id, day, type, text, seat }) => ({ id, day, type, text, ...(seat === undefined ? {} : { seat }) })),
    voteRounds: structuredClone(state.voteRounds), ...(state.review ? { review: state.review } : {}),
  };
}

export function getAgentContext(state: GameState, seat: number): string {
  const actor = player(state, seat);
  const current = getNextTurn(state);
  const teammates = actor.role === 'werewolf' ? state.players.filter((p) => p.role === 'werewolf' && p.seat !== seat).map((p) => p.seat) : [];
  const context = {
    rules: '9人屠边局：3狼人、3村民、预言家、女巫、猎人。好人须消灭所有狼人；狼人须消灭全部村民或全部神职。女巫每晚只能用一瓶药，仅首夜可自救；猎人被毒死不能开枪。平票PK一次，复投再平票无人出局。',
    informationPolicy: '你只能使用本上下文中提供的信息。公开发言中的身份、查验和归票仅为玩家声明，可能撒谎，不是已确认的事实。死者此前公开发言和票型依然可以用于推理；警长与警徽不存在。夜间具体死因未公开，不得臆称知道其他玩家的隐藏行动。不要输出私有推理过程。',
    day: state.day, phase: state.phase,
    you: { seat, name: actor.name, role: ROLE_NAMES[actor.role], persona: actor.persona, alive: actor.alive, teammates, ...(actor.role === 'witch' ? { antidote: state.witch.antidote, poison: state.witch.poison } : {}) },
    players: state.players.map((p) => ({ seat: p.seat, name: p.name, alive: p.alive, ...(p.seat === seat || teammates.includes(p.seat) ? { role: ROLE_NAMES[p.role] } : {}) })),
    events: state.events.filter((item) => canSee(state, item, seat)).map(({ day, type, text, seat: speaker }) => ({ day, type, text, ...(speaker === undefined ? {} : { seat: speaker }) })),
    voteRounds: state.voteRounds,
    currentTurn: current?.actorSeat === seat ? current : null,
  };
  return JSON.stringify(context);
}
