import { getBezierPath, type ConnectionLineComponentProps, Position } from '@xyflow/react';
import { useConnectionPreview } from './connection-preview-context';
import { getEdgeColor } from './edge-colors';
import { useThemeStore } from '@/store/themeStore';

/**
 * Custom connection line rendered while dragging from a handle.
 * Shows a color-matched dashed bezier that follows the cursor.
 */
export function ConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
  fromPosition,
  toPosition,
}: ConnectionLineComponentProps) {
  const connectingFrom = useConnectionPreview();
  const isDark = useThemeStore((s) => s.theme === 'dark');

  const strokeColor = connectingFrom
    ? getEdgeColor(connectingFrom.portColor, isDark)
    : getEdgeColor(undefined, isDark);

  const [path] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition ?? Position.Right,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition ?? Position.Left,
  });

  return (
    <g>
      {/* Glow layer for visibility */}
      <path
        d={path}
        fill="none"
        stroke={strokeColor}
        strokeWidth={6}
        strokeOpacity={0.15}
        strokeLinecap="round"
      />
      {/* Main dashed line */}
      <path
        d={path}
        fill="none"
        stroke={strokeColor}
        strokeWidth={2}
        strokeDasharray="8 4"
        strokeOpacity={0.7}
        strokeLinecap="round"
        className="connection-line-preview"
      />
    </g>
  );
}
