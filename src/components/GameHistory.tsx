import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, Eye, History, MessageCircle, Skull, Volume2, X } from 'lucide-react';
import { ROLE_NAMES, type PlayerView, type VisibleEvent, type VisiblePlayer } from '@/lib/game/types';
import { filterHistory, filterVoteRounds, tallyVotes, type PlayerNote, type PlayerNotes as Notes } from '@/lib/ui/game-presentation';
import { unlockAudio } from '@/hooks/useSpeechAudio';
import { PlayerNotes } from './PlayerNotes';

export function GameHistory({ game, isOpen, onClose, onReplay, notes, onNoteChange }: {
  game: PlayerView; isOpen: boolean; onClose: () => void; onReplay?: (event: VisibleEvent) => void;
  notes: Notes; onNoteChange: (seat: number, patch: Partial<PlayerNote>) => void;
}) {
  const [tab, setTab] = useState<'events' | 'votes'>('events');
  const [day, setDay] = useState<number | null>(null);
  const [seat, setSeat] = useState<number | null>(null);
  const [seen, setSeen] = useState(game.events.length);
  const [jump, setJump] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const previousView = useRef('events:all:all');
  const filtered = day !== null || seat !== null;
  const viewKey = `${tab}:${day ?? 'all'}:${seat ?? 'all'}`;
  const events = filterHistory(game.events, day, seat);
  const rounds = filterVoteRounds(game.voteRounds, day, seat);
  const days = [...new Set([...game.events.map(event => event.day), ...game.voteRounds.map(round => round.day)])].sort((a, b) => a - b);
  const unread = Math.max(0, game.events.length - seen);

  useEffect(() => {
    if (!isOpen) return;
    const panel = scroll.current?.closest('aside');
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel?.querySelector<HTMLButtonElement>('[aria-label="关闭记录"]')?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab' || !panel) return;
      const controls = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled), select, summary, [tabindex="0"]')]
        .filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    panel?.addEventListener('keydown', handleKey);
    return () => {
      panel?.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [isOpen, onClose]);

  useLayoutEffect(() => {
    const pane = scroll.current;
    if (!pane || pane.clientHeight === 0) return;
    if (previousView.current !== viewKey) {
      pane.scrollTop = 0;
      previousView.current = viewKey;
    }
    if (tab === 'events' && !filtered && following.current) {
      pane.scrollTop = pane.scrollHeight;
      setSeen(game.events.length);
    }
    // Streamed text lives in the speaker panel. It never moves the history viewport.
  }, [game.events.length, viewKey, tab, filtered, isOpen, jump]);

  const latest = () => {
    following.current = true;
    setTab('events'); setDay(null); setSeat(null); setSeen(game.events.length); setJump(value => value + 1);
  };
  const changeTab = (next: 'events' | 'votes') => { following.current = false; setTab(next); };

  return <>
    <div className="history-top"><div className="section-heading"><span className="eyebrow">THE CHRONICLE</span><h2>对局手记</h2></div><button className="icon-button mobile-only" aria-label="关闭记录" onClick={onClose}><X size={20}/></button></div>
    <div className="history-tabs" role="tablist" aria-label="手记类型" onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 'events' : event.key === 'End' ? 'votes' : tab === 'events' ? 'votes' : 'events';
      changeTab(next);
      document.getElementById(`history-${next}-tab`)?.focus();
    }}>
      <button role="tab" id="history-events-tab" tabIndex={tab === 'events' ? 0 : -1} aria-selected={tab === 'events'} aria-controls="history-content" className={tab === 'events' ? 'active' : ''} onClick={() => changeTab('events')}><MessageCircle size={16}/>发言记录</button>
      <button role="tab" id="history-votes-tab" tabIndex={tab === 'votes' ? 0 : -1} aria-selected={tab === 'votes'} aria-controls="history-content" className={tab === 'votes' ? 'active' : ''} onClick={() => changeTab('votes')}><History size={16}/>投票记录</button>
    </div>
    <div className="history-filters">
      <label><span>天数</span><select aria-label="按天数筛选手记" value={day ?? ''} onChange={event => { following.current = false; setDay(event.target.value ? Number(event.target.value) : null); }}><option value="">全部天数</option>{days.map(value => <option key={value} value={value}>第 {value} 天／夜</option>)}</select></label>
      <label><span>玩家</span><select aria-label="按玩家筛选手记" value={seat ?? ''} onChange={event => { following.current = false; setSeat(event.target.value ? Number(event.target.value) : null); }}><option value="">全部玩家</option>{game.players.map(player => <option key={player.seat} value={player.seat}>{player.seat} 号 · {player.name}</option>)}</select></label>
      {filtered && <button className="text-button" onClick={latest}>清除筛选</button>}
    </div>
    <div className="history-scroll" ref={scroll} id="history-content" role="tabpanel" aria-labelledby={tab === 'events' ? 'history-events-tab' : 'history-votes-tab'} tabIndex={0} onScroll={() => {
      const pane = scroll.current;
      if (!pane) return;
      following.current = tab === 'events' && !filtered && pane.scrollHeight - pane.scrollTop - pane.clientHeight < 48;
      if (following.current) setSeen(game.events.length);
    }}>
      {seat !== null && <details className="history-note-editor">
        <summary>{seat} 号 · 个人标记<span>{notes[seat]?.stance === 'suspect' ? '怀疑' : notes[seat]?.stance === 'trusted' ? '信任' : '点击添加'}{notes[seat]?.claim ? ` · 声称${ROLE_NAMES[notes[seat].claim]}` : ''}</span></summary>
        <PlayerNotes seat={seat} note={notes[seat]} onChange={onNoteChange}/>
      </details>}
      {tab === 'events' ? events.length ? events.map(event => <HistoryEvent key={event.id} event={event} players={game.players} note={event.seat ? notes[event.seat] : undefined} onReplay={onReplay}/>) :
        <div className="history-empty"><MessageCircle size={28}/><p>没有符合筛选条件的记录</p><small>试试其他天数或玩家</small></div> : rounds.length ? rounds.map(round => <article className="vote-round" key={`${round.day}:${round.round}`}>
          <span className="eyebrow">DAY {round.day} · ROUND {round.round}</span><h3>第 {round.day} 天{round.round > 1 ? ' · PK 复投' : ' · 放逐投票'}</h3>
          <p className="vote-tally-label">完整票数{seat !== null ? ` · 含 ${seat} 号投出或收到的票` : ''}</p>
          <div className="vote-tally">{tallyVotes(round).map(group => <div key={group.targetSeat ?? 'skip'}><span>{group.targetSeat === null ? '弃票' : `${group.targetSeat} 号`}</span><b>{group.count} 票</b><small>{group.voters.map(value => `${value}号`).join('、')}</small></div>)}</div>
          <details className="ballot-details"><summary>查看逐票记录</summary>{round.ballots.map(ballot => <div className={`ballot ${seat !== null && (ballot.seat === seat || ballot.targetSeat === seat) ? 'ballot-match' : ''}`} key={ballot.seat}><span>{ballot.seat} 号</span><ArrowRight size={14}/><b>{ballot.targetSeat === null ? '弃票' : `${ballot.targetSeat} 号`}</b></div>)}</details>
          <p className="vote-outcome">{round.executedSeat !== null ? `${round.executedSeat} 号被放逐` : round.tiedSeats.length ? `${round.tiedSeats.join('、')} 号平票${round.round === 1 ? '，进入 PK' : '，无人被放逐'}` : '全员弃票，无人被放逐'}</p>
        </article>) : <div className="history-empty"><History size={28}/><p>{filtered ? '没有符合条件的投票' : '投票尚未结束'}</p><small>{filtered ? '试试其他天数或玩家' : '结算后可在这里查看票数和逐票记录'}</small></div>}
    </div>
    {(unread > 0 || filtered || tab === 'votes') && <button className="history-latest" onClick={latest}><ArrowDown size={16}/>{unread > 0 ? `${unread} 条新记录 · 回到最新` : '回到最新发言'}</button>}
    <div className="history-foot"><span className="status-dot"/>进度与个人标记保存在本机</div>
  </>;
}

