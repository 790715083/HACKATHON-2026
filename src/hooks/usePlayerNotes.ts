import { useCallback, useEffect, useState } from 'react';
import { readPlayerNotes, type PlayerNote, type PlayerNotes } from '@/lib/ui/game-presentation';

export function usePlayerNotes(gameId: string | undefined) {
  const [saved, setSaved] = useState<{ gameId?: string; notes: PlayerNotes }>({ notes: {} });
  useEffect(() => {
    let notes: PlayerNotes = {};
    if (gameId) {
      try { notes = readPlayerNotes(JSON.parse(localStorage.getItem(`moonlit-notes:${gameId}`) ?? '{}')); }
      catch { /* Keep the game usable when local storage is unavailable. */ }
    }
    setSaved({ gameId, notes });
  }, [gameId]);
  useEffect(() => {
    // A new game's initial render must never overwrite another game's loaded notes.
    if (gameId && saved.gameId === gameId) {
      try { localStorage.setItem(`moonlit-notes:${gameId}`, JSON.stringify(saved.notes)); }
      catch { /* Personal notes remain usable for this session. */ }
    }
  }, [gameId, saved]);
  const updateNote = useCallback((seat: number, patch: Partial<PlayerNote>) => {
    if (!gameId) return;
    setSaved(current => {
      const notes = current.gameId === gameId ? current.notes : {};
      return { gameId, notes: readPlayerNotes({ ...notes, [seat]: { ...(notes[seat] ?? { stance: '', claim: '' }), ...patch } }) };
    });
  }, [gameId]);
  return { notes: saved.gameId === gameId ? saved.notes : {}, updateNote };
}
