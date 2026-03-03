/**
 * EdgeBundleLayer — SVG overlay that renders trunk + fan-out indicators
 * for edges sharing the same source node.
 *
 * Rendered inside React Flow's canvas via a `<Panel>` with a full-size
 * SVG that uses the viewport transform to stay aligned with nodes.
 *
 * Design mode only. Toggled via `edgeBundling` in workflowUiStore.
 */

import { memo, useMemo } from 'react';
import { useEdges, useNodes, useViewport } from '@xyflow/react';

import { useWorkflowUiStore } from '@/store/workflowUiStore';
import { useThemeStore } from '@/store/themeStore';
import { computeEdgeBundles, type EdgeBundle } from './edgeBundling';
import { getEdgeColor } from './edge-colors';

/** Trunk stroke width in px (screen space, not canvas-scaled). */
const TRUNK_STROKE_WIDTH = 6;
/** Fan-out indicator stroke width. */
const FANOUT_STROKE_WIDTH = 3;
/** Fan-out point circle radius. */
const FANOUT_CIRCLE_RADIUS = 4;
/** Trunk opacity. */
const TRUNK_OPACITY = 0.35;
/** Fan-out path opacity. */
const FANOUT_OPACITY = 0.25;

export const EdgeBundleLayer = memo(function EdgeBundleLayer() {
  const edgeBundling = useWorkflowUiStore((s) => s.edgeBundling);
  const mode = useWorkflowUiStore((s) => s.mode);
  const isDark = useThemeStore((s) => s.theme === 'dark');

  const nodes = useNodes();
  const edges = useEdges();
  const { x: vpX, y: vpY, zoom } = useViewport();

  // Only compute bundles when bundling is on and in design mode
  const bundles = useMemo<EdgeBundle[]>(() => {
    if (!edgeBundling || mode !== 'design') return [];
    return computeEdgeBundles(edges, nodes);
  }, [edgeBundling, mode, edges, nodes]);

  if (bundles.length === 0) return null;

  // Resolve colors once per render
  const resolvedBundles = bundles.map((bundle) => ({
    ...bundle,
    resolvedTrunkColor: getEdgeColor(bundle.trunkColor, isDark),
    resolvedFanOutColors: bundle.fanOutTargets.map((t) => getEdgeColor(t.color, isDark)),
  }));

  return (
    <svg
      className="pointer-events-none absolute inset-0 overflow-visible"
      style={{
        width: '100%',
        height: '100%',
        zIndex: 0,
      }}
    >
      <g transform={`translate(${vpX}, ${vpY}) scale(${zoom})`}>
        {resolvedBundles.map((bundle) => (
          <g key={bundle.sourceNodeId}>
            {/* Trunk line */}
            <path
              d={bundle.trunkPath}
              fill="none"
              stroke={bundle.resolvedTrunkColor}
              strokeWidth={TRUNK_STROKE_WIDTH / zoom}
              strokeLinecap="round"
              opacity={TRUNK_OPACITY}
            />

            {/* Fan-out indicator paths */}
            {bundle.fanOutTargets.map((target, i) => (
              <path
                key={target.edgeId}
                d={target.path}
                fill="none"
                stroke={bundle.resolvedFanOutColors[i]}
                strokeWidth={FANOUT_STROKE_WIDTH / zoom}
                strokeLinecap="round"
                opacity={FANOUT_OPACITY}
              />
            ))}

            {/* Fan-out point circle */}
            <circle
              cx={bundle.fanOutPoint.x}
              cy={bundle.fanOutPoint.y}
              r={FANOUT_CIRCLE_RADIUS / zoom}
              fill={bundle.resolvedTrunkColor}
              opacity={0.5}
            />

            {/* Edge count badge at fan-out point */}
            <text
              x={bundle.fanOutPoint.x}
              y={bundle.fanOutPoint.y - (FANOUT_CIRCLE_RADIUS + 6) / zoom}
              textAnchor="middle"
              fontSize={`${10 / zoom}px`}
              fontWeight="600"
              fill={bundle.resolvedTrunkColor}
              opacity={0.7}
            >
              {bundle.edgeCount}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
});
