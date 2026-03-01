import { Badge } from '@/components/ui/badge';

interface IntegrationStatusBadgeProps {
  status: string;
}

export function IntegrationStatusBadge({ status }: IntegrationStatusBadgeProps) {
  return (
    <Badge
      variant={status === 'active' ? 'secondary' : 'destructive'}
      className="uppercase tracking-wide"
    >
      {status}
    </Badge>
  );
}
