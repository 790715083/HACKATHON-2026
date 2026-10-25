'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
export function Modal({ title, onClose, children, className = '' }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(()=> { const dialog=ref.current; dialog?.showModal(); return ()=>dialog?.close(); },[]);
  return <dialog ref={ref} className={`modal ${className}`} onCancel={onClose} onClick={e=>{if(e.target===ref.current)onClose();}}><div className="modal-head"><div><span className="eyebrow">MOONLIT VERDICT</span><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={20}/></button></div>{children}</dialog>;
}
