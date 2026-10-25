import { useId } from 'react';

const palettes = [
  ['#28383d','#b78e73','#20272a','#374d52','#d2aa71'], ['#3e3832','#d0a386','#40342e','#605246','#b6a080'],
  ['#273a36','#bc9579','#222d2b','#526653','#bba27b'], ['#383345','#d5b09b','#332e38','#656071','#bba0a7'],
  ['#394148','#b9846c','#192b34','#445b68','#d5b47e'], ['#3e3130','#d4a48b','#633e35','#714d42','#d6aa7c'],
  ['#303c42','#bda48b','#bbb4a0','#4b6269','#ad9c7c'], ['#373d31','#bc8c72','#393b2c','#6c7257','#d1bc83'],
  ['#333744','#d7b2a0','#30252b','#5d4a5d','#c3a6b2'],
];

export function Portrait({ avatar = 0, className = '' }: { avatar?: number; className?: string }) {
  const i = Math.abs(avatar) % palettes.length;
  const [bg, skin, hair, coat, accent] = palettes[i];
  const uid = useId().replace(/:/g,'');
  return <svg viewBox="0 0 160 176" className={`portrait ${className}`} aria-hidden="true">
    <defs>
      <linearGradient id={`p${uid}`} x1="0" y1="0" x2="0.8" y2="1"><stop stopColor={bg}/><stop offset="1" stopColor="#141e23"/></linearGradient>
      <radialGradient id={`s${uid}`}><stop stopColor={skin}/><stop offset="1" stopColor={skin} stopOpacity=".8"/></radialGradient>
    </defs>
    <path fill={`url(#p${uid})`} d="M0 0h160v176H0z"/>
    <circle cx="81" cy="75" r="57" fill={accent} opacity=".055"/>
    <path d="M0 146 20 119 32 143 47 109 61 146 82 120 101 144 120 112 143 145 160 120v56H0Z" fill="#0d1920" opacity=".5"/>
    <path d="M24 176q0-38 38-45h36q39 8 39 45" fill={coat}/>
    <path d="m63 131 17 16 18-16 4 45H58Z" fill="#c3b4a0" opacity=".8"/>
    <path d="m60 131 18 17-15 11-12-24m49-4-18 17 15 11 12-24" fill={coat} stroke="#152127" strokeOpacity=".35"/>
    <path d="M69 112v22q11 11 23 0v-22" fill={skin}/>
    <path d="M69 116q10 9 23 0v8q-12 9-23-1" fill="#3b201c" opacity=".19"/>
    {(i===3||i===5||i===8) && <path d="M44 62q-6 41 0 72l21-7h33l22 9q4-43-2-76Q112 24 80 25 45 27 44 62" fill={hair}/>}
    <ellipse cx="51" cy="86" rx="6" ry="11" fill={skin}/><ellipse cx="109" cy="86" rx="6" ry="11" fill={skin}/>
    <path d="M51 65q0-30 29-30t29 30v31q-4 30-29 31-24-2-29-31Z" fill={`url(#s${uid})`}/>
    <path d="M54 75q12-7 20-1M87 74q10-5 19 1" fill="none" stroke={hair} strokeWidth="3.3" strokeLinecap="round"/>
    <path d="M58 84q6-4 12 0M91 84q6-4 12 0" fill="none" stroke="#342c2a" strokeWidth="2.2" strokeLinecap="round"/>
    <circle cx="65" cy="85" r="2" fill="#172427"/><circle cx="97" cy="85" r="2" fill="#172427"/>
    <path d="m81 83-3 17 6 1" fill="none" stroke="#805a49" strokeWidth="1.7" strokeLinecap="round"/>
    <path d={i===1||i===7?'M70 111q10 2 20-2':'M71 110q9 5 18 0'} fill="none" stroke="#764c45" strokeWidth="2" strokeLinecap="round"/>
    {(i===0||i===4) && <><path d="M44 72q-9-45 30-48 38-7 41 29l-4 22-10-24q-24 15-44 8L52 76Z" fill={hair}/><path d="m51 47 38-18-10 23 23-13" fill="none" stroke={accent} opacity=".15" strokeWidth="4"/></>}
    {i===1 && <><path d="M45 74 48 42q10-19 33-18 29 0 32 28l-4 21-10-22q-22 6-40-2l-6 25" fill={hair}/><path d="M50 111q31 35 59-2-6 28-29 27-22-2-30-25" fill={hair} opacity=".85"/></>}
    {i===2 && <><path d="M46 64q-7-35 27-43 32-4 39 18l5 30-14-12-5-14-18 10-20-3-7 25Z" fill={hair}/><path d="m57 34 11 11 11-15 5 13 11-11" stroke={accent} strokeWidth="2" fill="none" opacity=".3"/></>}
    {i===3 && <path d="M47 72q-9-42 28-46 37-3 40 42-18-1-36-29-3 21-27 30" fill={hair}/>}
    {i===5 && <><path d="M43 78q-4-43 30-50 31-6 43 26l1 27q-20-8-22-36-16 20-44 19l-3 16" fill={hair}/><path d="M110 82q15-15 10-30" fill="none" stroke={accent} opacity=".2" strokeWidth="2"/></>}
    {i===6 && <><path d="M44 77q-9-48 30-50 35-8 41 27l-5 26-7-29-18 8-23-7-10 28Z" fill={hair}/><path d="M63 37q15 14 34-1" fill="none" stroke="#f0dfbf" opacity=".4" strokeWidth="3"/></>}
    {i===7 && <><path d="M43 62q-2-31 36-33 34-1 37 33l-12 6-5-21-22 10-20-4-6 16" fill={hair}/><path d="m47 45 8-27 25 8 24-7 9 27" fill={coat}/><path d="M43 45h77v10H43z" fill={hair}/></>}
    {i===8 && <><path d="M46 71q-5-45 29-45 37-7 41 43l-9 8-6-25q-25 6-39-8-2 18-14 29" fill={hair}/><circle cx="114" cy="39" r="12" fill={hair}/><path d="m108 34 10 10m-12-4 12-5" stroke={accent} opacity=".7"/></>}
    {(i===0||i===6) && <><g fill="none" stroke={i===6?'#92836b':'#c6ae84'} strokeWidth="2"><rect x="53" y="77" width="23" height="17" rx="6"/><rect x="86" y="77" width="23" height="17" rx="6"/><path d="M76 82h10M48 80h5m56 0h5"/></g><path d="m58 79 10 11m22-11 10 11" stroke="#eee" opacity=".1"/></>}
    <path d="M53 97q6 7 12 4m31 0q6 2 11-4" stroke="#d8957b" strokeWidth="5" strokeLinecap="round" opacity=".2"/>
    <path d="M40 176q-1-23 7-30m75 30q1-23-7-30" fill="none" stroke="#111b21" opacity=".3"/>
    <circle cx="104" cy="153" r="4" fill={accent}/><circle cx="104" cy="153" r="1.5" fill="#252e30"/>
    <path d="M0 0h160v176H0z" fill="none" stroke="#e7d9b5" strokeOpacity=".04"/>
  </svg>;
}
