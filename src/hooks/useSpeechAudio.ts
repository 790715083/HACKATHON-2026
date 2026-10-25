'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlayerView, VisibleEvent } from '@/lib/game/types';

export function useSpeechAudio(game: PlayerView | null, enabled: boolean, suspended: boolean) {
  const [playingEvent,setPlayingEvent]=useState<VisibleEvent|null>(null);
  const [error,setError]=useState('');
  const [pending,setPending]=useState(0);
  const queue=useRef<VisibleEvent[]>([]), seen=useRef(new Set<string>()), gameId=useRef('');
  const audio=useRef<HTMLAudioElement|null>(null), request=useRef<AbortController|null>(null);
  const active=useRef(false), version=useRef(0), blocked=useRef(false);
  const enabledRef=useRef(enabled), suspendedRef=useRef(suspended);
  enabledRef.current=enabled; suspendedRef.current=suspended;
  const stop=useCallback(()=>{
    version.current++; request.current?.abort(); request.current=null;
    if(audio.current) { audio.current.pause(); audio.current.dispatchEvent(new Event('ended')); audio.current=null; }
    queue.current=[]; active.current=false; setPending(0); setPlayingEvent(null);
  },[]);
  const pump=useCallback(async()=>{
    if(active.current||blocked.current||!enabledRef.current||suspendedRef.current)return;
    active.current=true;
    const v=version.current;
    while(queue.current.length&&v===version.current&&enabledRef.current&&!suspendedRef.current&&!blocked.current) {
      const event=queue.current.shift()!; setPending(queue.current.length);
      const controller=new AbortController(); request.current=controller;
      let url='';
      try {
        const res=await fetch('/api/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({gameId:gameId.current,eventId:event.id}),signal:controller.signal});
        if(!res.ok) {const data=await res.json().catch(()=>({}));throw new Error(data.error||'配音暂时不可用，请稍后重试。');}
        const blob=await res.blob();
        if(v!==version.current)break;
        url=URL.createObjectURL(blob); const player=new Audio(url); audio.current=player;
        await new Promise<void>((resolve,reject)=>{
          player.onended=()=>resolve();player.onerror=()=>reject(new Error('音频播放失败，请点击重播。'));
          player.play().then(()=>{if(v===version.current)setPlayingEvent(event);}).catch(()=>reject(new Error('浏览器暂未允许声音播放，请点击重播。')));
        });
      } catch(e) {
        if(!controller.signal.aborted&&v===version.current) {setError(e instanceof Error?e.message:'配音失败');blocked.current=true;queue.current=[];setPending(0);}
      } finally {if(url)URL.revokeObjectURL(url);if(v===version.current){audio.current=null;setPlayingEvent(null);}}
    }
    if(v===version.current) {active.current=false;setPlayingEvent(null);}
  },[]);
  const replay=useCallback((event:VisibleEvent)=>{
    if(!enabledRef.current||suspendedRef.current)return;
    stop();blocked.current=false;setError('');queue.current=[event];setPending(1);void pump();
  },[stop,pump]);
  const clearError=useCallback(()=>{blocked.current=false;setError('');},[]);
  useEffect(()=>{
    if(!game)return;
    if(game.id!==gameId.current) {stop();gameId.current=game.id;seen.current=new Set(game.events.map(e=>e.id));blocked.current=false;setError('');return;}
    for(const event of game.events) {
      if(seen.current.has(event.id))continue;
      seen.current.add(event.id);
      const speaker=game.players.find(p=>p.seat===event.seat);
      if(event.type==='speech'&&speaker&&!speaker.isHuman&&enabled&&!suspended&&!blocked.current) queue.current.push(event);
    }
    setPending(queue.current.length);void pump();
  },[game,enabled,suspended,pump,stop]);
  useEffect(()=>{if(!enabled||suspended)stop();else{blocked.current=false;void pump();}},[enabled,suspended,stop,pump]);
  useEffect(()=>()=>stop(),[stop]);
  return {playingSeat:playingEvent?.seat??null,playingEvent,pending,error,replay,stop,clearError};
}

export function unlockAudio() {
  try { const context=new AudioContext();const buffer=context.createBuffer(1,1,22050);const source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination);source.start();void context.resume().then(()=>context.close()); } catch { /* Audio remains optional. */ }
}
