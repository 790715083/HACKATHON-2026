export function Forest({ compact = false }: { compact?: boolean }) {
  return <div className={`forest-scene ${compact ? 'forest-compact' : ''}`} aria-hidden="true">
    <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="sky" x2="0" y2="1"><stop stopColor="#0c1924"/><stop offset=".52" stopColor="#182b32"/><stop offset="1" stopColor="#101b1f"/></linearGradient>
        <radialGradient id="moonglow"><stop stopColor="#c9d5c6" stopOpacity=".14"/><stop offset=".5" stopColor="#b6c9c4" stopOpacity=".04"/><stop offset="1" stopColor="#adc9cf" stopOpacity="0"/></radialGradient>
        <linearGradient id="fog"><stop stopColor="#d2d6b4" stopOpacity="0"/><stop offset=".5" stopColor="#b8c4b7" stopOpacity=".09"/><stop offset="1" stopColor="#cdd3bd" stopOpacity="0"/></linearGradient>
        <filter id="moontexture"><feTurbulence type="fractalNoise" baseFrequency=".025" numOctaves="4" seed="6"/><feColorMatrix type="saturate" values="0"/><feComposite in2="SourceGraphic" operator="in"/><feBlend in="SourceGraphic" mode="multiply"/></filter>
      </defs>
      <path fill="url(#sky)" d="M0 0h1600v1000H0z"/>
      <circle cx="1120" cy="260" r="410" fill="url(#moonglow)"/>
      <circle cx="1120" cy="260" r="114" fill="#d7d4b7" opacity=".86"/>
      <circle cx="1120" cy="260" r="114" fill="#b2b8a4" opacity=".27" filter="url(#moontexture)"/>
      <g fill="#d9d7bc" opacity=".4">{Array.from({length:55},(_,i)=><circle key={i} cx={(i*337+79)%1600} cy={(i*97+20)%580} r={i%4===0?1.6:.8}/>)}</g>
      <path d="M0 583 140 435 297 546 469 394 650 519 810 411 977 504 1146 422 1352 525 1502 423 1600 488v512H0Z" fill="#172a30"/>
      <path d="M0 669 170 573 314 649 471 547 678 690 904 538 1129 639 1310 534 1487 620 1600 558v442H0Z" fill="#11252b"/>
      <g fill="#0c1b22">{Array.from({length:34},(_,i)=>{const x=(i*111+29)%1640-20;const y=660+(i%5)*34;const h=170+(i%4)*47;return <g key={i}><path d={`M${x} ${y-h} ${x-38} ${y-h+100}h20l-42 70h31l-42 74h136l-42-74h31l-42-70h20Z`}/><path d={`M${x-4} ${y-10}h8v90h-8Z`}/></g>;})}</g>
      <path d="M0 766q330-80 690-10t910-30v274H0Z" fill="#09171d"/>
      <g fill="#07141a">{[[-20,210],[90,310],[1460,280],[1580,200]].map(([x,h],i)=><g key={i}><path d={`M${x} ${820-h*2} ${x-95} ${820-h*1.1}h40l-88 ${h*.65}h50l-92 ${h*.7}h370l-92-${h*.7}h50l-88-${h*.65}h40Z`}/><path d={`M${x-8} 630h16v370h-16Z`}/></g>)}</g>
      <ellipse cx="1000" cy="670" rx="820" ry="65" fill="url(#fog)"/>
      <ellipse cx="480" cy="810" rx="700" ry="55" fill="url(#fog)"/>
    </svg>
    <div className="scene-vignette"/><div className="mist mist-one"/><div className="mist mist-two"/>
  </div>;
}
