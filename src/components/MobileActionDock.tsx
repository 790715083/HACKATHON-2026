import { useEffect, useState, type RefObject } from 'react';
import { ArrowDown, Check, History, LoaderCircle, Play } from 'lucide-react';

export function MobileActionDock({ anchor, title, detail, label, tone, canSubmit, busy, paused, onSubmit, onResume, onHistory }: {
  anchor: RefObject<HTMLDivElement | null>; title: string; detail: string; label: string;
  tone?: string; canSubmit: boolean; busy: boolean; paused: boolean;
  onSubmit: () => void; onResume: () => void; onHistory: () => void;
}) {
  const [controlsVisible, setControlsVisible] = useState(false);
  useEffect(() => {
    const element = anchor.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setControlsVisible(entry.isIntersecting));
    observer.observe(element);
    return () => observer.disconnect();
  }, [anchor]);
  if (controlsVisible) return null;
  const moveToAction = () => document.getElementById('your-action')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return <div className="mobile-action-dock" aria-label="当前行动快捷栏">
    <div><span>{title}</span><b>{detail}</b></div>
    <button className={`primary-button small decision-${tone ?? 'neutral'}`} disabled={busy} onClick={paused ? onResume : canSubmit ? onSubmit : label ? moveToAction : onHistory}>
      {busy ? <LoaderCircle size={17} className="spin"/> : paused ? <Play size={17}/> : canSubmit ? <Check size={17}/> : label ? <ArrowDown size={17}/> : <History size={17}/>}
      {busy ? '正在提交' : paused ? '继续对局' : canSubmit ? label : label || '对局手记'}
    </button>
  </div>;
}
