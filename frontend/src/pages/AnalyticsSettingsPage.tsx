import { BarChart3 } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

export function AnalyticsSettingsPage() {
  useDocumentTitle('Analytics Settings');

  return (
    <div className="flex-1 bg-background">
      <div className="container mx-auto py-4 md:py-8 px-3 md:px-4">
        {/* Header */}
        <div className="mb-4 md:mb-8">
          <p className="text-sm md:text-base text-muted-foreground">
            Configure data retention and storage settings for workflow analytics
          </p>
        </div>

        <EmptyState
          icon={BarChart3}
          title="Coming Soon"
          description="Analytics settings including data retention, storage management, and subscription tiers will be available in a future release."
        />
      </div>
    </div>
  );
}
