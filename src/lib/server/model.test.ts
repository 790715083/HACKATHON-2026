import assert from 'node:assert/strict';
import test from 'node:test';
import { createGame } from '@/lib/game/engine';
import type { Turn } from '@/lib/game/types';
import { completion, decideTurn, generateReview, parseDecision, parseSpeech, partialSpeech, providerError } from './model';

test('stream parser accepts only an explicitly named public speech field', () => {
  assert.equal(partialSpeech('{"speech":"我怀疑'), '我怀疑');
  assert.equal(partialSpeech(' { "speech" : "检查\\n票型\\u3002"}'), '检查\n票型。');
  assert.equal(partialSpeech('{"private_reasoning":"身份秘密","speech":"发言"}'), null);
  assert.equal(partialSpeech('{"thought":"我是狼人"}'), null);
  assert.equal(partialSpeech('```json\n{"speech":"发言"}'), null);
  assert.equal(partialSpeech('"内部想法"'), null);
  assert.equal(partialSpeech('{"speech":"错误\\q'), null);
});
test('complete speech rejects envelope, unknown and reasoning fields', () => {
  assert.equal(parseSpeech('{"speech":" 请核对票型。 "}'), '请核对票型。');
  for (const raw of ['{"speech":"公开","reasoning":"秘密"}', '{"speech":""}', '{"data":{"speech":"嵌套"}}', '公开文本', '{"speech":123}']) assert.throws(() => parseSpeech(raw));
});
test('decision validator rejects dead, self and unavailable targets before engine mutation', () => {
  const turn: Turn = { id: 'turn', actorSeat: 3, kind: 'vote', choices: [1, 2, 5], canSkip: true };
  assert.equal(parseDecision('{"targetSeat":null}', turn).targetSeat, null);
  assert.equal(parseDecision('{"targetSeat":2}', turn).targetSeat, 2);
  assert.throws(() => parseDecision('{"targetSeat":3}', turn));
  assert.throws(() => parseDecision('{"targetSeat":"2"}', turn));
  assert.throws(() => parseDecision('{"targetSeat":2,"reason":"private"}', turn));
  assert.throws(() => parseDecision('{"targetSeat":null}', { ...turn, kind: 'seer', canSkip: false }));
  assert.throws(() => parseDecision('{"use":"save"}', { ...turn, kind: 'witch', canSave: false, canPoison: true }));
  assert.throws(() => parseDecision('{"use":"poison","targetSeat":3}', { ...turn, kind: 'witch', canPoison: true }));
});
test('model stream never forwards reasoning_content or non-public fields', async () => {
  const previousFetch = globalThis.fetch; const previousKey = process.env.ZHIPU_API_KEY; process.env.ZHIPU_API_KEY = 'test-only-key';
  const chunks = [
    { choices: [{ delta: { reasoning_content: 'DO_NOT_EXPOSE_ROLE' } }] },
    { choices: [{ delta: { content: '{"speech":"先看' } }] },
    { choices: [{ delta: { reasoning_content: 'SECRET', content: '票型。"}' }, finish_reason: 'stop' }] },
  ];
  const sent: string[] = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)); assert.equal(body.thinking.type, 'enabled'); assert.equal(body.reasoning_effort, 'low');
    return new Response(chunks.map(item => `data: ${JSON.stringify(item)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  };
  try {
    const raw = await completion([{ role: 'user', content: '测试' }], { stream: true, onSpeech: text => sent.push(text) });
    assert.equal(parseSpeech(raw), '先看票型。'); assert.deepEqual(sent, ['先看', '先看票型。']); assert.equal(JSON.stringify(sent).includes('SECRET'), false);
  } finally { globalThis.fetch = previousFetch; if (previousKey === undefined) delete process.env.ZHIPU_API_KEY; else process.env.ZHIPU_API_KEY = previousKey; }
});
test('malformed AI action is retried at most once and never replaced with fabricated action', async () => {
  const previousFetch = globalThis.fetch; const previousKey = process.env.ZHIPU_API_KEY; process.env.ZHIPU_API_KEY = 'test-only-key'; let attempts = 0;
  globalThis.fetch = async () => { attempts++; return Response.json({ choices: [{ message: { content: '{"speech":"公开","thought":"秘密"}' }, finish_reason: 'stop' }] }); };
  const state = createGame({ seed: 9 }); const turn: Turn = { id: 'test-turn', actorSeat: 2, kind: 'wolf_chat', choices: [], canSkip: false };
  try { await assert.rejects(() => decideTurn(state, turn), /发言字段无效/); assert.equal(attempts, 2); }
  finally { globalThis.fetch = previousFetch; if (previousKey === undefined) delete process.env.ZHIPU_API_KEY; else process.env.ZHIPU_API_KEY = previousKey; }
});
test('upstream balance and credential errors are useful and sanitized', () => {
  assert.match(providerError(429, '1113').message, /余额不足/);
  assert.match(providerError(401).message, /鉴权/);
  assert.match(providerError(429).message, /频率或可用额度/);
});
test('endgame review distinguishes confirmed revealed roles from knowledge available during play', async () => {
  const previousFetch = globalThis.fetch; const previousKey = process.env.ZHIPU_API_KEY; process.env.ZHIPU_API_KEY = 'test-only-key';
  const state = createGame({ seed: 9 });
  const seer = state.players.find(player => player.role === 'seer')!;
  [state.players[7].role, seer.role] = [seer.role, state.players[7].role];
  state.phase = 'ended'; state.winner = 'wolves';
  state.events.push({ id: 'public-claim', day: 1, type: 'speech', visibility: 'public', seat: 8, text: '我是预言家，请核对我的发言。' });
  state.events.push({ id: 'private-check', day: 1, type: 'private', visibility: 'private', visibleTo: [8], text: '未向复盘提供的夜间查验结果' });
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)); const system = body.messages[0].content as string;
    assert.match(system, /roles 是终局翻牌后已确认的游戏身份/);
    assert.match(system, /不能把当时仅有的身份声明写成当时已确认的事实/);
    assert.match(system, /资料未记录的夜间目标、用药、查验结果及其他行为不得编造/);
    const facts = JSON.parse(body.messages[1].content);
    assert.equal(facts.roles.find((player: { seat: number }) => player.seat === 8).role, 'seer');
    assert.equal(facts.winner, 'wolves'); assert.ok(facts.events.includes('我是预言家，请核对我的发言。'));
    assert.equal(facts.events.includes('未向复盘提供的夜间查验结果'), false);
    return Response.json({ choices: [{ message: { content: '{"speech":"终局揭晓八号是预言家；回看当时的发言，其他玩家只能将其身份声明作为待验证线索。"}' }, finish_reason: 'stop' }] });
  };
  try { assert.match(await generateReview(state), /终局揭晓八号是预言家/); }
  finally { globalThis.fetch = previousFetch; if (previousKey === undefined) delete process.env.ZHIPU_API_KEY; else process.env.ZHIPU_API_KEY = previousKey; }
});
