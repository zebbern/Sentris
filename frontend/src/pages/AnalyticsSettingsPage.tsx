import { useState, useEffect, useCallback } from 'react';
import { Save, Shield, Clock, Info } from 'lucide-react';
import { format } from 'date-fns';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorBanner } from '@/components/ui/error-banner';
import { useToast } from '@/components/ui/use-toast';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import {
  useAnalyticsSettings,
  useUpdateAnalyticsSettings,
} from '@/hooks/queries/useAnalyticsSettingsQueries';
import { useAuthStore } from '@/store/authStore';
import { humanizeApiError } from '@/lib/humanizeApiError';
import { hasAdminRole } from '@/utils/auth';
import type { SubscriptionTier } from '@/services/api';

const TIER_LIMITS: Record<SubscriptionTier, number> = {
  free: 30,
  pro: 90,
  enterprise: 365,
};

const TIER_LABELS: Record<SubscriptionTier, string> = {
  free: 'Free',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

const TIER_BADGE_VARIANT: Record<SubscriptionTier, 'secondary' | 'default' | 'success'> = {
  free: 'secondary',
  pro: 'default',
  enterprise: 'success',
};

function SettingsSkeleton() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-10 w-32" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-40" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-4 w-48" />
        </CardContent>
      </Card>
    </div>
  );
}

