'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

function wavBlob(chunks: Float32Array[], sampleRate: number) {
  const count=chunks.reduce((sum,c)=>sum+c.length,0);
  const buffer=new ArrayBuffer(44+count*2), view=new DataView(buffer);
  const write=(offset:number,s:string)=>{for(let i=0;i<s.length;i++)view.setUint8(offset+i,s.charCodeAt(i));};
  write(0,'RIFF');view.setUint32(4,36+count*2,true);write(8,'WAVE');write(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);write(36,'data');view.setUint32(40,count*2,true);
  let offset=44;for(const chunk of chunks)for(const sample of chunk){const v=Math.max(-1,Math.min(1,sample));view.setInt16(offset,v<0?v*32768:v*32767,true);offset+=2;}
  return new Blob([buffer],{type:'audio/wav'});
}

export function useRecorder(onTranscript:(text:string)=>void,onStart:()=>void) {
  const [recording,setRecording]=useState(false),[starting,setStarting]=useState(false),[transcribing,setTranscribing]=useState(false),[seconds,setSeconds]=useState(0),[error,setError]=useState('');
  const stream=useRef<MediaStream|null>(null),context=useRef<AudioContext|null>(null),node=useRef<AudioWorkletNode|null>(null),source=useRef<MediaStreamAudioSourceNode|null>(null),gain=useRef<GainNode|null>(null);
  const samples=useRef<Float32Array[]>([]),timer=useRef<ReturnType<typeof setInterval>|null>(null),limit=useRef<ReturnType<typeof setTimeout>|null>(null),request=useRef<AbortController|null>(null),version=useRef(0),rate=useRef(16000),isRecording=useRef(false);
  const transcriptRef=useRef(onTranscript),startRef=useRef(onStart);transcriptRef.current=onTranscript;startRef.current=onStart;
  const cleanup=useCallback(()=>{
    if(timer.current)clearInterval(timer.current);if(limit.current)clearTimeout(limit.current);
    timer.current=null;limit.current=null;node.current?.disconnect();source.current?.disconnect();gain.current?.disconnect();
    node.current=null;source.current=null;gain.current=null;
    stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;
    void context.current?.close().catch(()=>{});context.current=null;isRecording.current=false;setRecording(false);
  },[]);
  const cancel=useCallback(()=>{version.current++;request.current?.abort();cleanup();samples.current=[];setStarting(false);setTranscribing(false);setSeconds(0);},[cleanup]);
  const stop=useCallback(async()=>{
    if(!isRecording.current)return;
    cleanup();const chunks=samples.current;samples.current=[];
    if(!chunks.length){setError('没有录到声音，请重试。');return;}
    const v=version.current;setTranscribing(true);setError('');const controller=new AbortController();request.current=controller;
    try {const form=new FormData();form.append('file',wavBlob(chunks,rate.current),'speech.wav');const res=await fetch('/api/stt',{method:'POST',body:form,signal:controller.signal});const data=await res.json();if(!res.ok)throw new Error(data.error||'语音识别暂不可用');if(v===version.current){if(data.text?.trim())transcriptRef.current(data.text.trim());else setError('没有识别出文字，可以再次录音或直接输入。');}}
    catch(e){if(!controller.signal.aborted&&v===version.current)setError(e instanceof Error?e.message:'语音识别失败');}
    finally{if(v===version.current)setTranscribing(false);}
  },[cleanup]);
  const start=useCallback(async()=>{
    cancel();setStarting(true);setError('');startRef.current();const v=version.current;
    try {
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('当前浏览器无法录音，请使用本机 Chrome，或直接输入发言。');
      const media=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});
      if(v!==version.current){media.getTracks().forEach(t=>t.stop());return;}
      stream.current=media;const audioContext=new AudioContext({sampleRate:16000});context.current=audioContext;rate.current=audioContext.sampleRate;
      await audioContext.audioWorklet.addModule('/wav-recorder.worklet.js');
      if(v!==version.current){cleanup();return;}
      const capture=new AudioWorkletNode(audioContext,'pcm-capture');node.current=capture;
      capture.port.onmessage=e=>{if(isRecording.current)samples.current.push(new Float32Array(e.data));};
      source.current=audioContext.createMediaStreamSource(media);gain.current=audioContext.createGain();gain.current.gain.value=0;
      source.current.connect(capture);capture.connect(gain.current);gain.current.connect(audioContext.destination);await audioContext.resume();
      if(v!==version.current)return;
      samples.current=[];isRecording.current=true;setRecording(true);setSeconds(0);timer.current=setInterval(()=>setSeconds(s=>s+1),1000);limit.current=setTimeout(()=>void stop(),29500);
    } catch(e) {if(v===version.current){cleanup();setError(e instanceof DOMException&&e.name==='NotAllowedError'?'麦克风权限未开启，你仍可直接输入发言。':e instanceof Error?e.message:'无法打开麦克风，请检查设备。');}}
    finally {if(v===version.current)setStarting(false);}
  },[cancel,cleanup,stop]);
  useEffect(()=>()=>cancel(),[cancel]);
  return {recording,starting,transcribing,seconds,error,start,stop,cancel,clearError:()=>setError('')};
}
