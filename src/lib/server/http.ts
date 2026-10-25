import { NextResponse } from 'next/server';
import { isIdentifier, readSession, SESSION_COOKIE } from './store';

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export function sessionFrom(request: Request): string | null {
  const raw = request.headers.get('cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  return isIdentifier(raw) ? raw : null;
}
export async function currentGameId(request: Request, supplied?: unknown) {
  const session = sessionFrom(request);
  if (!session) throw new HttpError(401, '会话已失效，请重新开始对局。');
  const gameId = await readSession(session);
  if (!gameId || (supplied !== undefined && supplied !== gameId)) throw new HttpError(409, '当前对局已改变，请刷新页面。');
  return { session, gameId };
}
export async function readJSON(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('content-length') ?? 0) > 16384) throw new HttpError(413, '请求内容过长。');
  const text = await request.text();
  if (text.length > 16384) throw new HttpError(413, '请求内容过长。');
  try { const value = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
  catch { throw new HttpError(400, '请求格式无效。'); }
}
export function errorResponse(error: unknown) {
  const known = error instanceof HttpError;
  return NextResponse.json({ error: known ? error.message : '操作未完成，请重试。' }, { status: known ? error.status : 500 });
}
export function assertRevision(actual: number, supplied: unknown) { if (supplied !== actual) throw new HttpError(409, '对局状态已更新，请刷新后重试。'); }
export function assertActionId(value: unknown): asserts value is string { if (!isIdentifier(value)) throw new HttpError(400, '操作标识无效。'); }
export function ensureSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return;
  const url = new URL(request.url);
  // Next may normalize request.url to localhost even when the browser connected
  // to 127.0.0.1. Host is the HTTP authority actually used by that browser.
  // This local-only server does not trust client-supplied forwarding headers.
  const host = request.headers.get('host') ?? url.host;
  let expected: string;
  try {
    if (!/^[a-z0-9.\-:\[\]]+$/i.test(host)) throw new Error();
    expected = new URL(`${url.protocol}//${host}`).origin;
  } catch { throw new HttpError(403, '不接受跨站操作。'); }
  if (origin !== expected) throw new HttpError(403, '不接受跨站操作。');
}
