import { Crosshair, Eye, FlaskConical, Moon, Shield, UserRound, type LucideProps } from 'lucide-react';
import type { Role } from '@/lib/game/types';
export function Emblem({ role, ...props }: LucideProps & { role?: Role }) {
  const Icon = role === 'werewolf' ? Moon : role === 'seer' ? Eye : role === 'witch' ? FlaskConical : role === 'hunter' ? Crosshair : role === 'villager' ? UserRound : Shield;
  return <Icon {...props}/>;
}
