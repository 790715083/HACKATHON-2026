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

type RecordingTarget = { gameId: string; turnId: string };
type RecordedClip = { audio: Blob; target: RecordingTarget | null };

export function useRecorder(onTranscript: (text: string) => void, onStart: () => void, target: RecordingTarget | null) {
  const [recording, setRecording] = useState(false), [starting, setStarting] = useState(false);
  const [transcribing, setTranscribing] = useState(false), [canRetry, setCanRetry] = useState(false);
  const [seconds, setSeconds] = useState(0), [error, setError] = useState('');
  const stream = useRef<MediaStream | null>(null), context = useRef<AudioContext | null>(null);
  const node = useRef<AudioWorkletNode | null>(null), source = useRef<MediaStreamAudioSourceNode | null>(null), gain = useRef<GainNode | null>(null);
  const samples = useRef<Float32Array[]>([]), timer = useRef<ReturnType<typeof setInterval> | null>(null), limit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef<AbortController | null>(null), pendingClip = useRef<RecordedClip | null>(null);
  const version = useRef(0), rate = useRef(16000), isRecording = useRef(false);
  const transcriptRef = useRef(onTranscript), startRef = useRef(onStart), targetRef = useRef(target), captureTarget = useRef<RecordingTarget | null>(null);
  transcriptRef.current = onTranscript; startRef.current = onStart; targetRef.current = target;

  const cleanup = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    if (limit.current) clearTimeout(limit.current);
    timer.current = null; limit.current = null;
    node.current?.disconnect(); source.current?.disconnect(); gain.current?.disconnect();
    node.current = null; source.current = null; gain.current = null;
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    void context.current?.close().catch(() => {}); context.current = null;
    isRecording.current = false; setRecording(false);
  }, []);

  const cancel = useCallback(() => {
    version.current++; request.current?.abort(); request.current = null;
    cleanup(); samples.current = []; pendingClip.current = null; captureTarget.current = null;
    setStarting(false); setTranscribing(false); setCanRetry(false); setSeconds(0); setError('');
  }, [cleanup]);

  const transcribe = useCallback(async (clip: RecordedClip) => {
    if (request.current) return;
    const v = version.current, controller = new AbortController();
    request.current = controller; setTranscribing(true); setCanRetry(false); setError('');
    let retryable = true;
    try {
      const form = new FormData(); form.append('file', clip.audio, 'speech.wav');
      if (clip.target) { form.append('gameId', clip.target.gameId); form.append('turnId', clip.target.turnId); }
      const res = await fetch('/api/stt', { method: 'POST', body: form, signal: controller.signal });
      retryable = res.status >= 500 || res.status === 429;
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || '语音识别暂不可用。');
      if (v !== version.current) return;
      if (typeof data?.text !== 'string' || !data.text.trim()) throw new Error('没有识别出文字，可以再次录音或直接输入。');
      transcriptRef.current(data.text.trim()); pendingClip.current = null;
    } catch (e) {
      if (!controller.signal.aborted && v === version.current) {
        setError(e instanceof Error ? e.message : '语音识别失败。');
        if (retryable) setCanRetry(true); else pendingClip.current = null;
      }
    } finally {
      if (request.current === controller) request.current = null;
      if (v === version.current) setTranscribing(false);
    }
  }, []);

  const stop = useCallback(async () => {
    if (!isRecording.current) return;
    cleanup(); const chunks = samples.current; samples.current = [];
    const frames = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    if (frames < rate.current * 0.2) { setError('录音太短，请说完一句话后再结束录音。'); return; }
    const clip = { audio: wavBlob(chunks, rate.current), target: captureTarget.current };
    pendingClip.current = clip;
    await transcribe(clip);
  }, [cleanup, transcribe]);

  const retry = useCallback(async () => {
    if (pendingClip.current) await transcribe(pendingClip.current);
  }, [transcribe]);

  const start = useCallback(async () => {
    cancel(); captureTarget.current = targetRef.current; setStarting(true); startRef.current();
    const v = version.current;
    let ownMedia: MediaStream | null = null, ownContext: AudioContext | null = null;
    const disposeOwn = () => {
      ownMedia?.getTracks().forEach(track => track.stop());
      if (ownContext?.state !== 'closed') void ownContext?.close().catch(() => {});
    };
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器无法录音，请使用本机 Chrome，或直接输入发言。');
      const media = ownMedia = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      if (v !== version.current) { disposeOwn(); return; }
      stream.current = media;
      const audioContext = ownContext = new AudioContext({ sampleRate: 16000 });
      context.current = audioContext; rate.current = audioContext.sampleRate;
      await audioContext.audioWorklet.addModule('/wav-recorder.worklet.js');
      if (v !== version.current) { disposeOwn(); return; }
      const capture = new AudioWorkletNode(audioContext, 'pcm-capture'); node.current = capture;
      let captured = 0; const maxFrames = Math.floor(audioContext.sampleRate * 30);
      capture.port.onmessage = e => {
        if (v !== version.current || !isRecording.current) return;
        const chunk = new Float32Array(e.data).subarray(0, maxFrames - captured);
        samples.current.push(chunk); captured += chunk.length;
        if (captured >= maxFrames) void stop();
      };
      source.current = audioContext.createMediaStreamSource(media); gain.current = audioContext.createGain(); gain.current.gain.value = 0;
      source.current.connect(capture); capture.connect(gain.current); gain.current.connect(audioContext.destination);
      await audioContext.resume();
      if (v !== version.current) { disposeOwn(); return; }
      samples.current = []; isRecording.current = true; setRecording(true); setSeconds(0);
      timer.current = setInterval(() => setSeconds(s => s + 1), 1000); limit.current = setTimeout(() => void stop(), 29500);
    } catch (e) {
      disposeOwn();
      if (v === version.current) {
        cleanup();
        setError(e instanceof DOMException && e.name === 'NotAllowedError' ? '麦克风权限未开启，你仍可直接输入发言。'
          : e instanceof DOMException && e.name === 'NotFoundError' ? '没有找到麦克风，请连接设备或直接输入发言。'
          : e instanceof Error ? e.message : '无法打开麦克风，请检查设备。');
      }
    } finally { if (v === version.current) setStarting(false); }
  }, [cancel, cleanup, stop]);

  useEffect(() => () => cancel(), [cancel]);
  return { recording, starting, transcribing, canRetry, seconds, error, start, stop, retry, cancel, clearError: () => setError('') };
}
