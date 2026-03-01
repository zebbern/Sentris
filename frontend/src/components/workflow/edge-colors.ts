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

// ---------------------------------------------------------------------------
// Heat map color ramp — blue (low) → yellow (mid) → red (high)
// ---------------------------------------------------------------------------

/** Color stops for the heat-map ramp (light / dark theme variants). */
const HEAT_MAP_STOPS = {
  light: [
    { at: 0, r: 59, g: 130, b: 246 }, // #3b82f6 — blue-500
    { at: 0.5, r: 234, g: 179, b: 8 }, // #eab308 — yellow-500
    { at: 1, r: 239, g: 68, b: 68 }, // #ef4444 — red-500
  ],
  dark: [
    { at: 0, r: 96, g: 165, b: 250 }, // #60a5fa — blue-400
    { at: 0.5, r: 250, g: 204, b: 21 }, // #facc15 — yellow-400
    { at: 1, r: 248, g: 113, b: 113 }, // #f87171 — red-400
  ],
} as const;

function lerpStops(
  t: number,
  stops: readonly { at: number; r: number; g: number; b: number }[],
): string {
  const clamped = Math.max(0, Math.min(1, t));

  // Find the two surrounding stops
  let lower = stops[0];
  let upper = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (clamped >= stops[i].at && clamped <= stops[i + 1].at) {
      lower = stops[i];
      upper = stops[i + 1];
      break;
    }
  }

  const range = upper.at - lower.at;
  const ratio = range === 0 ? 0 : (clamped - lower.at) / range;

  const r = Math.round(lower.r + (upper.r - lower.r) * ratio);
  const g = Math.round(lower.g + (upper.g - lower.g) * ratio);
  const b = Math.round(lower.b + (upper.b - lower.b) * ratio);

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Return a hex color on the blue→yellow→red ramp for a normalised intensity (0–1).
 * Picks the correct palette for the current theme.
 */
export function getHeatMapColor(normalizedValue: number, isDark: boolean): string {
  const stops = isDark ? HEAT_MAP_STOPS.dark : HEAT_MAP_STOPS.light;
  return lerpStops(normalizedValue, stops);
}

/** Min / max stroke widths for heat-map edges. */
const HEAT_STROKE_MIN = 2;
const HEAT_STROKE_MAX = 8;

/**
 * Return a stroke width (px) linearly interpolated between 2 and 8 for a
 * normalised intensity (0–1).
 */
export function getHeatMapStrokeWidth(normalizedValue: number): number {
  const clamped = Math.max(0, Math.min(1, normalizedValue));
  return HEAT_STROKE_MIN + (HEAT_STROKE_MAX - HEAT_STROKE_MIN) * clamped;
}
