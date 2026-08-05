import { Bot, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';

interface OperatorTopBarActionsProps {
  sessionId?: string;
}

export function OperatorTopBarActions({ sessionId }: OperatorTopBarActionsProps) {
  const navigate = useNavigate();

  return (
    <div className="flex items-center gap-2">
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
