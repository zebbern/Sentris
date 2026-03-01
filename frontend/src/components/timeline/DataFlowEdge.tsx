import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, EdgeProps, Position } from 'reactflow';
import { Package, FileText, Database, Code } from 'lucide-react';
import { useExecutionTimelineStore, type DataPacket } from '@/store/executionTimelineStore';
import { useWorkflowUiStore } from '@/store/workflowUiStore';
import { useThemeStore } from '@/store/themeStore';
import {
  getEdgeColor,
  getEdgeStrokeDasharray,
  getEdgeDasharraySum,
  getEdgeStatusGlowColor,
} from '@/components/workflow/edge-colors';
import { cn } from '@/lib/utils';

// Data packet icon mapping
const PACKET_ICONS = {
  file: FileText,
  json: Code,
  text: FileText,
  binary: Package,
  database: Database,
};

interface DataFlowEdgeProps extends EdgeProps {
  sourceHandle?: string | null;
  targetHandle?: string | null;
  data?: {
    packets?: DataPacket[];
    isHighlighted?: boolean;
    isPathHighlighted?: boolean;
    sourcePortColor?: string;
    isBranching?: boolean;
    portType?: string;
  };
}

interface AnimatedPacket {
  id: string;
  packet: DataPacket;
  position: number; // 0-1 along the path
  element: HTMLDivElement | null;
}

// Data packet visualization component
const DataPacketComponent = memo(
  ({ packet, onHover }: { packet: DataPacket; onHover: (packet: DataPacket | null) => void }) => {
    const IconComponent = PACKET_ICONS[packet.type] || Package;

    const formatPayload = (payload: unknown): string => {
      if (typeof payload === 'string') return payload;
      if (typeof payload === 'object' && payload !== null) {
        return (
          JSON.stringify(payload).slice(0, 50) + (JSON.stringify(payload).length > 50 ? '...' : '')
        );
      }
      return String(payload);
    };

    return (
      <div
        className={cn(
          'w-6 h-6 bg-background border-2 border-blue-500 rounded-full shadow-lg cursor-pointer transition-all duration-200 hover:scale-110 hover:shadow-xl z-10',
          'flex items-center justify-center',
        )}
        onMouseEnter={() => onHover(packet)}
        onMouseLeave={() => onHover(null)}
        title={`${packet.type} • ${formatPayload(packet.payload)} • ${(packet.size / 1024).toFixed(1)}KB`}
      >
        <IconComponent className="h-3 w-3 text-blue-500" />
      </div>
    );
  },
);

DataPacketComponent.displayName = 'DataPacketComponent';

