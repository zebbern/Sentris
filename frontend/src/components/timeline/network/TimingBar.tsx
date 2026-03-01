import { cn } from '@/lib/utils';
import type { HarTimings } from './types';
import { formatDuration } from './utils';

interface TimingBarProps {
  timings: HarTimings;
  totalTime: number;
}

export function TimingBar({ timings, totalTime }: TimingBarProps) {
  const segments = [
    { name: 'Blocked', value: timings.blocked, color: 'bg-slate-400' },
    { name: 'DNS', value: timings.dns, color: 'bg-cyan-500' },
    { name: 'Connect', value: timings.connect, color: 'bg-orange-500' },
    { name: 'SSL', value: timings.ssl, color: 'bg-purple-500' },
    { name: 'Send', value: timings.send, color: 'bg-blue-500' },
    { name: 'Wait', value: timings.wait, color: 'bg-emerald-500' },
    { name: 'Receive', value: timings.receive, color: 'bg-sky-500' },
  ].filter((s) => s.value > 0);

  if (segments.length === 0 || totalTime <= 0) {
    return <div className="text-xs text-muted-foreground">No timing data available</div>;
  }

  return (
    <div className="space-y-3">
      <div className="h-6 rounded-md overflow-hidden flex bg-muted">
        {segments.map((segment) => (
          <div
            key={segment.name}
            className={cn(segment.color, 'h-full relative group')}
            style={{
              width: `${(segment.value / totalTime) * 100}%`,
              minWidth: segment.value > 0 ? '2px' : 0,
            }}
            title={`${segment.name}: ${formatDuration(segment.value)}`}
          >
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/20 text-white text-[10px] font-medium transition-opacity">
              {segment.name}
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        {segments.map((segment) => (
          <div key={segment.name} className="flex items-center gap-1.5">
            <div className={cn('w-2.5 h-2.5 rounded-sm', segment.color)} />
            <span className="text-muted-foreground">{segment.name}:</span>
            <span className="font-mono">{formatDuration(segment.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
