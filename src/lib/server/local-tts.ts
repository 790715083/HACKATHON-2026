import { setTimeout as wait } from 'node:timers/promises';

// Kokoro v1.1-zh Chinese voices, fixed by seat so a character keeps its voice.
// Seat 0 is the narrator; seats 2–9 follow the eight named AI personalities.
const voices = ['zf_001', 'zm_013', 'zm_009', 'zf_002', 'zf_003', 'zm_010', 'zf_004', 'zm_011', 'zf_005', 'zm_012'];
export function ttsModel() { return process.env.TTS_MODEL?.trim() || 'kokoro-v1.1-zh'; }

export async function localSpeech(text: string, seat: number, signal?: AbortSignal): Promise<Uint8Array> {
  signal?.throwIfAborted();
  const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000);
  try {
    const base = (process.env.TTS_BASE_URL?.trim() || 'http://127.0.0.1:8880/v1').replace(/\/+$/, '');
    const body = JSON.stringify({ model: ttsModel(), input: text, voice: voices[seat] ?? voices[0],
      speed: [0.98, 1.02, 1, 1.06][Math.abs(seat) % 4], response_format: 'wav', stream: false });
    let response: Response; let retryDelay = 500;
    while (true) {
      combined.throwIfAborted();
      response = await fetch(`${base}/audio/speech`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
        signal: combined, redirect: 'error', cache: 'no-store',
      });
      if (response.status !== 503 && response.status !== 429) break;
      await response.body?.cancel();
      // Cancelled playback leaves native inference running. Wait for that slot
      // without resetting the overall deadline or blocking playback cancellation.
      await wait(retryDelay, undefined, { signal: combined });
      retryDelay = Math.min(retryDelay * 2, 2000);
    }
    if (!response.ok) {
      await response.body?.cancel();
      if ([400, 404, 422].includes(response.status)) throw new Error('本地配音模型或接口配置无效，请检查 TTS_BASE_URL 和 TTS_MODEL。');
      throw new Error(`本地配音暂时不可用（HTTP ${response.status}），请重启 pnpm tts:start 后重试。`);
    }
    const maxBytes = 12 * 1024 * 1024;
    if (!response.headers.get('content-type')?.toLowerCase().startsWith('audio/') || Number(response.headers.get('content-length')) > maxBytes || !response.body) {
      await response.body?.cancel();
      throw new Error('本地服务未返回有效的 WAV 配音，请检查配音服务。');
    }
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { await reader.cancel(); throw new Error('本地配音文件过大，请缩短发言后重试。'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = Buffer.concat(chunks, size);
    if (size < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) !== size - 8) {
      throw new Error('本地服务返回的 WAV 配音不完整，请重试。');
    }
    return bytes;
  } catch (error) {
    if (signal?.aborted) throw new DOMException('配音已取消', 'AbortError');
    if (combined.aborted) throw new Error('本地配音等待或合成超时，请稍后重播或重启配音服务。');
    if (error instanceof TypeError) throw new Error('无法连接本地配音服务，请运行 pnpm tts:start 后重试。');
    throw error;
  }
}
