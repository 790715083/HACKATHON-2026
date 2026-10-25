import { NextResponse } from 'next/server';
import { currentGameId, ensureSameOrigin, errorResponse, HttpError } from '@/lib/server/http';
import { readGame } from '@/lib/server/store';
import { transcribeSpeech, wavMetadata } from '@/lib/server/speech';
import { getNextTurn } from '@/lib/game/engine';
export const runtime = 'nodejs';

const MAX_FORM_BYTES = 26 * 1024 * 1024;

async function recordingForm(request: Request): Promise<FormData> {
  const contentType = request.headers.get('content-type');
  if (!request.body || contentType?.split(';', 1)[0].trim().toLowerCase() !== 'multipart/form-data') {
    throw new HttpError(400, '请提供有效的录音表单。');
  }
  let received = 0; let oversized = false;
  const body = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > MAX_FORM_BYTES) {
        oversized = true;
        // Throwing also cancels the source stream, including chunked uploads.
        throw new Error('recording form too large');
      }
      controller.enqueue(chunk);
    },
  }));
  try { return await new Response(body, { headers: { 'Content-Type': contentType } }).formData(); }
  catch { throw new HttpError(oversized ? 413 : 400, oversized ? '录音文件过大。' : '请提供有效的录音表单。'); }
}

export async function POST(request: Request) {
  try {
    ensureSameOrigin(request);
    if (Number(request.headers.get('content-length') ?? 0) > MAX_FORM_BYTES) throw new HttpError(413, '录音文件过大。');
    const { gameId } = await currentGameId(request); const state = await readGame(gameId); if (!state) throw new HttpError(404, '对局不存在。');
    const form = await recordingForm(request);
    if (form.has('gameId') && form.get('gameId') !== gameId) throw new HttpError(409, '当前对局已改变，请重新录音。');
    const turnId = form.get('turnId');
    const turn = getNextTurn(state);
    if (turnId !== null && (state.paused || !turn || turn.id !== turnId || !state.players.find(player => player.seat === turn.actorSeat)?.isHuman || !['speech', 'wolf_chat', 'last_words', 'pk_speech'].includes(turn.kind))) {
      throw new HttpError(409, '发言回合已改变，请在当前回合重新录音。');
    }
    const file = form.get('file');
    if (!(file instanceof File) || file.size > 25 * 1024 * 1024 || !file.size) throw new HttpError(400, '请提供不超过 25 MB 的 WAV 录音。');
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Reject invalid audio as a client error, before any model/API request.
    try { wavMetadata(bytes); } catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'WAV 录音无效。'); }
    const text = await transcribeSpeech(bytes, [...state.players.map(player => player.name), '狼人', '预言家', '女巫', '猎人', '村民', '金水', '查杀', '悍跳', '警徽', '放逐', '弃票'], request.signal);
    const current = await currentGameId(request, gameId);
    const latest = await readGame(current.gameId);
    if (!latest || (turnId !== null && (latest.paused || getNextTurn(latest)?.id !== turnId))) throw new HttpError(409, '发言回合已改变，请在当前回合重新录音。');
    return NextResponse.json({ text }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return errorResponse(error instanceof HttpError ? error : new HttpError(502, error instanceof Error ? error.message : '语音识别暂时不可用。')); }
}
