import { Bot, Loader2, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useOperatorSession, useUpdateOperatorSession } from '@/hooks/queries/useOperatorQueries';

import { OperatorModeSelect } from './OperatorModeSelect';

interface OperatorTopBarActionsProps {
  sessionId?: string;
}

export function OperatorTopBarActions({ sessionId }: OperatorTopBarActionsProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: session } = useOperatorSession(sessionId);
  const updateSession = useUpdateOperatorSession();

  const updateMode = async (approvalMode: 'ask' | 'auto') => {
    if (!sessionId || approvalMode === session?.approvalMode) return;
    try {
      await updateSession.mutateAsync({ sessionId, input: { approvalMode } });
    } catch (error) {
      toast({
        title: 'Could not update Operator mode',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="flex items-center gap-2">
      {session ? (
        <OperatorModeSelect
          value={session.approvalMode}
          onChange={(mode) => void updateMode(mode)}
          disabled={updateSession.isPending}
        />
      ) : sessionId ? (
        <div className="flex h-8 w-8 items-center justify-center text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        </div>
      ) : null}
      <Button
        type="button"
        size="icon"
        variant="outline"
        className="h-8 w-8"
        aria-label="New Operator session"
        title="New Operator session"
        onClick={() => navigate('/operator')}
      >
        {sessionId ? <Plus className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}
