import { mkdir, writeFile } from 'node:fs/promises';
import { readSecret } from './read-secret.mjs';

// Secrets arrive via hidden/piped stdin; never place them in command arguments.
const key = await readSecret();
const base = process.env.ZHIPU_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4';
const headers = { Authorization: `Bearer ${key}` };
const report = {};
await mkdir('.data/audit', { recursive: true });
async function checked(response) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(`HTTP ${response.status}: ${String(body?.error?.code || 'provider_error')} ${String(body?.error?.message || '').replaceAll(key, '[redacted]').slice(0, 220)}`);
  }
  return response;
}
const results = await Promise.allSettled([
  (async () => {
    const started = Date.now();
    const r = await checked(await fetch(`${base}/chat/completions`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'glm-5.3-flash', messages: [{ role: 'system', content: '你是一名狼人杀玩家。只返回 JSON 对象，格式为 {"speech":"一句中文发言"}，不输出其他字段。' }, {role:'user',content:'首日尚无查验信息，请用一句话说明不轻易认定其他玩家身份。'}], response_format: { type: 'json_object' }, thinking: { type: 'enabled' }, reasoning_effort: 'low', max_tokens: 1024, stream: false }), signal: AbortSignal.timeout(90000)
    }));
    const data = await r.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || 'null');
    if (!parsed || typeof parsed.speech !== 'string' || !parsed.speech) throw new Error('Speech JSON validation failed');
    report.chat = { ok: true, model: data.model, elapsedMs: Date.now() - started, speech: parsed.speech, usage: data.usage };
  })(),
  (async () => {
    const r = await checked(await fetch(`${base}/audio/speech`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'glm-tts', input: '我是三号玩家。预言家的查验和昨天的投票记录，应该结合起来分析。', voice: 'xiaochen', response_format: 'wav' }), signal: AbortSignal.timeout(90000) }));
    const audio = Buffer.from(await r.arrayBuffer());
    if (audio.toString('ascii', 0, 4) !== 'RIFF') throw new Error(`Expected WAV, got ${r.headers.get('content-type')}, ${audio.length} bytes`);
    await writeFile('.data/audit/provider-voice.wav', audio);
    report.tts = { ok: true, model: 'glm-tts', bytes: audio.length };
    const form = new FormData(); form.set('model', 'glm-asr-2512'); form.set('file', new Blob([audio], { type: 'audio/wav' }), 'speech.wav'); form.set('stream', 'false');
    const transcript = await (await checked(await fetch(`${base}/audio/transcriptions`, { method: 'POST', headers, body: form, signal: AbortSignal.timeout(90000) }))).json();
    if (typeof transcript.text !== 'string' || !transcript.text) throw new Error('ASR response missing text');
    report.stt = { ok: true, model: 'glm-asr-2512', text: transcript.text };
  })()
]);
results.forEach((r,i) => { if (r.status === 'rejected') report[i === 0 ? 'chat' : report.tts?.ok ? 'stt' : 'tts'] = {ok:false,error:r.reason.message}; });
await writeFile('.data/audit/provider-probe.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.chat?.ok && report.tts?.ok && report.stt?.ok ? 0 : 1);
