import { NextResponse } from 'next/server';
import { applyAction, toPlayerView } from '@/lib/game/engine';
import type { GameAction } from '@/lib/game/types';
import { assertActionId, assertRevision, currentGameId, ensureSameOrigin, errorResponse, HttpError, readJSON } from '@/lib/server/http';
import { cancelGame, readGame, readSession, saveGame, withLock } from '@/lib/server/store';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    ensureSameOrigin(request); const body = await readJSON(request);
    const { session, gameId } = await currentGameId(request, body.gameId); assertActionId(body.actionId);
    if (body.control === 'pause') cancelGame(gameId);
    return await withLock(gameId, async () => {
      if (await readSession(session) !== gameId) throw new HttpError(409, '当前对局已改变，请刷新页面。');
      let state = await readGame(gameId); if (!state) throw new HttpError(404, '对局不存在。');
      if (state.processedActions.includes(body.actionId as string)) return NextResponse.json({ game: toPlayerView(state) });
      if (body.control !== 'pause') assertRevision(state.revision, body.revision);
      if (body.control !== undefined) {
        if (!['pause', 'resume'].includes(String(body.control))) throw new HttpError(400, '控制操作无效。');
        if (state.phase !== 'ended') { state.paused = body.control === 'pause'; state.revision++; state.updatedAt = new Date().toISOString(); }
      } else {
        const action: GameAction = { actorSeat: 1, turnId: String(body.turnId ?? ''), kind: body.kind as GameAction['kind'], text: typeof body.text === 'string' ? body.text : undefined, targetSeat: body.targetSeat as number | null | undefined, use: body.use as GameAction['use'] };
        try { state = applyAction(state, action); } catch (error) { throw new HttpError(400, error instanceof Error ? error.message : '当前操作无效。'); }
      }
      state.processedActions.push(body.actionId as string); await saveGame(state);
      return NextResponse.json({ game: toPlayerView(state) });
    });
  } catch (error) { return errorResponse(error); }
}