// Enhanced edge with data flow visualization
export const DataFlowEdge = memo(
  ({
    id,
    source,
    target,
    sourceX,
    sourceY,
    targetX,
    targetY,
    data,
    markerEnd,
    sourceHandle,
    targetHandle,
  }: DataFlowEdgeProps) => {
    const [hoveredPacket, setHoveredPacket] = useState<DataPacket | null>(null);
    const [animatedPackets, setAnimatedPackets] = useState<AnimatedPacket[]>([]);
    const animationRef = useRef<number | null>(null);

    const currentTime = useExecutionTimelineStore((s) => s.currentTime);
    const isPlaying = useExecutionTimelineStore((s) => s.isPlaying);
    const playbackSpeed = useExecutionTimelineStore((s) => s.playbackSpeed);
    const playbackMode = useExecutionTimelineStore((s) => s.playbackMode);
    const dataFlows = useExecutionTimelineStore((s) => s.dataFlows);
    const selectedRunId = useExecutionTimelineStore((s) => s.selectedRunId);
    const mode = useWorkflowUiStore((s) => s.mode);
    const isDark = useThemeStore((s) => s.theme === 'dark');

    const edgeStrokeColor = useMemo(
      () => getEdgeColor(data?.sourcePortColor, isDark),
      [data?.sourcePortColor, isDark],
    );

    const edgeDasharray = useMemo(() => getEdgeStrokeDasharray(data?.portType), [data?.portType]);

    const edgeDasharraySum = useMemo(() => getEdgeDasharraySum(data?.portType), [data?.portType]);

    const nodeStates = useExecutionTimelineStore((state) => state.nodeStates);
    const sourceNodeState = nodeStates[source];

    const isDimmed = useMemo(() => {
      if (mode !== 'execution' || !selectedRunId || !sourceNodeState) return false;

      // If node is skipped, all its outgoing edges are dimmed
      if (sourceNodeState.status === 'skipped') return true;

      // Only dim after the node has finished or failed
      const isFinished = sourceNodeState.status === 'success' || sourceNodeState.status === 'error';
      if (!isFinished) return false;

      const data = sourceNodeState.lastEvent?.data;
      const activatedPorts = data?.activatedPorts;

      // If we have activatedPorts info (from backend NODE_COMPLETED trace)
      if (activatedPorts && sourceHandle) {
        return !activatedPorts.includes(sourceHandle);
      }

      // Legacy fallback for manual-approval (core.manual_action.approval)
      if (data && typeof data.approved === 'boolean') {
        const activeBranch = data.approved ? 'approved' : 'rejected';
        if (sourceHandle === 'approved' || sourceHandle === 'rejected') {
          return sourceHandle !== activeBranch;
        }
      }

      return false;
    }, [mode, selectedRunId, sourceNodeState, sourceHandle]);

    const packets = useMemo(() => {
      const packetsFromProps = data?.packets;
      const cutoff = currentTime;

      if (packetsFromProps) {
        return packetsFromProps.filter((packet) => new Date(packet.timestamp).getTime() <= cutoff);
      }

      return dataFlows.filter(
        (packet) =>
          packet.sourceNode === source &&
          packet.targetNode === target &&
          // If we have an input handle, ensure packet matches it
          (!packet.inputKey || (targetHandle && packet.inputKey === targetHandle)) &&
          new Date(packet.timestamp).getTime() <= cutoff,
      );
    }, [data?.packets, dataFlows, source, target, targetHandle, currentTime]);

    const edgePath = useMemo(() => {
      const [path] = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition: Position.Right,
        targetX,
        targetY,
        targetPosition: Position.Left,
      });
      return path;
    }, [sourceX, sourceY, targetX, targetY]);

    const labelPosition = useMemo(
      () => ({
        x: (sourceX + targetX) / 2,
        y: (sourceY + targetY) / 2,
      }),
      [sourceX, targetX, sourceY, targetY],
    );

    // Animate packets along the path
    useEffect(() => {
      if (
        !edgePath ||
        mode !== 'execution' ||
        !selectedRunId ||
        playbackMode === 'live' ||
        packets.length === 0 ||
        isDimmed
      ) {
        setAnimatedPackets([]);
        return;
      }

      // Clear existing animation
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }

      const animate = () => {
        const newAnimatedPackets = packets
          .map((packet, index) => {
            const packetStartTime = new Date(packet.timestamp).getTime();
            const animationDuration = 2000; // 2 seconds for packet to travel
            const adjustedDuration = animationDuration / playbackSpeed;

            // Calculate position along path based on current timeline
            const elapsedTime = currentTime - packetStartTime;
            const position = Math.min(1, Math.max(0, elapsedTime / adjustedDuration));

            return {
              id: `${packet.id}-${index}`,
              packet,
              position,
              element: null,
            };
          })
          .filter((packet) => packet.position > 0 && packet.position < 1); // Only show packets in transit

        setAnimatedPackets(newAnimatedPackets);

        if (isPlaying) {
          animationRef.current = requestAnimationFrame(animate);
        }
      };

      animate();

      return () => {
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }
      };
    }, [
      packets,
      currentTime,
      isPlaying,
      playbackSpeed,
      edgePath,
      selectedRunId,
      playbackMode,
      isDimmed,
    ]);

    // Position packets along the Bezier curve
    const getPointOnBezierCurve = (
      t: number,
      sourceX: number,
      sourceY: number,
      targetX: number,
      targetY: number,
    ): { x: number; y: number } => {
      // Calculate control points for a smooth Bezier curve
      const controlPointOffsetX = Math.abs(targetX - sourceX) * 0.25;
      const controlPointOffsetY = Math.abs(targetY - sourceY) * 0.1;

      const cp1x = sourceX + controlPointOffsetX;
      const cp1y = sourceY - controlPointOffsetY;
      const cp2x = targetX - controlPointOffsetX;
      const cp2y = targetY - controlPointOffsetY;

      // Cubic Bezier curve formula
      const x =
        Math.pow(1 - t, 3) * sourceX +
        3 * Math.pow(1 - t, 2) * t * cp1x +
        3 * (1 - t) * Math.pow(t, 2) * cp2x +
        Math.pow(t, 3) * targetX;

      const y =
        Math.pow(1 - t, 3) * sourceY +
        3 * Math.pow(1 - t, 2) * t * cp1y +
        3 * (1 - t) * Math.pow(t, 2) * cp2y +
        Math.pow(t, 3) * targetY;

      return { x, y };
    };

    const isPathHighlighted = data?.isPathHighlighted ?? false;

    if (mode !== 'execution' || !selectedRunId) {
      return (
        <>
          {/* Path highlight glow — rendered behind the main edge */}
          {isPathHighlighted && (
            <path
              d={edgePath}
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth={8}
              strokeLinecap="round"
              opacity={0.3}
              filter="blur(3px)"
              pointerEvents="none"
            />
          )}
          <BaseEdge
            id={id}
            path={edgePath}
            markerEnd={markerEnd}
            style={{
              stroke: isPathHighlighted ? 'hsl(var(--primary))' : edgeStrokeColor,
              strokeWidth: isPathHighlighted ? 3 : undefined,
              ...(edgeDasharray ? { strokeDasharray: edgeDasharray } : {}),
            }}
          />
          {/* Subtle animated dash overlay — flows source→target */}
          <path
            d={edgePath}
            fill="none"
            stroke={isPathHighlighted ? 'hsl(var(--primary))' : edgeStrokeColor}
            strokeWidth={2}
            strokeDasharray={edgeDasharray ?? '8 16'}
            strokeOpacity={isPathHighlighted ? 0.5 : 0.25}
            className="edge-flow-pulse"
            style={
              {
                '--edge-dashoffset': edgeDasharraySum,
                animation: `edge-flow-pulse ${edgeDasharray ? '2s' : '4s'} linear infinite`,
              } as React.CSSProperties
            }
            pointerEvents="none"
          />
        </>
      );
    }

    const glowColor = useMemo(() => {
      if (isDimmed || !sourceNodeState) return null;
      return getEdgeStatusGlowColor(sourceNodeState.status, isDark);
    }, [isDimmed, sourceNodeState, isDark]);

    const isRunning = sourceNodeState?.status === 'running';

    return (
      <>
        {/* Glow path — rendered before the main edge so it sits behind it */}
        {glowColor && (
          <path
            d={edgePath}
            fill="none"
            stroke={glowColor}
            strokeWidth={6}
            strokeLinecap="round"
            opacity={isRunning ? undefined : 0.6}
            filter="blur(3px)"
            pointerEvents="none"
            className={isRunning ? 'edge-glow-pulse' : undefined}
            style={
              isRunning ? { animation: 'edge-glow-pulse 1.5s ease-in-out infinite' } : undefined
            }
          />
        )}

        {/* Base edge */}
        <BaseEdge
          id={id}
          path={edgePath}
          markerEnd={markerEnd}
          style={
            isDimmed
              ? {
                  stroke: 'hsl(var(--muted-foreground) / 0.2)',
                  strokeDasharray: edgeDasharray ?? '5,5',
                  opacity: 0.5,
                }
              : {
                  stroke: edgeStrokeColor,
                  ...(edgeDasharray ? { strokeDasharray: edgeDasharray } : {}),
                }
          }
        />

        {/* Animated data packets */}
        {animatedPackets.map((animatedPacket) => {
          const point = getPointOnBezierCurve(
            animatedPacket.position,
            sourceX,
            sourceY,
            targetX,
            targetY,
          );
          return (
            <div
              key={animatedPacket.id}
              className="absolute w-6 h-6 pointer-events-none"
              style={{
                left: point.x - 12, // Center the packet (width/2)
                top: point.y - 12, // Center the packet (height/2)
                transform: 'translate(-50%, -50%)',
              }}
            >
              <DataPacketComponent packet={animatedPacket.packet} onHover={setHoveredPacket} />
            </div>
          );
        })}

        {/* Packet hover tooltip */}
        {hoveredPacket && (
          <div
            className="absolute z-50 p-3 bg-popover border border-border rounded-lg shadow-xl max-w-xs"
            style={{
              left: '50%',
              top: '-60px',
              transform: 'translateX(-50%)',
            }}
          >
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase text-muted-foreground">
                  {hoveredPacket.type}
                </span>
                <span className="text-xs text-muted-foreground/70">
                  {(hoveredPacket.size / 1024).toFixed(1)}KB
                </span>
              </div>

              <div className="text-xs font-mono bg-muted p-2 rounded text-foreground">
                {JSON.stringify(hoveredPacket.payload, null, 2)}
              </div>

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{hoveredPacket.sourceNode}</span>
                <span>→</span>
                <span>{hoveredPacket.targetNode}</span>
              </div>
            </div>
          </div>
        )}

        {/* Edge label showing packet count */}
        {mode === 'execution' && selectedRunId && packets.length > 0 && (
          <EdgeLabelRenderer>
            <div
              className="absolute pointer-events-none"
              style={{
                transform: `translate(-50%, -50%) translate(${labelPosition.x}px, ${labelPosition.y - 20}px)`,
              }}
            >
              <div className="bg-blue-500 text-white text-xs px-2 py-1 rounded-full font-medium shadow-lg">
                {packets.length}
              </div>
            </div>
          </EdgeLabelRenderer>
        )}

        {/* Container for positioning elements */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            zIndex: 5,
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
          }}
        />
      </>
    );
  },
);

DataFlowEdge.displayName = 'DataFlowEdge';
