import { useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Loader2, AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useTicketingCallbackMutation } from '@/hooks/queries/useTicketingQueries';
import { humanizeApiError } from '@/lib/humanizeApiError';

export function TicketingCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const callbackMutation = useTicketingCallbackMutation();
  const hasAttempted = useRef(false);

  const code = searchParams.get('code');
  const state = searchParams.get('state');

  useEffect(() => {
    if (hasAttempted.current) return;
    if (!code || !state) return;

    hasAttempted.current = true;

    callbackMutation.mutate(
      { code, state },
      {
        onSuccess: () => {
          toast({ title: 'Jira connected successfully', variant: 'success' });
          navigate('/settings/ticketing', { replace: true });
        },
        onError: (err) => {
          toast({
            title: 'Failed to connect Jira',
            description: humanizeApiError(err),
            variant: 'destructive',
          });
        },
      },
    );
    // Only run once on mount
  }, [code, state]);

  const isMissingParams = !code || !state;

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="text-center space-y-4">
        {callbackMutation.isPending && (
          <>
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
            <p className="text-muted-foreground">Connecting to Jira…</p>
          </>
        )}

        {(callbackMutation.isError || isMissingParams) && (
          <>
            <AlertCircle className="h-8 w-8 mx-auto text-destructive" />
            <p className="text-sm text-destructive">
              {isMissingParams
                ? 'Missing authorization parameters. Please try connecting again.'
                : humanizeApiError(callbackMutation.error)}
            </p>
            <Button
              variant="outline"
              onClick={() => navigate('/settings/ticketing', { replace: true })}
            >
              Back to Settings
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
