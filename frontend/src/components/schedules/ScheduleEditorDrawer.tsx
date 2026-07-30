import type { WorkflowSchedule } from '@sentris/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { HelpCircle, Loader2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { ScheduleEditorMode, WorkflowOption } from './scheduleTypes';
import { ScheduleFormFields } from './ScheduleFormFields';
import { CronExpressionInput } from './CronExpressionInput';
import { RuntimeInputsSection } from './RuntimeInputsSection';
import { NodeOverridesSection } from './NodeOverridesSection';
import { useScheduleEditorState } from './useScheduleEditorState';

export type { RuntimeInputDefinition, WorkflowOption, ScheduleEditorMode } from './scheduleTypes';

interface ScheduleEditorDrawerProps {
  open: boolean;
  mode: ScheduleEditorMode;
  schedule?: WorkflowSchedule | null;
  defaultWorkflowId?: string | null;
  workflowOptions: WorkflowOption[];
  onClose: () => void;
  onSaved?: (schedule: WorkflowSchedule, mode: ScheduleEditorMode) => void;
}

const ENTRY_SECTION_COPY =
  'Configure how this workflow should run on a cadence. Provide runtime inputs for the Entry Point and optional node overrides before saving the schedule.';

export function ScheduleEditorDrawer(props: ScheduleEditorDrawerProps) {
  const { open, mode, workflowOptions, onClose } = props;

  const {
    form,
    workflowLoading,
    runtimeInputs,
    runtimeValues,
    runtimeErrors,
    uploading,
    nodeOverridesDraft,
    nodeOverrideErrors,
    pendingOverrideNode,
    formError,
    cronError,
    submitting,
    formSeed,
    selectedWorkflow,
    workflowNodes,
    availableOverrideNodes,
    handleFieldChange,
    handleWorkflowChange,
    handleRuntimeInputChange,
    handleFileUpload,
    addOverrideNode,
    removeOverrideNode,
    handleOverrideChange,
    setPendingOverrideNode,
    handleSubmit,
  } = useScheduleEditorState(props);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !submitting) {
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-2xl gap-3 overflow-y-auto p-4 sm:p-5">
        <DialogHeader className="space-y-1">
          <div className="flex items-center gap-1.5">
            <DialogTitle className="text-lg">
              {mode === 'create' ? 'Create schedule' : 'Edit schedule'}
            </DialogTitle>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
                    aria-label="About schedules"
                  >
                    <HelpCircle className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs text-xs leading-relaxed">
                  {ENTRY_SECTION_COPY}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <DialogDescription className="sr-only">{ENTRY_SECTION_COPY}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <ScheduleFormFields
            form={form}
            workflowOptions={workflowOptions}
            selectedWorkflow={selectedWorkflow}
            workflowDisabled={mode === 'edit'}
            onFieldChange={handleFieldChange}
            onWorkflowChange={handleWorkflowChange}
          />

          <CronExpressionInput
            form={form}
            cronError={cronError}
            onFieldChange={handleFieldChange}
          />

          <RuntimeInputsSection
            workflowId={form.workflowId}
            workflowLoading={workflowLoading}
            runtimeInputs={runtimeInputs}
            runtimeValues={runtimeValues}
            runtimeErrors={runtimeErrors}
            uploading={uploading}
            formSeed={formSeed}
            onRuntimeInputChange={handleRuntimeInputChange}
            onFileUpload={handleFileUpload}
          />

          <NodeOverridesSection
            nodeOverridesDraft={nodeOverridesDraft}
            nodeOverrideErrors={nodeOverrideErrors}
            workflowNodes={workflowNodes}
            availableOverrideNodes={availableOverrideNodes}
            pendingOverrideNode={pendingOverrideNode}
            onAddOverrideNode={addOverrideNode}
            onRemoveOverrideNode={removeOverrideNode}
            onOverrideChange={handleOverrideChange}
            onPendingOverrideNodeChange={setPendingOverrideNode}
          />

          {formError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {formError}
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={submitting || !form.workflowId}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving
              </>
            ) : (
              'Save schedule'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
