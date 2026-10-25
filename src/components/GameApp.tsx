'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, AudioLines, BookOpen, Check, ChevronRight, CircleHelp, Eye, History, LoaderCircle, Mic, Moon, Pause, Play, RefreshCw, Send, Shield, Skull, Sparkles, Square, Sun, Type, UsersRound, Volume2, VolumeX, X } from 'lucide-react';
import { ROLE_NAMES, type GameResponse, type PlayerView, type Role, type StreamEvent, type TurnKind, type VisiblePlayer } from '@/lib/game/types';
import { Forest } from './Forest';
import { Portrait } from './Portrait';
import { Emblem } from './Emblem';
import { Modal } from './Modal';
import { useSpeechAudio, unlockAudio } from '@/hooks/useSpeechAudio';
import { useRecorder } from '@/hooks/useRecorder';
import { usePlayerNotes } from '@/hooks/usePlayerNotes';
import { GameHistory } from './GameHistory';
import { PlayerNotes } from './PlayerNotes';
import { MobileActionDock } from './MobileActionDock';
import { savePotionReason, targetPresentation, unavailableTargetReason } from '@/lib/ui/game-presentation';

const roleDetails: Record<Role, {subtitle:string;description:string}> = {
  villager: {subtitle:'以言辞为刃，以逻辑为盾',description:'你没有夜间技能。记住每一份证词，观察每一次投票，与好人一起找出全部狼人。'},
  werewolf: {subtitle:'藏起獠牙，走进人群',description:'你知道狼队友的身份。夜间与队友合议袭击目标，白天通过发言隐藏身份，让村民或神职全部出局。'},
  seer: {subtitle:'透过迷雾，看见真相',description:'每个夜晚，可以查验另一名存活玩家的阵营。查验结果只对你可见，何时公开由你决定。'},
  witch: {subtitle:'一念救赎，一念终结',description:'你有一瓶解药和一瓶毒药，每夜最多用一瓶。解药只能救狼刀目标，只有首夜可以自救。'},
  hunter: {subtitle:'最后一声枪响，交给真相',description:'出局时可以开枪带走一名存活玩家，也可以放弃。被女巫毒死时无法开枪。'},
};
const previewNames=['你','林序','夏眠','闻舟','许知微','陆沉','白榆','顾野','苏晚'];
const speechKinds=new Set<TurnKind>(['speech','wolf_chat','last_words','pk_speech']);
const targetLabels:Partial<Record<TurnKind,string>>={wolf_vote:'选择今夜袭击的目标',seer:'选择今晚查验的玩家',vote:'投出你的放逐票',pk_vote:'为本轮 PK 投票',hunter:'选择你的开枪目标'};

function Brand({onClick}:{onClick?:()=>void}) {return <button className="brand" onClick={onClick} aria-label="月下疑局，返回大厅"><span className="brand-mark"><Moon size={29} strokeWidth={1.3}/><span>✦</span></span><span><b>月下疑局</b><small>MOONLIT VERDICT</small></span></button>;}
function PhasePill({game}:{game:PlayerView}) {return <span className={`phase-pill ${game.phase}`} >{game.phase==='night'?<Moon size={14}/>:game.phase==='ended'?<Shield size={14}/>:<Sun size={14}/>} {game.phase==='ended'?'终局':`第 ${game.day} ${game.phase==='night'?'夜':'天'}`}</span>;}
async function readResponse(res:Response) {const data=await res.json();if(!res.ok)throw new Error(data.error||'操作未完成，请稍后重试。');return data;}

