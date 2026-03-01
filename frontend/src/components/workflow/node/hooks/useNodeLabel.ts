import { useState, useRef } from 'react';
import { useReactFlow } from 'reactflow';
import { useWorkflowStore } from '@/store/workflowStore';
import type { FrontendNodeData } from '@/schemas/node';

interface UseNodeLabelOptions {
  id: string;
  data: FrontendNodeData;
  componentName: string;
  isEntryPoint: boolean;
  mode: string;
}

/**
 * Manages node label editing: inline rename via double-click.
 */
export function useNodeLabel({ id, data, componentName, isEntryPoint, mode }: UseNodeLabelOptions) {
  const { setNodes } = useReactFlow();
  const markDirty = useWorkflowStore((s) => s.markDirty);

  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [editingLabelValue, setEditingLabelValue] = useState('');
  const labelInputRef = useRef<HTMLInputElement | null>(null);

  const displayLabel = data.label || componentName;
  const hasCustomLabel = !!(data.label && data.label !== componentName);

  const handleStartEditing = () => {
    if (isEntryPoint || mode !== 'design') return;
    setEditingLabelValue(data.label || componentName);
    setIsEditingLabel(true);
    setTimeout(() => labelInputRef.current?.focus(), 0);
  };

  const handleSaveLabel = () => {
    const trimmedValue = editingLabelValue.trim();
    if (trimmedValue && trimmedValue !== data.label) {
      setNodes((nodes) =>
        nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, label: trimmedValue } } : n)),
      );
      markDirty();
    }
    setIsEditingLabel(false);
  };

  const handleCancelEditing = () => setIsEditingLabel(false);

  const handleLabelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveLabel();
    } else if (e.key === 'Escape') handleCancelEditing();
  };

  return {
    displayLabel,
    hasCustomLabel,
    isEditingLabel,
    editingLabelValue,
    labelInputRef,
    setEditingLabelValue,
    handleStartEditing,
    handleSaveLabel,
    handleCancelEditing,
    handleLabelKeyDown,
  };
}
