import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { realModuleExports } from '@/test/restore-mocks';

// Override any bled mock.module with the real store
mock.module('@/store/workflowStore', () => realModuleExports('@/store/workflowStore'));

import { useWorkflowStore } from '../workflowStore';

describe('workflowStore', () => {
  beforeEach(() => {
    useWorkflowStore.getState().resetWorkflow();
  });

  // --- Initial state ---

  it('has correct initial state', () => {
    const state = useWorkflowStore.getState();
    expect(state.metadata.id).toBeNull();
    expect(state.metadata.name).toBe('Untitled Workflow');
    expect(state.metadata.description).toBe('');
    expect(state.metadata.currentVersionId).toBeNull();
    expect(state.metadata.currentVersion).toBeNull();
    expect(state.isDirty).toBe(false);
  });

  // --- setWorkflowId ---

  it('setWorkflowId() updates only metadata.id', () => {
    useWorkflowStore.getState().setWorkflowId('wf-123');

    const state = useWorkflowStore.getState();
    expect(state.metadata.id).toBe('wf-123');
    expect(state.metadata.name).toBe('Untitled Workflow');
    expect(state.metadata.description).toBe('');
  });

  // --- setWorkflowName ---

  it('setWorkflowName() updates only metadata.name', () => {
    useWorkflowStore.getState().setWorkflowName('My Scan Workflow');

    const state = useWorkflowStore.getState();
    expect(state.metadata.name).toBe('My Scan Workflow');
    expect(state.metadata.id).toBeNull();
    expect(state.metadata.description).toBe('');
  });

  // --- setWorkflowDescription ---

  it('setWorkflowDescription() updates only metadata.description', () => {
    useWorkflowStore.getState().setWorkflowDescription('Scans all repos nightly');

    const state = useWorkflowStore.getState();
    expect(state.metadata.description).toBe('Scans all repos nightly');
    expect(state.metadata.name).toBe('Untitled Workflow');
  });

  // --- setMetadata ---

  it('setMetadata() merges partial updates without overwriting unset fields', () => {
    useWorkflowStore.getState().setWorkflowName('Original Name');
    useWorkflowStore.getState().setMetadata({
      id: 'wf-456',
      description: 'Updated desc',
    });

    const state = useWorkflowStore.getState();
    expect(state.metadata.id).toBe('wf-456');
    expect(state.metadata.name).toBe('Original Name'); // preserved
    expect(state.metadata.description).toBe('Updated desc');
  });

  it('setMetadata() can update currentVersionId and currentVersion', () => {
    useWorkflowStore.getState().setMetadata({
      currentVersionId: 'ver-1',
      currentVersion: 3,
    });

    const state = useWorkflowStore.getState();
    expect(state.metadata.currentVersionId).toBe('ver-1');
    expect(state.metadata.currentVersion).toBe(3);
  });

  // --- markDirty / markClean ---

  it('markDirty() sets isDirty to true', () => {
    useWorkflowStore.getState().markDirty();
    expect(useWorkflowStore.getState().isDirty).toBe(true);
  });

  it('markClean() sets isDirty to false', () => {
    useWorkflowStore.getState().markDirty();
    useWorkflowStore.getState().markClean();
    expect(useWorkflowStore.getState().isDirty).toBe(false);
  });

  it('markClean() is idempotent when already clean', () => {
    useWorkflowStore.getState().markClean();
    expect(useWorkflowStore.getState().isDirty).toBe(false);
  });

  // --- resetWorkflow ---

  it('resetWorkflow() returns state to initial values', () => {
    // Modify everything
    useWorkflowStore.getState().setWorkflowId('wf-999');
    useWorkflowStore.getState().setWorkflowName('Modified');
    useWorkflowStore.getState().setWorkflowDescription('Modified desc');
    useWorkflowStore.getState().setMetadata({
      currentVersionId: 'v-1',
      currentVersion: 5,
    });
    useWorkflowStore.getState().markDirty();

    // Reset
    useWorkflowStore.getState().resetWorkflow();

    const state = useWorkflowStore.getState();
    expect(state.metadata.id).toBeNull();
    expect(state.metadata.name).toBe('Untitled Workflow');
    expect(state.metadata.description).toBe('');
    expect(state.metadata.currentVersionId).toBeNull();
    expect(state.metadata.currentVersion).toBeNull();
    expect(state.isDirty).toBe(false);
  });
});
