export type Role = 'werewolf' | 'villager' | 'seer' | 'witch' | 'hunter';
export const ROLE_NAMES: Record<Role, string> = { werewolf: '狼人', villager: '村民', seer: '预言家', witch: '女巫', hunter: '猎人' };
export type TurnKind = 'wolf_chat' | 'wolf_vote' | 'witch' | 'seer' | 'speech' | 'vote' | 'last_words' | 'hunter' | 'pk_speech' | 'pk_vote';
export interface Turn { id: string; kind: TurnKind; actorSeat: number; choices: number[]; canSkip: boolean; canSave?: boolean; canPoison?: boolean; wolfVictim?: number; }
export interface GameAction { turnId: string; actorSeat: number; kind: TurnKind; text?: string; targetSeat?: number | null; use?: 'save' | 'poison' | 'pass'; }
export interface Player { seat: number; name: string; role: Role; alive: boolean; isHuman: boolean; persona: string; avatar: number; deathCause?: 'wolf' | 'poison' | 'execution' | 'shot'; }
export interface GameEvent { id: string; day: number; type: 'system' | 'speech' | 'wolf_chat' | 'private' | 'death' | 'vote_result' | 'review'; text: string; seat?: number; visibility: 'public' | 'private' | 'wolves'; visibleTo?: number[]; }
export interface VoteRound { day: number; round: number; ballots: { seat: number; targetSeat: number | null }[]; candidates: number[]; executedSeat: number | null; tiedSeats: number[]; }
export type Winner = 'village' | 'wolves' | 'draw';
export interface GameState {
  schemaVersion: 1; id: string; seed: number; revision: number; day: number;
  phase: 'night' | 'day' | 'ended'; paused: boolean; winner: Winner | null;
  players: Player[]; events: GameEvent[]; queue: Turn[]; voteRounds: VoteRound[];
  night: { wolfVotes: Record<number, number>; victim: number | null; saved: boolean; poison: number | null; };
  witch: { antidote: boolean; poison: boolean }; votes: Record<number, number | null>;
  pkCandidates: number[]; stage: string; afterInterrupt: string; review?: string;
  processedActions: string[]; createdAt: string; updatedAt: string;
}
export interface VisibleEvent { id: string; day: number; type: GameEvent['type']; text: string; seat?: number; }
export interface VisiblePlayer { seat: number; name: string; alive: boolean; isHuman: boolean; persona: string; avatar: number; role?: Role; }
export interface PlayerView {
  id: string; revision: number; day: number; phase: 'night' | 'day' | 'ended'; paused: boolean;
  winner: Winner | null; players: VisiblePlayer[]; me: { seat: number; role: Role; alive: boolean; teammates: number[]; antidote?: boolean; poison?: boolean; };
  turn: Turn | null; currentSpeaker: number | null; events: VisibleEvent[]; voteRounds: VoteRound[]; review?: string;
}
export interface GameResponse { game: PlayerView | null; configured: boolean; models: { chat: string; tts: string; stt: string }; error?: string; }
export type StreamEvent = { type: 'state'; game: PlayerView } | { type: 'speech'; turnId: string; seat: number; text: string } | { type: 'error'; message: string } | { type: 'done' };
