import { memo, useMemo } from 'react';
import { useWorkflowUiStore } from '@/store/workflowUiStore';
import { useThemeStore } from '@/store/themeStore';
import { getHeatMapColor } from '@/components/workflow/edge-colors';

const GRADIENT_STOPS = 10;

/**
 * Small legend overlay showing the heat-map color ramp from Low → High.
 * Renders in the bottom-left of the canvas, positioned above the React Flow
 * controls, and auto-hides when the heat map is toggled off.
 */
export const HeatMapLegend = memo(function HeatMapLegend() {
  const showHeatMap = useWorkflowUiStore((s) => s.showHeatMap);
  const mode = useWorkflowUiStore((s) => s.mode);
  const isDark = useThemeStore((s) => s.theme === 'dark');

  const gradientStops = useMemo(() => {
    const stops: string[] = [];
    for (let i = 0; i <= GRADIENT_STOPS; i++) {
      const t = i / GRADIENT_STOPS;
      stops.push(`${getHeatMapColor(t, isDark)} ${(t * 100).toFixed(0)}%`);
    }
    return stops.join(', ');
  }, [isDark]);

  if (!showHeatMap || mode !== 'execution') return null;

  return (
    <div className="absolute bottom-28 left-2.5 z-10 flex flex-col items-start gap-1 pointer-events-none max-md:bottom-36">
      <span className="text-[10px] font-medium text-muted-foreground select-none">Throughput</span>
      <div
        className="w-28 h-2.5 rounded-sm border border-border"
        style={{ background: `linear-gradient(to right, ${gradientStops})` }}
      />
      <div className="flex w-28 justify-between">
        <span className="text-[9px] text-muted-foreground select-none">Low</span>
        <span className="text-[9px] text-muted-foreground select-none">High</span>
      </div>
    </div>
  );
});