export default function GameApp() {
  const [game,setGame]=useState<PlayerView|null>(null),[ready,setReady]=useState(false),[configured,setConfigured]=useState(false),[showLobby,setShowLobby]=useState(true);
  const [preferredRole,setPreferredRole]=useState<Role|'random'>('random'),[name,setName]=useState('旅人'),[busy,setBusy]=useState(false),[processing,setProcessing]=useState(false),[error,setError]=useState('');
  const [voice,setVoice]=useState(true),[preferencesLoaded,setPreferencesLoaded]=useState(false),[rules,setRules]=useState(false),[identity,setIdentity]=useState(false),[confirmNew,setConfirmNew]=useState(false),[historyOpen,setHistoryOpen]=useState(false);
  const [draft,setDraft]=useState(''),[selected,setSelected]=useState<number|null>(null),[potion,setPotion]=useState<'save'|'poison'|'pass'>('pass'),[detail,setDetail]=useState<VisiblePlayer|null>(null);
  const [textSize,setTextSize]=useState<'standard'|'large'>('standard');
  const [actionFeedback,setActionFeedback]=useState<{gameId:string;turnId:string;text:string}|null>(null);
  const {notes,updateNote}=usePlayerNotes(game?.id);
  const actionAnchor=useRef<HTMLDivElement|null>(null);
  const closeHistory=useCallback(()=>setHistoryOpen(false),[]);
  const [live,setLive]=useState<{seat:number;text:string;turnId:string}|null>(null);
  const gameRef=useRef(game),flow=useRef(0),advancing=useRef<AbortController|null>(null),mounted=useRef(true);
  const audio=useSpeechAudio(game,voice,showLobby||!!game?.paused);
  const appendTranscript=useCallback((text:string)=>setDraft(current=>`${current}${current?' ':''}${text}`.slice(0,1200)),[]);
  const recorder=useRecorder(appendTranscript,audio.stop);
  gameRef.current=game;
  const applyView=useCallback((next:PlayerView)=>{gameRef.current=next;setGame(next);},[]);
  const abortFlow=useCallback(()=>{flow.current++;advancing.current?.abort();advancing.current=null;setProcessing(false);setLive(null);},[]);

  useEffect(()=>{
    mounted.current=true;const controller=new AbortController();
    try{const preference=localStorage.getItem('moonlit-voice');if(preference!==null)setVoice(preference==='true');if(localStorage.getItem('moonlit-text-size')==='large')setTextSize('large');}catch{/* Browser preferences are optional. */}setPreferencesLoaded(true);
    fetch('/api/game',{signal:controller.signal}).then(readResponse).then((data:GameResponse)=>{if(!mounted.current)return;setConfigured(data.configured);if(data.game){applyView(data.game);setShowLobby(false);}setReady(true);}).catch(e=>{if(!controller.signal.aborted){setError(e.message);setReady(true);}});
    return()=>{mounted.current=false;controller.abort();advancing.current?.abort();};
  },[applyView]);
  useEffect(()=>{if(preferencesLoaded)try{localStorage.setItem('moonlit-voice',String(voice));}catch{/* Continue without local preferences. */}},[voice,preferencesLoaded]);
  useEffect(()=>{setDraft('');setSelected(null);setPotion('pass');recorder.cancel();},[game?.turn?.id,recorder.cancel]);
  useEffect(()=>{if(preferencesLoaded)try{localStorage.setItem('moonlit-text-size',textSize);}catch{/* Text size remains available for this session. */}},[textSize,preferencesLoaded]);
  useEffect(()=>{
    const desktop=window.matchMedia('(min-width: 961px)');
    const closeOnDesktop=()=>{if(desktop.matches)setHistoryOpen(false);};
    desktop.addEventListener('change',closeOnDesktop);
    return()=>desktop.removeEventListener('change',closeOnDesktop);
  },[]);
  useEffect(()=>{if(game?.turn&&actionFeedback&&game.turn.id!==actionFeedback.turnId)setActionFeedback(null);},[game?.turn,actionFeedback]);

  const advance=useCallback(async()=>{
    const current=gameRef.current;if(!current||advancing.current||current.paused||current.turn||(current.phase==='ended'&&current.review))return;
    const controller=new AbortController();advancing.current=controller;const v=flow.current;setProcessing(true);
    try {
      const res=await fetch('/api/game/advance',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({gameId:current.id}),signal:controller.signal});
      if(!res.ok){await readResponse(res);return;}if(!res.body)throw new Error('连接中断，请重试。');
      const reader=res.body.getReader(),decoder=new TextDecoder();let buffer='';
      const dispatch=(packet:string)=>{const raw=packet.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(!raw||v!==flow.current)return;let event:StreamEvent;try{event=JSON.parse(raw);}catch{return;}
        if(event.type==='state'){applyView(event.game);setLive(null);}else if(event.type==='speech'){setLive({seat:event.seat,text:event.text,turnId:event.turnId});}else if(event.type==='error'){setError(event.message);setLive(null);}};
      while(true){const {done,value}=await reader.read();buffer+=decoder.decode(value,{stream:!done}).replace(/\r\n/g,'\n');let boundary:number;while((boundary=buffer.indexOf('\n\n'))>=0){dispatch(buffer.slice(0,boundary));buffer=buffer.slice(boundary+2);}if(done){if(buffer.trim())dispatch(buffer);break;}}
    }catch(e){if(!controller.signal.aborted&&v===flow.current)setError(e instanceof Error?e.message:'连接失败，请重试。');}
    finally{if(advancing.current===controller){advancing.current=null;setProcessing(false);setLive(null);}}
  },[applyView]);
  useEffect(()=>{if(ready&&!showLobby&&!busy&&!processing&&!error&&game&&!game.paused&&!game.turn&&(game.phase!=='ended'||!game.review))void advance();},[ready,showLobby,busy,processing,error,game,advance]);

  const createGame=async()=>{
    unlockAudio();abortFlow();audio.stop();recorder.cancel();setBusy(true);setError('');setActionFeedback(null);setConfirmNew(false);
    try{const data=await readResponse(await fetch('/api/game',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({preferredRole,name:name.trim()||'旅人'})}));applyView(data.game);setShowLobby(false);setIdentity(true);}
    catch(e){setError(e instanceof Error?e.message:'无法开始对局');}finally{setBusy(false);}
  };
  const control=async(mode:'pause'|'resume')=>{
    const current=gameRef.current;if(!current)return;
    abortFlow();audio.stop();recorder.cancel();setBusy(true);setError('');
    try{const data=await readResponse(await fetch('/api/game/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({control:mode,gameId:current.id,revision:current.revision,actionId:crypto.randomUUID()})}));applyView(data.game);}
    catch(e){setError(e instanceof Error?e.message:'操作失败');}finally{setBusy(false);}
  };
  const submit=async(override?:{targetSeat?:number|null;text?:string;use?:'save'|'poison'|'pass'})=>{
    const current=gameRef.current,turn=current?.turn;if(!current||!turn||busy)return;
    const skipped=override?.targetSeat===null&&turn.canSkip&&turn.kind!=='witch';
    const picked=override&&'targetSeat'in override?override.targetSeat??null:selected;
    const decision=!speechKinds.has(turn.kind)?targetPresentation(turn,current.players,picked,override?.use??potion):null;
    if(decision&&!skipped&&!decision.valid){setError(decision.summary);return;}
    setBusy(true);setError('');recorder.cancel();audio.stop();
    try{const data=await readResponse(await fetch('/api/game/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({gameId:current.id,revision:current.revision,turnId:turn.id,actionId:crypto.randomUUID(),kind:turn.kind,text:override?.text??draft.trim(),targetSeat:override&&'targetSeat'in override?override.targetSeat:selected,use:override?.use??potion})}));applyView(data.game);
      const target=current.players.find(player=>player.seat===(turn.kind==='witch'&&potion==='save'?turn.wolfVictim:picked));
      const message=speechKinds.has(turn.kind)?'发言已提交':skipped?(turn.kind==='hunter'?'已放弃开枪':'已提交弃票'):`已提交：${decision?.label}${target?` · ${target.name}`:''}`;
      setActionFeedback({gameId:current.id,turnId:turn.id,text:message});
    }
    catch(e){setError(e instanceof Error?e.message:'操作失败');const response=await fetch('/api/game').then(readResponse).catch(()=>null);if(response?.game)applyView(response.game);}
    finally{setBusy(false);}
  };
  const goLobby=async()=>{if(game&&game.phase!=='ended'&&!game.paused)await control('pause');else abortFlow();audio.stop();recorder.cancel();setShowLobby(true);};
  const continueGame=async()=>{unlockAudio();setShowLobby(false);if(game?.paused)await control('resume');};
  const retry=async()=>{
    setError('');
    if(game?.paused){await control('resume');return;}
    try{
      const data:GameResponse=await fetch('/api/game').then(readResponse);
      setConfigured(data.configured);setReady(true);
      if(data.game)applyView(data.game);
    }catch(e){setReady(true);setError(e instanceof Error?e.message:'无法连接本地服务，请稍后重试。');}
  };
  const turn=game?.turn;
  const speechTurn=!!turn&&speechKinds.has(turn.kind);
  const latestSpeech=useMemo(()=>game?.events.toReversed().find(e=>e.type==='speech'||e.type==='wolf_chat')??null,[game?.events]);
  const activeSpeech=audio.playingEvent?{seat:audio.playingEvent.seat,text:audio.playingEvent.text,source:'audio' as const}:live?{seat:live.seat,text:live.text,source:'live' as const}:latestSpeech?{seat:latestSpeech.seat,text:latestSpeech.text,source:'history' as const}:null;
  const privateFocus=game?.phase==='night'&&!audio.playingEvent&&!live;
  const speakerSeat=activeSpeech?.seat;
  const speaker=game?.players.find(p=>p.seat===speakerSeat);
  const displaySpeech=activeSpeech?.text??'';
  const alive=game?.players.filter(p=>p.alive).length??9;
  const roles=(Object.keys(ROLE_NAMES)as Role[]);

  const targeting=!!turn&&!speechTurn&&(turn.kind!=='witch'||potion==='poison')&&!game?.paused;
  const decision=turn&&!speechTurn?targetPresentation(turn,game?.players??[],selected,potion):null;
  const chooseTarget=(seat:number)=>{if(busy||game?.paused)return;setSelected(seat);setActionFeedback(null);};
  const actionTitle=game?.paused?'对局已暂停':turn?speechTurn?(turn.kind==='wolf_chat'?'与狼队交换看法':turn.kind==='last_words'?'留下你的最后证词':turn.kind==='pk_speech'?'为自己作最后的辩护':'说出你的判断'):turn.kind==='witch'?'今夜，你将如何抉择？':targetLabels[turn.kind]:!game?.me.alive?'你已出局，可以继续观战':processing?'其他玩家正在行动':'故事正在继续';

  return <div className={`app-shell ${showLobby?'is-lobby':'is-game'} ${textSize==='large'?'text-large':''}`}>
    <Forest compact={!showLobby}/>
    <header className="topbar" inert={historyOpen}><Brand onClick={()=>void goLobby()}/><div className="header-right">{!showLobby&&game&&<><PhasePill game={game}/><span className="header-divider"/></>}<button className={`icon-button ${voice?'':'muted'}`} onClick={()=>{unlockAudio();audio.clearError();setVoice(v=>!v);}} aria-label={voice?'关闭 AI 配音':'开启 AI 配音'} title={voice?'关闭 AI 配音':'开启 AI 配音'}>{voice?<Volume2 size={19}/>:<VolumeX size={19}/>}</button><button className="icon-button text-size-button" onClick={()=>setTextSize(size=>size==='standard'?'large':'standard')} aria-label={textSize==='standard'?'放大文字':'恢复标准字号'} aria-pressed={textSize==='large'} title={textSize==='standard'?'放大文字':'恢复标准字号'}><Type size={19}/></button><button className="rules-button" aria-label="游戏规则" onClick={()=>setRules(true)}><BookOpen size={16}/><span>游戏规则</span></button>{!showLobby&&game&&<button className="icon-button mobile-only" onClick={()=>setHistoryOpen(true)} aria-label="打开对局手记"><History size={19}/></button>}</div></header>

    {showLobby?<main className="lobby">
      <section className="lobby-copy"><div className="lobby-kicker"><span/>一人入席 · 八位 AI · 无数种真相</div><h1>长夜将至。<br/><span>谁在说谎？</span></h1><p className="hero-description">围坐月光之下，听一场真假难辨的辩白。<br/>你的直觉，会是全村最后的希望吗？</p><div className="lobby-features"><span><UsersRound size={15}/>经典九人局</span><span><AudioLines size={15}/>AI 角色配音</span><span><Moon size={15}/>沉浸推理体验</span></div>
      <div className="setup-panel"><div className="setup-panel-heading"><span className="eyebrow">TAKE YOUR SEAT</span><span className="tiny-stamp">NO. 01 — YOU</span></div><label className="name-label" htmlFor="player-name">如何称呼你</label><div className="name-field"><span>01</span><input id="player-name" value={name} onChange={e=>setName(e.target.value.slice(0,16))} maxLength={16} placeholder="输入你的名字" autoComplete="off"/><span className="field-note">你的席位</span></div><div className="role-select-label"><span>选择你的身份</span><span>也可以，把命运交给月亮</span></div><div className="role-options"><button className={preferredRole==='random'?'chosen':''} aria-pressed={preferredRole==='random'} onClick={()=>setPreferredRole('random')}><Sparkles size={18}/><span>随机</span></button>{roles.map(role=><button key={role} className={preferredRole===role?'chosen':''} aria-pressed={preferredRole===role} onClick={()=>setPreferredRole(role)} title={roleDetails[role].description}><Emblem role={role} size={18}/><span>{ROLE_NAMES[role]}</span></button>)}</div><button className="primary-button start-button" disabled={busy||!ready||!configured} onClick={()=>game&&game.phase!=='ended'?setConfirmNew(true):void createGame()}>{busy?<LoaderCircle className="spin" size={19}/>:<Moon size={20}/>}<span>{!ready?'正在准备牌桌':busy?'正在布置牌桌':'进入这场疑局'}</span><ArrowRight size={19}/></button>{preferredRole!=='random'&&<p className="selected-role-hint">{roleDetails[preferredRole].description}</p>}{game&&<button className="continue-button" onClick={()=>void continueGame()} disabled={busy}><History size={15}/>继续{game.phase==='ended'?'查看上局':'上次的疑局'}<span>第 {game.day} {game.phase==='night'?'夜':'天'}</span><ChevronRight size={16}/></button>}{ready&&!configured&&<p className="configuration-note"><CircleHelp size={15}/>请在服务端设置 ZHIPU_API_KEY 后重启，牌桌就准备好了。</p>}<p className="setup-note"><Shield size={12}/>无需登录 · 对局进度自动保存在本机</p></div>
      </section>
      <section className="lobby-art" aria-label="等待入席的 AI 玩家"><div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/><div className="art-orbit orbit-three"/><div className="art-caption"><span>UNDER THE SAME MOON</span><b>九个身份。<br/>一场关于信任的冒险。</b><i>✦</i></div>{[1,2,3,4,5,6].map((avatar,i)=><div className={`preview-card preview-${i}`} key={avatar}><Portrait avatar={avatar}/><div><span>{String(avatar+1).padStart(2,'0')}</span><b>{previewNames[avatar]}</b><small>等待入席</small></div></div>)}<div className="art-seal"><Moon size={27} strokeWidth={1}/><span>THE NIGHT<br/>KNOWS</span></div><div className="art-bottom"><span className="decor-line"/><span>真相藏在每一句话的背后</span><span className="decor-line"/></div></section>
      <footer className="lobby-footer"><span>MOONLIT VERDICT <i>✦</i> 月下疑局</span><span>耳听未必为实。你的判断，才是答案。</span><span className="version-note">LOCAL EDITION / 01</span></footer>
    </main>:game?<main className="game-layout"><section className="game-main" inert={historyOpen}>
      <div className="game-heading"><div><div className="eyebrow"><span className="live-dot"/>THE VILLAGE IS WATCHING</div><h1>{game.phase==='ended'?'真相，终于浮出水面。':game.phase==='night'?'月光照不到的地方。':'每一句话，都可能是线索。'}</h1></div><div className="game-heading-meta"><span><UsersRound size={15}/>{alive}<small>/ 9 人存活</small></span><button className="text-button" aria-label={game.paused?'继续对局':'暂停对局'} onClick={()=>void control(game.paused?'resume':'pause')} disabled={busy||game.phase==='ended'}>{game.paused?<Play size={14}/>:<Pause size={14}/>}<span>{game.paused?'继续对局':'暂停'}</span></button></div></div>
      <div className={`table-area phase-${game.phase}`}><div className="table-rings"><div/><div/><div/><span className="ring-cross cross-top">✦</span><span className="ring-cross cross-bottom">✦</span></div><div className="table-center">{game.phase==='ended'?<><Shield className="center-symbol" size={40} strokeWidth={1}/><span className="eyebrow">THE FINAL VERDICT</span><h2>{game.winner==='village'?'好人阵营获胜':game.winner==='wolves'?'狼人阵营获胜':'双方平局'}</h2><p>面具落下，故事仍会继续。</p><button className="text-button gold" onClick={()=>document.querySelector('#final-review')?.scrollIntoView({behavior:'smooth'})}>查看终局复盘<ArrowRight size={14}/></button></>:<><div className="center-symbol">{game.phase==='night'?<Moon size={38} strokeWidth={1}/>:<Sun size={38} strokeWidth={1}/>}</div><span className="eyebrow">{game.paused?'THE VILLAGE RESTS':game.phase==='night'?'THE NIGHT HAS FALLEN':'DAYLIGHT BRINGS QUESTIONS'}</span><h2>{game.paused?'时光暂歇':`第 ${game.day} ${game.phase==='night'?'夜':'天'}`}</h2><div className="center-divider"><span/>✦<span/></div><p>{game.paused?'准备好时，让故事继续。':game.turn?`轮到你了，${game.players.find(player=>player.isHuman)?.name??'旅人'}。`:game.phase==='night'?'请保持安静，夜晚正在发生。':'听清他们的每一句话。'}</p><span className="board-type">经典 · 九人屠边局</span></> }</div>
      <div className="players-ring">{game.players.map((player,index)=>{const angle=(90+index*40)*Math.PI/180;const style={'--x':`${50+Math.cos(angle)*40}%`,'--y':`${50+Math.sin(angle)*37}%`,'--delay':`${index*45}ms`}as React.CSSProperties;const reason=targeting&&turn?unavailableTargetReason(player,turn,game.me):null;const targetable=targeting&&!reason;const speaking=player.seat===speakerSeat&&(activeSpeech?.source==='audio'||activeSpeech?.source==='live');return <button key={player.seat} style={style} className={`player-card ${player.isHuman?'is-you':''} ${!player.alive?'is-dead':''} ${speaking?'is-speaking':''} ${targetable?'is-targetable':''} ${selected===player.seat&&targetable?'is-selected':''} ${targeting&&reason?'is-unavailable':''}`} disabled={busy&&targeting} onClick={()=>targetable?chooseTarget(player.seat):setDetail(player)} aria-pressed={targeting?selected===player.seat&&targetable:undefined} title={reason??(targetable?'点击选择目标':'查看人物与个人标记')} aria-label={`${player.seat}号 ${player.name}${player.alive?'，存活':'，已出局'}${targetable?'，选择目标':reason?`，不可选择：${reason}，点击查看人物`:''}`}><div className="player-portrait"><Portrait avatar={player.avatar}/><span className="seat-number">{String(player.seat).padStart(2,'0')}</span>{!player.alive&&<span className="dead-overlay"><Skull size={24}/><span>已出局</span></span>}{selected===player.seat&&targetable&&<span className="selected-check"><Check size={16}/></span>}{speaking&&<div className="speaking-lines"><i/><i/><i/><i/></div>}</div><div className="player-info"><b>{player.name}{player.isHuman&&<small>你</small>}</b>{notes[player.seat]?.stance&&<i className={`seat-note ${notes[player.seat].stance}`}>{notes[player.seat].stance==='suspect'?'疑':'信'}</i>}<span>{player.role?<><Emblem role={player.role} size={11}/>{ROLE_NAMES[player.role]}</>:<><span className={`mini-dot ${player.alive?'':'dead'}`}/>{player.alive?'身份未知':'静候真相'}</>}</span></div></button>;})}</div></div>
      {game.phase!=='ended'&&<div className={`speech-focus ${game.phase==='night'?'night-focus':''}`}><div className="speech-avatar">{speaker&&!privateFocus?<Portrait avatar={speaker.avatar}/>:<Moon size={23} strokeWidth={1}/>}</div><div className="speech-focus-body"><div className="speech-focus-head"><b>{privateFocus?'夜间密语':speaker?`${speaker.seat} 号 · ${speaker.name}`:'月下议事'}</b><span>{activeSpeech?.source==='audio'?'正在配音':activeSpeech?.source==='live'?'正在发言':privateFocus?'仅与你有关的信息可见':'最近的发言'}</span>{voice&&latestSpeech&&!privateFocus&&<button className="icon-button" title="重播这段发言" aria-label="重播最近发言" onClick={()=>{unlockAudio();audio.replay(latestSpeech);}}><Volume2 size={14}/></button>}</div><p>{privateFocus?(game.events.toReversed().find(e=>e.type==='private'||e.type==='wolf_chat')?.text??'天黑请闭眼。有夜间技能时，主持人会在下方提示你行动。'):displaySpeech||'白昼即将到来。请留意每位玩家的发言与票型。'}{activeSpeech?.source==='live'&&<span className="typing-caret"/>}</p></div></div>}
      {voice&&audio.error&&<div className="notice voice-notice"><VolumeX size={17}/><span><b>配音暂不可用</b>{audio.error}</span><button onClick={()=>setVoice(false)}>继续文字</button>{latestSpeech&&<button onClick={()=>{unlockAudio();audio.replay(latestSpeech);}}>重试</button>}</div>}
      {game.phase==='ended'?<section className="final-review" id="final-review"><div className="eyebrow">AFTER THE MASKS FALL</div><h2>这一局，我们离真相有多近？</h2><p>{game.review||'所有身份已揭晓。你可以在右侧回看每一次发言与投票，寻找藏在细节里的线索。'}</p><button className="primary-button" onClick={()=>{setShowLobby(true);setError('');}}><RefreshCw size={16}/>再入一场疑局<ArrowRight size={17}/></button></section>:<section id="your-action" className={`action-panel ${turn?'your-turn':''}`}>
        <div className="action-heading"><button className="identity-chip" onClick={()=>setIdentity(true)}><Emblem role={game.me.role} size={19}/><span><small>你的身份</small><b>{ROLE_NAMES[game.me.role]}</b></span><ChevronRight size={14}/></button><div className="action-title"><span className="eyebrow">{game.paused?'PAUSED':turn?'YOUR MOVE':!game.me.alive?'SPECTATOR MODE':'THE STORY UNFOLDS'}</span><h3>{actionTitle}</h3></div>{processing&&!game.paused&&<LoaderCircle size={19} className="spin muted-text"/>}{game.paused&&<button className="primary-button small" onClick={()=>void control('resume')} disabled={busy}><Play size={15}/>继续对局</button>}</div>
        {turn&&!game.paused&&(speechTurn?<><div className={`speech-input ${recorder.recording?'is-recording':''}`}><textarea id="speech-draft" aria-label={turn.kind==='wolf_chat'?'狼队发言':'你的发言'} value={draft} onChange={e=>setDraft(e.target.value.slice(0,1200))} placeholder={turn.kind==='wolf_chat'?'这段话只有狼队友能听见……':'谁值得信任，谁的发言藏着破绽？说出你的推理……'} rows={3} maxLength={1200} disabled={busy||recorder.transcribing}/>{recorder.recording&&<div className="recording-overlay"><span className="recording-dot"/><AudioLines size={23}/><b>正在聆听</b><span>00:{String(recorder.seconds).padStart(2,'0')} / 00:30</span></div>}</div><div className="speech-controls"><div className="record-controls"><button className={`record-button ${recorder.recording?'recording':''}`} disabled={busy||recorder.starting||recorder.transcribing} onClick={()=>recorder.recording?void recorder.stop():void recorder.start()}>{recorder.transcribing||recorder.starting?<LoaderCircle className="spin" size={16}/>:recorder.recording?<Square size={13} fill="currentColor"/>:<Mic size={17}/>}<span>{recorder.transcribing?'正在转写':recorder.starting?'打开麦克风':recorder.recording?'结束录音':'语音发言'}</span></button>{recorder.recording&&<button className="text-button" onClick={recorder.cancel}>取消</button>}<span className="input-note">{draft.length}/1200</span></div><button className="primary-button small" disabled={busy||!draft.trim()||recorder.recording||recorder.starting||recorder.transcribing} onClick={()=>void submit()}>{busy?<LoaderCircle className="spin" size={15}/>:<Send size={15}/>}结束发言</button></div>{recorder.error&&<p className="inline-error"><CircleHelp size={14}/>{recorder.error}</p>}</>:<><div className="target-area">
          {turn.kind==='witch'&&<div className="potion-options">
            <button className={`potion-save ${potion==='save'?'selected':''}`} aria-pressed={potion==='save'} disabled={!turn.canSave||busy} onClick={()=>{setPotion('save');setSelected(turn.wolfVictim??null);setActionFeedback(null);}}><Shield size={22}/><span><b>使用解药</b><small>{savePotionReason(turn,game.me,game.day)}</small></span></button>
            <button className={`potion-poison ${potion==='poison'?'selected danger':''}`} aria-pressed={potion==='poison'} disabled={!turn.canPoison||busy} onClick={()=>{setPotion('poison');setSelected(null);setActionFeedback(null);}}><Skull size={22}/><span><b>使用毒药</b><small>{turn.canPoison?'选择一名玩家':'毒药已用完'}</small></span></button>
            <button className={potion==='pass'?'selected':''} aria-pressed={potion==='pass'} disabled={busy} onClick={()=>{setPotion('pass');setSelected(null);setActionFeedback(null);}}><Moon size={22}/><span><b>今夜不用药</b><small>保留剩余药剂</small></span></button>
          </div>}
          {(turn.kind!=='witch'||potion==='poison')&&<div className="target-options" role="group" aria-label="选择行动目标">{turn.choices.map(seat=>{const p=game.players.find(item=>item.seat===seat)!;return <button className={selected===seat?'selected':''} aria-pressed={selected===seat} key={seat} onClick={()=>chooseTarget(seat)} disabled={busy}><span>{String(seat).padStart(2,'0')}</span>{p.name}{selected===seat&&<Check size={15}/>}</button>;})}</div>}
        </div>
        <div className={`target-footer decision-${decision?.tone}`}>
          <p className="target-summary" role="status" aria-live="polite">{decision?.summary}</p>
          <div>{turn.canSkip&&turn.kind!=='witch'&&<button className="secondary-button small" disabled={busy} onClick={()=>void submit({targetSeat:null})}>{turn.kind==='hunter'?'放弃开枪':turn.kind==='seer'?'跳过查验':'弃票'}</button>}
          <button className={`primary-button small decision-${decision?.tone}`} disabled={busy||!decision?.valid} onClick={()=>void submit()}>{busy?<LoaderCircle className="spin" size={16}/>:<Check size={16}/>} {busy?'正在提交':decision?.label}</button></div>
        </div></>)}
        {!turn&&!game.paused&&<div className="waiting-note"><span className="waiting-dots"><i/><i/><i/></span><span>{game.phase==='night'?'夜晚的信息只属于相应的身份。请等待主持人的提示。':!game.me.alive?'你的故事告一段落，村庄的命运仍在继续。':'下一位玩家正在整理思绪，请稍候。'}</span>{audio.pending>0&&<button className="text-button" onClick={audio.stop}>跳过配音 ({audio.pending})</button>}</div>}
        <div ref={actionAnchor} className="action-anchor"/>
      </section>}
      {actionFeedback?.gameId===game.id&&<p className="action-feedback" role="status"><Check size={16}/>{actionFeedback.text}</p>}
      <footer className="game-footer"><span><Shield size={12}/>你的隐藏信息只对你可见</span><button className="text-button" onClick={()=>void goLobby()}><ArrowLeft size={13}/>返回大厅</button><span>MOONLIT VERDICT · LOCAL EDITION</span></footer>
      </section><aside className={`history-panel ${historyOpen?'is-open':''}`} role={historyOpen?'dialog':undefined} aria-modal={historyOpen||undefined} aria-label="对局手记"><GameHistory key={game.id} game={game} isOpen={historyOpen} onClose={closeHistory} onReplay={voice?audio.replay:undefined} notes={notes} onNoteChange={updateNote}/></aside>{historyOpen&&<button className="drawer-backdrop" aria-label="关闭对局手记" onClick={()=>setHistoryOpen(false)}/>}{game.phase!=='ended'&&<MobileActionDock key={game.id} anchor={actionAnchor} title={game.paused?'对局已暂停':turn?'轮到你行动':!game.me.alive?'观战中':'对局进行中'} detail={actionFeedback?.gameId===game.id?actionFeedback.text:decision?.valid?decision.summary:actionTitle??''} label={turn?(speechTurn?'前往发言':decision?.valid?decision.label:'选择目标'):''} tone={decision?.tone} canSubmit={!!turn&&!speechTurn&&!!decision?.valid} busy={busy} paused={game.paused} onSubmit={()=>void submit()} onResume={()=>void control('resume')} onHistory={()=>setHistoryOpen(true)}/>}</main>:<main className="loading-screen"><Moon size={42} strokeWidth={1}/><p>月光正在铺好牌桌……</p></main>}

    {error&&<div className="error-toast" role="alert"><CircleHelp size={20}/><div><b>对局暂歇</b><p>{error}</p></div><button onClick={()=>void retry()}><RefreshCw size={14}/>重试</button><button aria-label="关闭提示" onClick={()=>setError('')}><X size={17}/></button></div>}
    {rules&&<Modal title="在月光下，读懂规则" onClose={()=>setRules(false)}><div className="rules-content"><p className="modal-intro">一个席位属于你，另外八位玩家由 AI 扮演。身份隐藏，言辞可以伪装，唯有行动会留下痕迹。</p><div className="rules-lineup"><span>3 狼人</span><i>·</i><span>3 村民</span><i>·</i><span>预言家</span><i>·</i><span>女巫</span><i>·</i><span>猎人</span></div><h3>白昼与长夜</h3><p>夜晚，狼人合议袭击，女巫决定用药，预言家查验身份。白天公布死亡，所有存活玩家轮流发言，再投票放逐最可疑的人。</p><h3>胜负如何决定</h3><p>全部狼人出局，好人获胜。全部村民或全部神职出局，狼人获胜。猎人技能结算后才判胜；双方同次达成条件则平局。</p><h3>平票、遗言与技能</h3><p>允许弃票，不能自投。最高票平票时进行一次 PK，其他存活玩家重新投票，再次平票则无人出局。首夜遇害者和白天被放逐者可留遗言。</p><div className="rules-role-list">{roles.map(role=><div key={role}><Emblem role={role} size={20}/><div><b>{ROLE_NAMES[role]}</b><p>{roleDetails[role].description}</p></div></div>)}</div><p className="rules-hint"><Eye size={16}/>别人的身份声明并不等于真实身份。查验、夜间技能和狼队密语只会展示给有权知道的玩家。</p></div><button className="primary-button full" onClick={()=>setRules(false)}>记住了，入席吧<ArrowRight size={16}/></button></Modal>}
    {identity&&game&&<Modal title="你的身份，只有你知道" className="identity-modal" onClose={()=>setIdentity(false)}><div className={`role-reveal role-${game.me.role}`}><div className="role-reveal-emblem"><Emblem role={game.me.role} size={64} strokeWidth={.9}/></div><span className="eyebrow">{game.me.role==='werewolf'?'THE WOLF FACTION':'THE VILLAGE FACTION'}</span><h3>{ROLE_NAMES[game.me.role]}</h3><p className="role-subtitle">{roleDetails[game.me.role].subtitle}</p><p>{roleDetails[game.me.role].description}</p>{game.me.teammates.length>0&&<div className="teammate-note">你的狼队友：{game.me.teammates.map(seat=>`${seat} 号 ${game.players.find(p=>p.seat===seat)?.name}`).join('、')}</div>}</div><button className="primary-button full" onClick={()=>setIdentity(false)}>我准备好了<ArrowRight size={16}/></button></Modal>}
    {confirmNew&&<Modal title="开启一段新的故事？" onClose={()=>setConfirmNew(false)}><p className="modal-intro">当前对局将被新对局替换。新的身份与新的谎言，已经在等你。</p><div className="modal-actions"><button className="secondary-button" onClick={()=>setConfirmNew(false)}>留在当前对局</button><button className="primary-button" disabled={busy} onClick={()=>void createGame()}>开始新局<ArrowRight size={16}/></button></div></Modal>}
    {detail&&<Modal title={`${detail.seat} 号 · ${detail.name}`} className="player-modal" onClose={()=>setDetail(null)}><Portrait avatar={detail.avatar}/><div className="player-detail-copy"><span className="eyebrow">{detail.isHuman?'YOUR SEAT':'A SEAT AT THE TABLE'}</span><h3>{detail.role?ROLE_NAMES[detail.role]:'身份仍在迷雾中'}</h3><p>{detail.persona}</p>{game&&targeting&&turn&&unavailableTargetReason(detail,turn,game.me)&&<p className="unavailable-reason">不可选择：{unavailableTargetReason(detail,turn,game.me)}</p>}<PlayerNotes seat={detail.seat} note={notes[detail.seat]} onChange={updateNote}/><span className={`detail-status ${detail.alive?'':'dead'}`}>{detail.alive?'● 仍在牌桌上':'✦ 已出局，等待终局揭晓'}</span></div></Modal>}
  </div>;
}
