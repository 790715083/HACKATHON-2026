import { modelConfiguration, providerFetch } from './model';

export function splitSpeech(text: string, limit = 900): string[] {
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
  const voices = ['xiaochen', 'tongtong', 'chuichui'];
  const response = await providerFetch('audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: modelConfiguration().tts, input: text, voice: voices[Math.abs(seat) % voices.length], speed: [0.94, 1.02, 0.98, 1.08][Math.abs(seat) % 4], response_format: 'wav', stream: false }) }, signal);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 12 * 1024 * 1024 || bytes.byteLength < 44 || Buffer.from(bytes.subarray(0, 4)).toString('ascii') !== 'RIFF') throw new Error('智谱未返回可播放的 WAV 配音，请重试。');
  return bytes;
}

export async function transcribeSpeech(bytes: Uint8Array, hotwords: string[] = [], signal?: AbortSignal): Promise<string> {
  if (bytes.byteLength > 25 * 1024 * 1024) throw new Error('录音文件不得超过 25 MB。');
  wavMetadata(bytes);
  const form = new FormData();
  form.append('model', modelConfiguration().stt); form.append('stream', 'false');
  form.append('file', new Blob([new Uint8Array(bytes).buffer], { type: 'audio/wav' }), 'speech.wav');
  // Multipart arrays use repeated fields; the prompt also helps with seat and role terminology.
  form.append('prompt', `这是中文狼人杀发言。术语包括：${hotwords.slice(0, 30).join('、')}。请忠实转写，不改写或补充。`);
  const response = await providerFetch('audio/transcriptions', { method: 'POST', body: form }, signal);
  let data; try { data = await response.json(); } catch { throw new Error('智谱语音识别返回格式无效，请重试。'); }
  if (typeof data.text !== 'string' || !data.text.trim()) throw new Error('未识别到清晰语音，请重录或使用文字输入。');
  if (data.text.length > 3000) throw new Error('识别结果过长，请分段录制。');
  return data.text.trim();
}
