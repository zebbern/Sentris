import { type NodeProps, type Node } from '@xyflow/react';
import { NodeTerminalPanel } from '../terminal/NodeTerminalPanel';

interface TerminalNodeData {
  [key: string]: unknown;
  parentNodeId: string;
  runId: string | null;
  timelineSync: boolean;
  onClose: () => void;
}

export function TerminalNode({ data }: NodeProps<Node<TerminalNodeData>>) {
  return (
    <div className="nodrag nowheel nopan">
      <NodeTerminalPanel
        nodeId={data.parentNodeId}
        runId={data.runId}
        onClose={data.onClose}
        timelineSync={data.timelineSync}
      />
    </div>
  );
}