export function AnalyticsSettingsPage() {
  useDocumentTitle('Analytics Settings');

  const roles = useAuthStore((state) => state.roles);
  const isAdmin = hasAdminRole(roles);

  const { data: settings, isLoading, error, refetch } = useAnalyticsSettings();
  const updateMutation = useUpdateAnalyticsSettings();
  const { toast } = useToast();

  const [retentionDays, setRetentionDays] = useState<number>(30);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Sync form state when settings load
  useEffect(() => {
    if (settings) {
      setRetentionDays(settings.analyticsRetentionDays);
      setHasUnsavedChanges(false);
    }
  }, [settings]);

  const maxDays = settings?.maxRetentionDays ?? TIER_LIMITS.free;

  const validateRetention = useCallback(
    (value: number): string | null => {
      if (!Number.isInteger(value)) return 'Retention days must be a whole number.';
      if (value < 1) return 'Retention days must be at least 1.';
      if (value > maxDays) return `Retention days cannot exceed ${maxDays} for your tier.`;
      return null;
    },
    [maxDays],
  );

  const handleRetentionChange = useCallback(
    (value: number) => {
      setRetentionDays(value);
      setValidationError(validateRetention(value));
      setHasUnsavedChanges(value !== settings?.analyticsRetentionDays);
    },
    [validateRetention, settings?.analyticsRetentionDays],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      if (raw === '') {
        setRetentionDays(0);
        setValidationError('Retention days must be at least 1.');
        setHasUnsavedChanges(true);
        return;
      }
      const parsed = parseInt(raw, 10);
      if (isNaN(parsed)) return;
      handleRetentionChange(parsed);
    },
    [handleRetentionChange],
  );

  const handleSliderChange = useCallback(
    (value: number[]) => {
      handleRetentionChange(value[0]);
    },
    [handleRetentionChange],
  );

  const handleSave = useCallback(async () => {
    const error = validateRetention(retentionDays);
    if (error) {
      setValidationError(error);
      return;
    }

    try {
      await updateMutation.mutateAsync({ analyticsRetentionDays: retentionDays });
      setHasUnsavedChanges(false);
      toast({
        title: 'Settings saved',
        description: 'Analytics retention settings have been updated.',
      });
    } catch (err: unknown) {
      toast({
        title: 'Failed to save',
        description: humanizeApiError(err),
        variant: 'destructive',
      });
    }
  }, [retentionDays, validateRetention, updateMutation, toast]);

  return (
    <div className="flex-1 bg-background">
      <div className="container mx-auto py-4 md:py-8 px-3 md:px-4 max-w-3xl">
        {/* Error state */}
        {error && (
          <ErrorBanner
            message={humanizeApiError(error)}
            onRetry={() => refetch()}
            className="mb-6"
          />
        )}

        {/* Loading state */}
        {isLoading && <SettingsSkeleton />}

        {/* Placeholder when error with no data */}
        {error && !isLoading && !settings && <SettingsSkeleton />}

        {/* Settings form */}
        {settings && !isLoading && (
          <div className="space-y-6">
            {/* Retention Settings Card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Data Retention
                </CardTitle>
                <CardDescription>
                  Control how long analytics data is retained before automatic cleanup.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Retention days input + slider */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="retention-days" className="text-sm font-medium">
                      Retention Period (days)
                    </Label>
                    <span className="text-xs text-muted-foreground">
                      Max: {maxDays} days ({TIER_LABELS[settings.subscriptionTier]} tier)
                    </span>
                  </div>

                  {isAdmin ? (
                    <>
                      <div className="flex items-center gap-4">
                        <Input
                          id="retention-days"
                          type="number"
                          min={1}
                          max={maxDays}
                          step={1}
                          value={retentionDays}
                          onChange={handleInputChange}
                          className="w-24"
                          aria-describedby={validationError ? 'retention-error' : undefined}
                          aria-invalid={!!validationError}
                        />
                        <div className="flex-1">
                          <Slider
                            min={1}
                            max={maxDays}
                            step={1}
                            value={[retentionDays]}
                            onValueChange={handleSliderChange}
                          />
                        </div>
                      </div>

                      {validationError && (
                        <p
                          id="retention-error"
                          role="alert"
                          className="text-sm text-destructive flex items-center gap-1"
                        >
                          <span aria-hidden="true">⚠</span>
                          {validationError}
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-foreground">
                      <span className="font-medium">{settings.analyticsRetentionDays} days</span>
                    </div>
                  )}
                </div>

                {/* Save button (admin only) */}
                {isAdmin && (
                  <div className="flex items-center gap-3">
                    <Button
                      onClick={handleSave}
                      disabled={updateMutation.isPending || !!validationError || !hasUnsavedChanges}
                      size="sm"
                    >
                      <Save className="h-4 w-4 mr-1.5" />
                      {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
                    </Button>
                    {hasUnsavedChanges && (
                      <span className="text-xs text-muted-foreground">Unsaved changes</span>
                    )}
                  </div>
                )}

                {/* Mutation error */}
                {updateMutation.isError && (
                  <ErrorBanner message={humanizeApiError(updateMutation.error)} className="mt-2" />
                )}

                {/* Non-admin notice */}
                {!isAdmin && (
                  <div className="flex items-start gap-2 rounded-md border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
                    <Shield className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>
                      Only administrators can modify analytics settings. Contact your admin to
                      request changes.
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Subscription & Limits Card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Info className="h-4 w-4" />
                  Subscription &amp; Limits
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {/* Current tier */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Current Tier</span>
                    <Badge variant={TIER_BADGE_VARIANT[settings.subscriptionTier]}>
                      {TIER_LABELS[settings.subscriptionTier]}
                    </Badge>
                  </div>

                  {/* Tier limits table */}
                  <div className="rounded-md border border-border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/50">
                          <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                            Tier
                          </th>
                          <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                            Max Retention
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {(Object.entries(TIER_LIMITS) as [SubscriptionTier, number][]).map(
                          ([tier, limit]) => (
                            <tr
                              key={tier}
                              className={`border-b border-border last:border-0 ${
                                tier === settings.subscriptionTier ? 'bg-primary/5' : ''
                              }`}
                            >
                              <td className="px-4 py-2 text-foreground">
                                <span className="flex items-center gap-2">
                                  {TIER_LABELS[tier]}
                                  {tier === settings.subscriptionTier && (
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                      Current
                                    </Badge>
                                  )}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-right text-foreground tabular-nums">
                                {limit} days
                              </td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Last updated */}
                  <div className="flex items-center justify-between pt-2 border-t border-border">
                    <span className="text-sm text-muted-foreground">Last Updated</span>
                    <span className="text-sm text-foreground tabular-nums">
                      {format(new Date(settings.updatedAt), 'MMM d, yyyy HH:mm')}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
