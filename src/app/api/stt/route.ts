import { NextResponse } from 'next/server';
import { currentGameId, ensureSameOrigin, errorResponse, HttpError } from '@/lib/server/http';
import { readGame } from '@/lib/server/store';
import { transcribeSpeech } from '@/lib/server/speech';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    ensureSameOrigin(request);
    if (Number(request.headers.get('content-length') ?? 0) > 26 * 1024 * 1024) throw new HttpError(413, '录音文件过大。');
    const { gameId } = await currentGameId(request); const state = await readGame(gameId); if (!state) throw new HttpError(404, '对局不存在。');
    const form = await request.formData();
    if (form.has('gameId') && form.get('gameId') !== gameId) throw new HttpError(409, '当前对局已改变，请重新录音。');
    const file = form.get('file');
    if (!(file instanceof File) || file.size > 25 * 1024 * 1024 || !file.size) throw new HttpError(400, '请提供不超过 25 MB 的 WAV 录音。');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = await transcribeSpeech(bytes, [...state.players.map(player => player.name), '狼人', '预言家', '女巫', '猎人', '村民', '金水', '查杀', '悍跳', '警徽', '放逐', '弃票'], request.signal);
    return NextResponse.json({ text });
  } catch (error) { return errorResponse(error instanceof HttpError ? error : new HttpError(502, error instanceof Error ? error.message : '语音识别暂时不可用。')); }
}
