import { toPlayerView } from '@/lib/game/engine';
import { currentGameId, ensureSameOrigin, errorResponse, HttpError, readJSON } from '@/lib/server/http';
import { cacheAudio, readGame, runtimeState } from '@/lib/server/store';
import { splitSpeech, synthesizeSpeech } from '@/lib/server/speech';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    ensureSameOrigin(request); const body = await readJSON(request); const { gameId } = await currentGameId(request, body.gameId);
    const state = await readGame(gameId); if (!state) throw new HttpError(404, '对局不存在。');
    const event = toPlayerView(state).events.find(item => item.id === body.eventId);
    if (!event || !['speech', 'wolf_chat', 'review'].includes(event.type)) throw new HttpError(400, '只能播放当前对局中你有权查看的已完成发言。');
    const chunks = splitSpeech(event.text); const index = body.chunkIndex ?? 0;
    if (!Number.isInteger(index) || Number(index) < 0 || Number(index) >= chunks.length) throw new HttpError(400, '配音段落无效。');
    const key = `${gameId}:${event.id}:${index}`;
    let bytes = runtimeState.audio.get(key);
    if (!bytes) { bytes = await synthesizeSpeech(chunks[Number(index)], event.seat ?? 0, request.signal); cacheAudio(key, bytes); }
    return new Response(new Uint8Array(bytes).buffer, { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'private, no-store', 'X-Audio-Chunks': String(chunks.length) } });
  } catch (error) { return errorResponse(error instanceof HttpError ? error : new HttpError(502, error instanceof Error ? error.message : '配音暂时不可用。')); }
}
