import { useEffect, useState } from 'react';
import { WorkflowSuccessCriteriaSchema, type WorkflowSuccessCriterion } from '@sentris/shared';
import { ListChecks, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { materializeSuccessCriteriaDrafts, type CriterionDraft } from './workflow-success-criteria';

type OutputCriterionDraft = Extract<CriterionDraft, { kind: 'output_assertion' }>;

interface WorkflowSuccessCriteriaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  criteria: WorkflowSuccessCriterion[];
  nodes: { id: string; label: string }[];
  disabled?: boolean;
  onSave: (criteria: WorkflowSuccessCriterion[]) => void;
}

const OPERATOR_LABELS: Record<OutputCriterionDraft['operator'], string> = {
  exists: 'Exists',
  not_empty: 'Is not empty',
  equals: 'Equals',
  contains: 'Contains text',
  gte: 'At least',
  lte: 'At most',
};

function criterionId(): string {
  return `criterion-${crypto.randomUUID()}`;
}

function toDraft(criterion: WorkflowSuccessCriterion): CriterionDraft {
  if (criterion.kind === 'finding_count') {
    return {
      ...criterion,
      minimum: criterion.minimum?.toString() ?? '',
      maximum: criterion.maximum?.toString() ?? '',
    };
  }
  const expectedText =
    criterion.expected === undefined
      ? ''
      : criterion.operator === 'contains'
        ? String(criterion.expected)
        : JSON.stringify(criterion.expected);
  return { ...criterion, expectedText };
}

export function WorkflowSuccessCriteriaDialog({
  open,
  onOpenChange,
  criteria,
  nodes,
  disabled = false,
  onSave,
}: WorkflowSuccessCriteriaDialogProps) {
  const [drafts, setDrafts] = useState<CriterionDraft[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDrafts(criteria.map(toDraft));
    setError(null);
  }, [criteria, open]);

  const updateDraft = (index: number, update: Partial<CriterionDraft>) => {
    setDrafts((current) =>
      current.map((draft, draftIndex) =>
        draftIndex === index ? ({ ...draft, ...update } as CriterionDraft) : draft,
      ),
    );
  };

  const handleSave = () => {
    try {
      const parsed = WorkflowSuccessCriteriaSchema.safeParse(
        materializeSuccessCriteriaDrafts(drafts),
      );
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? 'Review the success criteria.');
        return;
      }
      onSave(parsed.data);
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Review the success criteria.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="h-4 w-4" />
            Success criteria
          </DialogTitle>
          <DialogDescription>
            Optional deterministic checks stored with the next workflow version. Operator uses the
            candidate version&apos;s checks when comparing runs.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {drafts.length === 0 ? (
            <div className="rounded-md border border-dashed p-5 text-center text-sm text-muted-foreground">
              No criteria yet. Run health remains the comparison fallback.
            </div>
          ) : null}

          {drafts.map((draft, index) => (
            <div key={draft.id} className="space-y-3 rounded-md border bg-muted/15 p-3">
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Label htmlFor={`${draft.id}-title`}>Name</Label>
                  <Input
                    id={`${draft.id}-title`}
                    value={draft.title}
                    maxLength={191}
                    onChange={(event) => updateDraft(index, { title: event.target.value })}
                    placeholder="Produces an actionable report"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${draft.title || 'criterion'}`}
                  disabled={disabled}
                  onClick={() => setDrafts((current) => current.filter((_, i) => i !== index))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              {draft.kind === 'output_assertion' ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Node</Label>
                    <Select
                      value={draft.nodeRef}
                      onValueChange={(nodeRef) => updateDraft(index, { nodeRef })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select node" />
                      </SelectTrigger>
                      <SelectContent>
                        {nodes.map((node) => (
                          <SelectItem key={node.id} value={node.id}>
                            {node.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${draft.id}-path`}>Output path</Label>
                    <Input
                      id={`${draft.id}-path`}
                      value={draft.path}
                      onChange={(event) => updateDraft(index, { path: event.target.value })}
                      placeholder="/report/summary"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Check</Label>
                    <Select
                      value={draft.operator}
                      onValueChange={(operator: OutputCriterionDraft['operator']) =>
                        updateDraft(index, { operator, expectedText: '' })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(OPERATOR_LABELS).map(([operator, label]) => (
                          <SelectItem key={operator} value={operator}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {draft.operator !== 'exists' && draft.operator !== 'not_empty' ? (
                    <div className="space-y-1.5">
                      <Label htmlFor={`${draft.id}-expected`}>
                        {draft.operator === 'contains' ? 'Expected text' : 'Expected value'}
                      </Label>
                      <Input
                        id={`${draft.id}-expected`}
                        value={draft.expectedText}
                        onChange={(event) =>
                          updateDraft(index, { expectedText: event.target.value })
                        }
                        placeholder={draft.operator === 'equals' ? 'JSON or text' : undefined}
                      />
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`${draft.id}-minimum`}>Minimum findings</Label>
                    <Input
                      id={`${draft.id}-minimum`}
                      type="number"
                      min={0}
                      step={1}
                      value={draft.minimum}
                      onChange={(event) => updateDraft(index, { minimum: event.target.value })}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${draft.id}-maximum`}>Maximum findings</Label>
                    <Input
                      id={`${draft.id}-maximum`}
                      type="number"
                      min={0}
                      step={1}
                      value={draft.maximum}
                      onChange={(event) => updateDraft(index, { maximum: event.target.value })}
                      placeholder="Optional"
                    />
                  </div>
                </div>
              )}
            </div>
          ))}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled || nodes.length === 0 || drafts.length >= 20}
              onClick={() =>
                setDrafts((current) => [
                  ...current,
                  {
                    id: criterionId(),
                    title: '',
                    kind: 'output_assertion',
                    nodeRef: nodes[0]?.id ?? '',
                    path: '',
                    operator: 'not_empty',
                    expectedText: '',
                  },
                ])
              }
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Output check
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled || drafts.length >= 20}
              onClick={() =>
                setDrafts((current) => [
                  ...current,
                  {
                    id: criterionId(),
                    title: '',
                    kind: 'finding_count',
                    minimum: '',
                    maximum: '',
                  },
                ])
              }
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Finding count
            </Button>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={disabled} onClick={handleSave}>
            Use criteria
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
