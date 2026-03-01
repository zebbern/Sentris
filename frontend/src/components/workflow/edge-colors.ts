/**
 * Edge color constants and helpers for port-color-matched edge strokes.
 *
 * Hex values correspond to Tailwind 500 (light) / 400 (dark) shades,
 * matching the HANDLE_DESIGN_COLORS used in NodeOutputPorts.tsx.
 */

export interface EdgeColorPair {
  light: string;
  dark: string;
}

/** Color map keyed by the same color names used in OutputPort.branchColor and HANDLE_DESIGN_COLORS. */
export const EDGE_PORT_COLORS: Record<string, EdgeColorPair> = {
  green: { light: '#22c55e', dark: '#4ade80' },
  red: { light: '#ef4444', dark: '#f87171' },
  amber: { light: '#f59e0b', dark: '#fbbf24' },
  blue: { light: '#3b82f6', dark: '#60a5fa' },
  purple: { light: '#a855f7', dark: '#c084fc' },
  slate: { light: '#64748b', dark: '#94a3b8' },
};

/** Fallback color for edges without a resolved source port color. */
export const DEFAULT_EDGE_COLOR: EdgeColorPair = EDGE_PORT_COLORS.slate;

/** Edge glow colors keyed by execution status. `null` means no glow. */
export const EDGE_STATUS_COLORS: Record<string, EdgeColorPair | null> = {
  running: { light: '#3b82f6', dark: '#60a5fa' },
  success: { light: '#22c55e', dark: '#4ade80' },
  error: { light: '#ef4444', dark: '#f87171' },
  idle: null,
  pending: null,
  skipped: null,
};

/**
 * Resolve an edge glow color from a node execution status.
 * Returns the appropriate hex value for the current theme, or `null` for no glow.
 */
export function getEdgeStatusGlowColor(status: string | undefined, isDark: boolean): string | null {
  if (!status) return null;
  const pair = EDGE_STATUS_COLORS[status];
  if (!pair) return null;
  return isDark ? pair.dark : pair.light;
}

/**
 * Resolve an edge stroke color from a port color name.
 * Returns the appropriate hex value for the current theme.
 * Falls back to slate when the color name is unknown or undefined.
 */
export function getEdgeColor(colorName: string | undefined, isDark: boolean): string {
  const pair = (colorName && EDGE_PORT_COLORS[colorName]) || DEFAULT_EDGE_COLOR;
  return isDark ? pair.dark : pair.light;
}

/** Dasharray patterns keyed by edge port type. */
const PORT_TYPE_DASHARRAYS: Record<string, string | undefined> = {
  regular: undefined,
  branching: '12 4',
  tool: '2 4',
};

/**
 * Resolve a strokeDasharray value from an edge's portType.
 *
 * - `'regular'`   → `undefined` (solid line)
 * - `'branching'`  → `'12 4'` (long dashes)
 * - `'tool'`       → `'2 4'` (dotted)
 * - unknown        → `undefined` (solid)
 */
export function getEdgeStrokeDasharray(portType: string | undefined): string | undefined {
  if (!portType) return undefined;
  return PORT_TYPE_DASHARRAYS[portType];
}

/**
 * Sum of dasharray segment values — used for smooth stroke-dashoffset animation.
 * Returns the sum so the animation cycles one full pattern repeat.
 */
export function getEdgeDasharraySum(portType: string | undefined): number {
  const dasharray = getEdgeStrokeDasharray(portType);
  if (!dasharray) return 24; // default sum for the base pulse (8 + 16)
  return dasharray.split(' ').reduce((sum, v) => sum + Number(v), 0);
}
