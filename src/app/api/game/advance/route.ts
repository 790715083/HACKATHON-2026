import { applyAction, getNextTurn, toPlayerView } from '@/lib/game/engine';
import type { StreamEvent } from '@/lib/game/types';
import { currentGameId, ensureSameOrigin, errorResponse, HttpError, readJSON } from '@/lib/server/http';
import { decideTurn, generateReview, isConfigured } from '@/lib/server/model';
import { readGame, readSession, runtimeState, saveGame, withLock } from '@/lib/server/store';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    ensureSameOrigin(request); const body = await readJSON(request);
    const { session, gameId } = await currentGameId(request, body.gameId);
    if (!isConfigured()) throw new HttpError(503, '尚未配置智谱 API Key，请设置服务端 ZHIPU_API_KEY 后重新启动。');
    const existing = await readGame(gameId); if (!existing) throw new HttpError(404, '对局不存在。');
    if (runtimeState.active.has(gameId)) throw new HttpError(409, '该对局正在推进，请稍后刷新。');
    const controller = new AbortController(); runtimeState.active.set(gameId, controller);
    const onAbort = () => controller.abort(); request.signal.addEventListener('abort', onAbort, { once: true });
    let open = true; const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(output) {
        const send = (event: StreamEvent) => { if (open && !controller.signal.aborted) { try { output.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { open = false; controller.abort(); } } };
        void withLock(gameId, async () => {
          let state = await readGame(gameId); if (!state) throw new Error('对局存档不存在。');
          try {
            for (let count = 0; count < 120; count++) {
              controller.signal.throwIfAborted();
              if (await readSession(session) !== gameId) { controller.abort(); break; }
              if (state.paused) { send({ type: 'state', game: toPlayerView(state) }); break; }
              if (state.phase === 'ended') {
                if (!state.review) {
                  const review = await generateReview(state, controller.signal); controller.signal.throwIfAborted();
                  state.review = review; state.events.push({ id: `${state.id}:review`, day: state.day, type: 'review', text: review, visibility: 'public' });
                  state.revision++; state.updatedAt = new Date().toISOString(); await saveGame(state);
                }
                send({ type: 'state', game: toPlayerView(state) }); break;
              }
              const turn = getNextTurn(state);
              if (!turn || state.players.find(player => player.seat === turn.actorSeat)?.isHuman) { send({ type: 'state', game: toPlayerView(state) }); break; }
              const publicSpeech = ['speech', 'last_words', 'pk_speech'].includes(turn.kind);
              const action = await decideTurn(state, turn, { signal: controller.signal, onSpeech: publicSpeech ? text => send({ type: 'speech', turnId: turn.id, seat: turn.actorSeat, text }) : undefined });
              controller.signal.throwIfAborted();
              const next = applyAction(state, action); await saveGame(next); state = next;
              send({ type: 'state', game: toPlayerView(state) });
            }
          } catch (error) {
            if (!controller.signal.aborted) {
              if (state.phase !== 'ended') { state.paused = true; state.revision++; state.updatedAt = new Date().toISOString(); await saveGame(state); }
              send({ type: 'state', game: toPlayerView(state) });
              send({ type: 'error', message: error instanceof Error ? error.message : 'AI 回合未完成，请重试。' });
            }
          }
        }).catch(() => send({ type: 'error', message: '读取或保存对局失败，请保留本地存档并重试。' })).finally(() => {
          send({ type: 'done' }); if (open) { open = false; try { output.close(); } catch { /* already disconnected */ } }
          if (runtimeState.active.get(gameId) === controller) runtimeState.active.delete(gameId);
          request.signal.removeEventListener('abort', onAbort);
        });
      },
      cancel() { open = false; controller.abort(); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' } });
  } catch (error) { return errorResponse(error); }
}
