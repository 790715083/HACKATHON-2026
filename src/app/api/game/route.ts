import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createGame, toPlayerView } from '@/lib/game/engine';
import type { Role } from '@/lib/game/types';
import { errorResponse, ensureSameOrigin, HttpError, readJSON, sessionFrom } from '@/lib/server/http';
import { cancelGame, readGame, readSession, saveGame, saveSession, SESSION_COOKIE, withLock } from '@/lib/server/store';
import { isConfigured, modelConfiguration } from '@/lib/server/model';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = sessionFrom(request); const id = session ? await readSession(session) : null;
    const state = id ? await readGame(id) : null;
    return NextResponse.json({ game: state ? toPlayerView(state) : null, configured: isConfigured(), models: modelConfiguration() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    ensureSameOrigin(request); const body = await readJSON(request);
    if (body.preferredRole !== undefined && !['random', 'werewolf', 'villager', 'seer', 'witch', 'hunter'].includes(String(body.preferredRole))) throw new HttpError(400, '请选择有效身份。');
    if (body.name !== undefined && (typeof body.name !== 'string' || body.name.trim().length > 16)) throw new HttpError(400, '昵称最多 16 个字符。');
    const session = sessionFrom(request) ?? randomUUID();
    return await withLock(`session:${session}`, async () => {
      const oldId = await readSession(session); if (oldId) cancelGame(oldId);
      const state = createGame({ id: randomUUID(), preferredRole: body.preferredRole as Role | 'random' | undefined, name: typeof body.name === 'string' ? body.name.trim() : undefined });
      await saveGame(state); await saveSession(session, state.id);
      const response = NextResponse.json({ game: toPlayerView(state) });
      response.cookies.set(SESSION_COOKIE, session, { httpOnly: true, sameSite: 'strict', secure: new URL(request.url).protocol === 'https:', path: '/', maxAge: 60 * 60 * 24 * 365 });
      return response;
    });
  } catch (error) { return errorResponse(error); }
}
