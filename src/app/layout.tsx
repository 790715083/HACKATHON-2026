import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: '月下疑局 · Moonlit Verdict', description: '月光之下，真相从不只有一面。与八位 AI 玩家展开一场声音与谎言的狼人杀。', icons: { icon: '/favicon.svg' } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="zh-CN"><body>{children}</body></html>; }
