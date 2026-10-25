import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { GameState } from '@/lib/game/types';

type Runtime = { locks: Map<string, Promise<void>>; active: Map<string, AbortController>; audio: Map<string, Uint8Array> };
const shared = globalThis as typeof globalThis & { __moonlitServer?: Runtime };
export const runtimeState: Runtime = shared.__moonlitServer ??= { locks: new Map(), active: new Map(), audio: new Map() };
export const SESSION_COOKIE = 'moonlit_session';
export function dataDirectory() { return process.env.MOONLIT_DATA_DIR || path.join(process.cwd(), '.data'); }
export function isIdentifier(value: unknown): value is string { return typeof value === 'string' && /^[a-zA-Z0-9_-]{16,100}$/.test(value); }

export async function withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = runtimeState.locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => gate);
  runtimeState.locks.set(key, tail);
  await previous.catch(() => undefined);
  try { return await work(); } finally { release(); if (runtimeState.locks.get(key) === tail) runtimeState.locks.delete(key); }
}

export async function atomicJSON(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await rename(temporary, file); }
  finally { await unlink(temporary).catch(() => undefined); }
}

export async function readGame(id: string): Promise<GameState | null> {
  if (!isIdentifier(id)) return null;
  try {
    const value = JSON.parse(await readFile(path.join(dataDirectory(), 'games', `${id}.json`), 'utf8')) as GameState;
    if (value.schemaVersion !== 1 || value.id !== id || !Array.isArray(value.players) || !Array.isArray(value.queue)) throw new Error('SAVE_INVALID');
    return value;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('本地存档无法读取，请保留 .data 目录后重试。'); }
}
export async function saveGame(state: GameState) {
  if (!isIdentifier(state.id)) throw new Error('无效的对局标识。');
  await atomicJSON(path.join(dataDirectory(), 'games', `${state.id}.json`), state);
}
export async function readSession(session: string): Promise<string | null> {
  if (!isIdentifier(session)) return null;
  try {
    const value = JSON.parse(await readFile(path.join(dataDirectory(), 'sessions', `${session}.json`), 'utf8'));
    return isIdentifier(value.gameId) ? value.gameId : null;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('本地会话无法读取。'); }
}
export async function saveSession(session: string, gameId: string) {
  if (!isIdentifier(session) || !isIdentifier(gameId)) throw new Error('无效的会话标识。');
  await atomicJSON(path.join(dataDirectory(), 'sessions', `${session}.json`), { gameId });
}
export function cancelGame(gameId: string) { runtimeState.active.get(gameId)?.abort(); }
export function cacheAudio(key: string, bytes: Uint8Array) {
  runtimeState.audio.delete(key); runtimeState.audio.set(key, bytes);
  let total = [...runtimeState.audio.values()].reduce((sum, item) => sum + item.byteLength, 0);
  while (runtimeState.audio.size > 24 || total > 32 * 1024 * 1024) {
    const first = runtimeState.audio.keys().next().value as string | undefined;
    if (!first) break;
    total -= runtimeState.audio.get(first)!.byteLength; runtimeState.audio.delete(first);
  }
}
