import { Badge } from '@/components/ui/badge';
import type { TransportType } from './types';

interface TransportBadgeProps {
  type?: TransportType | null;
}

export function TransportBadge({ type }: TransportBadgeProps) {
  const variants: Record<TransportType, 'default' | 'secondary' | 'outline'> = {
    http: 'default',
    stdio: 'outline',
  };

  const safeType: TransportType = type ?? 'http';
  const label = type ? type.toUpperCase() : 'UNKNOWN';

  return (
    <Badge variant={variants[safeType]} className="text-xs">
      {label}
    </Badge>
  );
}
