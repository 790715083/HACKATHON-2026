import { providerFetch } from './model';
import { localSpeech } from './local-tts';
import { sttConfiguration } from './stt-config';

export function splitSpeech(text: string, limit = 300): string[] {
  const result: string[] = []; let chunk = '';
  const sentences = text.match(/[^。！？!?；;\n]+[。！？!?；;\n]*/g) ?? [text];
  for (const sentence of sentences) {
    for (let index = 0; index < sentence.length; index += limit) {
      const part = sentence.slice(index, index + limit);
      if (chunk.length + part.length > limit && chunk) { result.push(chunk); chunk = ''; }
      chunk += part;
    }
  }
  if (chunk.trim()) result.push(chunk.trim()); return result;
}

export function wavMetadata(bytes: Uint8Array): { duration: number; sampleRate: number; channels: number; dataBytes: number } {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('请上传有效的 WAV 录音。');
  let rate = 0; let align = 0; let channels = 0; let dataBytes = 0;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const kind = buffer.toString('ascii', offset, offset + 4); const size = buffer.readUInt32LE(offset + 4); const start = offset + 8;
    if (size > buffer.length - start) throw new Error('WAV 录音不完整。');
    if (kind === 'fmt ') {
      if (size < 16) throw new Error('WAV 音频格式无效。');
      const format = buffer.readUInt16LE(start); channels = buffer.readUInt16LE(start + 2); rate = buffer.readUInt32LE(start + 4); align = buffer.readUInt16LE(start + 12); const bits = buffer.readUInt16LE(start + 14);
      if (![1, 3].includes(format) || channels < 1 || channels > 2 || rate < 8000 || rate > 192000 || ![8, 16, 24, 32].includes(bits) || align !== channels * bits / 8) throw new Error('请使用标准 PCM WAV 录音。');
    }
    if (kind === 'data') dataBytes += size;
    offset = start + size + (size % 2);
  }
  if (!rate || !align || !dataBytes) throw new Error('录音为空或缺少音频数据。');
  const duration = dataBytes / rate / align;
  if (!Number.isFinite(duration) || duration <= 0 || duration > 30.1) throw new Error('每段录音最长 30 秒，请分段录制。');
  return { duration, sampleRate: rate, channels, dataBytes };
}

export async function synthesizeSpeech(text: string, seat: number, signal?: AbortSignal): Promise<Uint8Array> {
  if (!text.trim() || text.length > 1024) throw new Error('配音文本长度无效。');
  return localSpeech(text, seat, signal);
}

export async function transcribeSpeech(bytes: Uint8Array, hotwords: string[] = [], signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  if (bytes.byteLength > 25 * 1024 * 1024) throw new Error('录音文件不得超过 25 MB。');
  const metadata = wavMetadata(bytes);
  const { provider, model } = sttConfiguration();
  if (!['local', 'zhipu', 'external'].includes(provider)) throw new Error('STT_PROVIDER 须为 local、zhipu 或 external。');
  if (!model) throw new Error('请在服务端设置外部识别的 STT_MODEL。');
  if (provider === 'local' && metadata.duration < 0.2) throw new Error('录音太短，请说完一句话后再结束录音。');
  const form = new FormData();
  form.append('model', model);
  form.append('file', new Blob([new Uint8Array(bytes).buffer], { type: 'audio/wav' }), 'speech.wav');
  form.append('language', 'zh');
  form.append('prompt', `这是中文狼人杀发言。术语包括：${hotwords.slice(0, 30).join('、')}。请忠实转写，不改写或补充。`);
  form.append('response_format', 'json');
  const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000);
  const label = provider === 'local' ? '本地' : '外部';
  try {
    let response: Response;
    if (provider === 'zhipu') {
      // Preserve the existing GLM ASR multipart contract and error handling.
      form.delete('language'); form.delete('response_format'); form.append('stream', 'false');
      response = await providerFetch('audio/transcriptions', { method: 'POST', body: form }, combined, 120000);
    } else {
      const base = process.env.STT_BASE_URL?.trim() || (provider === 'local' ? 'http://127.0.0.1:8881/v1' : '');
      let url: URL;
      try {
        url = new URL(`${base.replace(/\/+$/, '')}/audio/transcriptions`);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
        if (provider === 'local' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error();
      } catch { throw new Error('请检查 STT_BASE_URL；local 仅接受本机地址，远端服务请配置 STT_PROVIDER=external。'); }
      const key = provider === 'external' ? process.env.STT_API_KEY?.trim() : undefined;
      response = await fetch(url, { method: 'POST', body: form,
        headers: key ? { Authorization: `Bearer ${key}` } : {},
        signal: combined, redirect: 'error', cache: 'no-store' });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 503 || response.status === 429) throw new Error(`${label}识别服务忙，请稍后重试。`);
        if (response.status === 401 || response.status === 403) throw new Error('外部识别鉴权失败，请检查服务端 STT_API_KEY。');
        throw new Error(`${label}识别请求失败（HTTP ${response.status}），请检查 STT_BASE_URL、STT_MODEL 和服务状态。`);
      }
    }
    // Bound even chunked responses; never surface an upstream body or credential.
    if (!response.body || Number(response.headers.get('content-length')) > 65536) {
      await response.body?.cancel(); throw new Error(`${label}识别返回内容过大或为空。`);
    }
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 65536) { await reader.cancel(); throw new Error(`${label}识别返回内容过大。`); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let data;
    try { data = JSON.parse(Buffer.concat(chunks, size).toString('utf8')); }
    catch { throw new Error(`${label}语音识别返回格式无效，请重试。`); }
    if (!data || typeof data.text !== 'string' || !data.text.trim()) throw new Error('未识别到清晰语音，请重录或使用文字输入。');
    if (data.text.length > 3000) throw new Error('识别结果过长，请分段录制。');
    return data.text.trim();
  } catch (error) {
    if (signal?.aborted) throw new DOMException('识别已取消', 'AbortError');
    if (combined.aborted) throw new Error(`${label}识别超时，请重试或缩短录音。`);
    if (error instanceof TypeError) throw new Error(provider === 'local'
      ? '无法连接本地识别服务，请运行 pnpm stt:start 后重试。'
      : '无法连接外部识别服务，请检查 STT_BASE_URL 和网络。');
    throw error;
  }
}
