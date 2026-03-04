import { useState, useCallback } from 'react';
import { Save, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { useUpdateTriageMutation } from '@/hooks/queries/useFindingsQueries';
import { StatusTransitionSelect } from '@/features/findings/StatusTransitionSelect';
import { AssigneePicker } from '@/features/findings/AssigneePicker';
import { SeverityBadge } from '@/features/findings/SeverityBadge';
import type { FindingTriageStatus } from '@/features/findings/types';
import { SEVERITY_VALUES } from '@sentris/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FindingTriageControlsProps {
  findingId: string;
  currentStatus: FindingTriageStatus;
  assigneeUserId: string | null;
  severityOverride: string | null;
  notes: string | null;
  originalSeverity?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FindingTriageControls({
  findingId,
  currentStatus,
  assigneeUserId,
  severityOverride,
  notes: initialNotes,
  originalSeverity,
}: FindingTriageControlsProps) {
  const { toast } = useToast();
  const mutation = useUpdateTriageMutation();

  const [localNotes, setLocalNotes] = useState(initialNotes ?? '');
  const [isNotesDirty, setIsNotesDirty] = useState(false);

  // Track which field is currently being mutated
  const [mutatingField, setMutatingField] = useState<string | null>(null);

  const handleMutation = useCallback(
    (field: string, payload: Record<string, unknown>) => {
      setMutatingField(field);
      mutation.mutate(
        {
          findingId,
          data: payload as Parameters<typeof mutation.mutate>[0]['data'],
        },
        {
          onSuccess: () => {
            toast({
              title: 'Triage updated',
              description: `Successfully updated ${field}.`,
              variant: 'success',
            });
          },
          // Error toast is handled by the mutation hook's onError
          onSettled: () => {
            setMutatingField(null);
          },
        },
      );
    },
    [findingId, mutation, toast],
  );

  const handleStatusChange = useCallback(
    (newStatus: FindingTriageStatus) => {
      handleMutation('status', { status: newStatus });
    },
    [handleMutation],
  );

  const handleAssigneeChange = useCallback(
    (userId: string | null) => {
      handleMutation('assignee', { assigneeUserId: userId ?? '' });
    },
    [handleMutation],
  );

  const handleSeverityOverride = useCallback(
    (value: string) => {
      const override = value === 'none' ? null : value;
      handleMutation('severity', { severityOverride: override });
    },
    [handleMutation],
  );

  const handleNotesSave = useCallback(() => {
    handleMutation('notes', { notes: localNotes || null });
    setIsNotesDirty(false);
  }, [handleMutation, localNotes]);

  const isDisabled = mutation.isPending;

  return (
    <div className="space-y-4">
      {/* Status */}
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
          Status
        </label>
        <StatusTransitionSelect
          currentStatus={currentStatus}
          onStatusChange={handleStatusChange}
          isLoading={mutatingField === 'status'}
          disabled={isDisabled && mutatingField !== 'status'}
        />
      </div>

      {/* Assignee */}
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
          Assignee
        </label>
        <AssigneePicker
          value={assigneeUserId}
          onChange={handleAssigneeChange}
          isLoading={mutatingField === 'assignee'}
          disabled={isDisabled && mutatingField !== 'assignee'}
        />
      </div>

      {/* Severity Override */}
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
          Severity Override
        </label>
        <div className="flex items-center gap-2">
          {originalSeverity && (
            <span className="text-xs text-muted-foreground">
              Original: <SeverityBadge severity={originalSeverity} />
            </span>
          )}
          <Select
            value={severityOverride ?? 'none'}
            onValueChange={handleSeverityOverride}
            disabled={isDisabled}
          >
            <SelectTrigger className="w-[140px] h-8 text-xs" aria-label="Override severity">
              {mutatingField === 'severity' ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Updating…
                </span>
              ) : (
                <SelectValue placeholder="No override" />
              )}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No override</SelectItem>
              {SEVERITY_VALUES.map((sev) => (
                <SelectItem key={sev} value={sev}>
                  <span className="capitalize">{sev}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Notes */}
      <div>
        <label
          htmlFor="triage-notes"
          className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5"
        >
          Notes
        </label>
        <Textarea
          id="triage-notes"
          placeholder="Add triage notes…"
          value={localNotes}
          onChange={(e) => {
            setLocalNotes(e.target.value);
            setIsNotesDirty(true);
          }}
          disabled={isDisabled}
          className="min-h-[60px] text-sm resize-y"
          rows={3}
        />
        {isNotesDirty && (
          <div className="flex justify-end mt-1.5">
            <Button
              size="sm"
              variant="outline"
              onClick={handleNotesSave}
              disabled={isDisabled}
              className="h-7 text-xs"
            >
              {mutatingField === 'notes' ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Save className="h-3 w-3 mr-1" />
              )}
              Save notes
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
