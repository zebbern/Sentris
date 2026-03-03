import { useMemo } from 'react';
import type { Edge } from '@xyflow/react';
import type { DataPacket } from '@/store/executionTimelineStore';

export interface EdgeHeatMetrics {
  /** Raw count of packets traversing this edge. */
  packetCount: number;
  /** Sum of packet `size` (bytes) across this edge. */
  totalBytes: number;
  /** Packet count normalised to 0–1 relative to the busiest edge. */
  normalizedCount: number;
  /** Byte volume normalised to 0–1 relative to the busiest edge. */
  normalizedVolume: number;
}

/**
 * Build a lookup of edgeId → EdgeHeatMetrics from the current data flows.
 *
 * Normalisation uses the *maximum* metric across all edges so the busiest
 * edge is always 1.0.  Edges with no matching packets still appear in the
 * map with intensity 0.
 */
export function computeEdgeHeatMap(
  edges: Edge[],
  dataFlows: DataPacket[],
): Map<string, EdgeHeatMetrics> {
  // Accumulate raw counts per edge
  const rawMap = new Map<string, { packetCount: number; totalBytes: number }>();

  // Initialise every edge so that even zero-traffic edges get an entry
  for (const edge of edges) {
    rawMap.set(edge.id, { packetCount: 0, totalBytes: 0 });
  }

  // Build a fast lookup from (source,target) → edgeId(s)
  const pairToEdgeIds = new Map<string, string[]>();
  for (const edge of edges) {
    const key = `${edge.source}::${edge.target}`;
    const list = pairToEdgeIds.get(key);
    if (list) {
      list.push(edge.id);
    } else {
      pairToEdgeIds.set(key, [edge.id]);
    }
  }

  for (const packet of dataFlows) {
    const key = `${packet.sourceNode}::${packet.targetNode}`;
    const edgeIds = pairToEdgeIds.get(key);
    if (!edgeIds) continue;
    for (const edgeId of edgeIds) {
      const entry = rawMap.get(edgeId);
      if (entry) {
        entry.packetCount += 1;
        entry.totalBytes += packet.size;
      }
    }
  }

  // Find max values for normalisation
  let maxCount = 0;
  let maxBytes = 0;
  for (const { packetCount, totalBytes } of rawMap.values()) {
    if (packetCount > maxCount) maxCount = packetCount;
    if (totalBytes > maxBytes) maxBytes = totalBytes;
  }

  // Build normalised result
  const result = new Map<string, EdgeHeatMetrics>();
  for (const [edgeId, { packetCount, totalBytes }] of rawMap) {
    result.set(edgeId, {
      packetCount,
      totalBytes,
      normalizedCount: maxCount > 0 ? packetCount / maxCount : 0,
      normalizedVolume: maxBytes > 0 ? totalBytes / maxBytes : 0,
    });
  }

  return result;
}

/**
 * React hook — memoised heat-map computation for the current edges + data flows.
 *
 * Returns a stable `Map<edgeId, EdgeHeatMetrics>` that only recomputes when
 * the data-flow set or edge list changes.
 */
export function useEdgeHeatMap(
  edges: Edge[],
  dataFlows: DataPacket[],
): Map<string, EdgeHeatMetrics> {
  return useMemo(
    () => computeEdgeHeatMap(edges, dataFlows),
    // Re-derive when the reference or length changes.
    [edges.length, dataFlows.length, dataFlows],
  );
}