function HistoryEvent({ event, players, note, onReplay }: {
  event: VisibleEvent; players: VisiblePlayer[]; note?: PlayerNote; onReplay?: (event: VisibleEvent) => void;
}) {
  const player = players.find(item => item.seat === event.seat);
  const speech = typeof event.seat === 'number' && (event.type === 'speech' || event.type === 'wolf_chat');
  if (!speech) return <div className={`history-system event-${event.type}`}><span>{event.type === 'private' ? <Eye size={15}/> : event.type === 'death' ? <Skull size={15}/> : <span className="event-diamond">✦</span>}</span><p>{event.text}</p></div>;
  return <article className={`history-message ${event.type === 'wolf_chat' ? 'private-message' : ''}`}>
    <div className="message-top"><span className="message-seat">{String(event.seat).padStart(2, '0')}</span><b>{player?.name ?? `${event.seat} 号`}</b>{player?.isHuman && <i>你</i>}<small>{event.type === 'wolf_chat' ? '狼队密语' : `第 ${event.day} 天`}</small>{onReplay && event.type === 'speech' && !player?.isHuman && <button className="icon-button" aria-label={`重播${player?.name}的发言`} onClick={() => { unlockAudio(); onReplay(event); }}><Volume2 size={16}/></button>}</div>
    {(note?.stance || note?.claim) && <div className="message-note">我的标记：{note.stance === 'suspect' ? '怀疑' : note.stance === 'trusted' ? '信任' : ''}{note.claim ? ` · 声称${ROLE_NAMES[note.claim]}` : ''}<span>未经证实</span></div>}
    <p>{event.text}</p>
  </article>;
}
