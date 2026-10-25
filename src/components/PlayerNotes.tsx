import { ROLE_NAMES, type Role } from '@/lib/game/types';
import type { PlayerNote } from '@/lib/ui/game-presentation';

export function PlayerNotes({ seat, note, onChange }: {
  seat: number; note?: PlayerNote; onChange: (seat: number, patch: Partial<PlayerNote>) => void;
}) {
  return <div className="personal-notes">
    <p className="personal-notes-label">{seat} 号 · 我的标记 <span>个人判断，未经证实</span></p>
    <div className="note-stance" role="group" aria-label={`${seat}号的个人判断`}>
      <button type="button" className={note?.stance === 'suspect' ? 'suspect chosen' : ''} aria-pressed={note?.stance === 'suspect'} onClick={() => onChange(seat, { stance: note?.stance === 'suspect' ? '' : 'suspect' })}>怀疑</button>
      <button type="button" className={note?.stance === 'trusted' ? 'trusted chosen' : ''} aria-pressed={note?.stance === 'trusted'} onClick={() => onChange(seat, { stance: note?.stance === 'trusted' ? '' : 'trusted' })}>信任</button>
      <label><span>声称身份</span><select aria-label={`${seat}号声称的身份`} value={note?.claim ?? ''} onChange={event => onChange(seat, { claim: event.target.value as Role | '' })}>
        <option value="">未标记</option>
        {Object.entries(ROLE_NAMES).map(([role, name]) => <option key={role} value={role}>{name}</option>)}
      </select></label>
    </div>
  </div>;
}
