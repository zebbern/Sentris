import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useUserPreferencesStore } from '@/store/userPreferencesStore';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import {
  Home,
  Package,
  CalendarClock,
  Webhook,
  Zap,
  Archive,
  Key,
  Lock,
  Server,
} from 'lucide-react';

const LANDING_PAGE_OPTIONS = [
  { value: '/', label: 'Workflow Builder', icon: Home },
  { value: '/templates', label: 'Template Library', icon: Package },
  { value: '/schedules', label: 'Schedules', icon: CalendarClock },
  { value: '/webhooks', label: 'Webhooks', icon: Webhook },
  { value: '/action-center', label: 'Action Center', icon: Zap },
  { value: '/artifacts', label: 'Artifact Library', icon: Archive },
  { value: '/api-keys', label: 'API Keys', icon: Key },
  { value: '/secrets', label: 'Secrets', icon: Lock },
  { value: '/mcp-library', label: 'MCP Library', icon: Server },
] as const;

const SIDEBAR_DENSITY_OPTIONS = [
  {
    value: 'comfortable' as const,
    label: 'Comfortable',
    description: 'Default spacing with full labels',
  },
  {
    value: 'compact' as const,
    label: 'Compact',
    description: 'Reduced spacing, auto-collapses on small screens',
  },
];

export function GeneralSettings() {
  useDocumentTitle('Settings · General');

  const defaultLandingPage = useUserPreferencesStore((s) => s.defaultLandingPage);
  const sidebarDensity = useUserPreferencesStore((s) => s.sidebarDensity);
  const setDefaultLandingPage = useUserPreferencesStore((s) => s.setDefaultLandingPage);
  const setSidebarDensity = useUserPreferencesStore((s) => s.setSidebarDensity);

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Default Landing Page */}
      <div className="space-y-3">
        <div>
          <Label htmlFor="landing-page" className="text-sm font-medium">
            Default Landing Page
          </Label>
          <p className="text-xs text-muted-foreground mt-1">
            Choose which page loads when you sign in.
          </p>
        </div>
        <Select value={defaultLandingPage} onValueChange={setDefaultLandingPage}>
          <SelectTrigger id="landing-page" className="w-full sm:w-72">
            <SelectValue placeholder="Select a page" />
          </SelectTrigger>
          <SelectContent>
            {LANDING_PAGE_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <SelectItem key={option.value} value={option.value}>
                  <span className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    {option.label}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {/* Sidebar Density */}
      <div className="space-y-3">
        <div>
          <Label className="text-sm font-medium">Sidebar Density</Label>
          <p className="text-xs text-muted-foreground mt-1">Control the sidebar layout density.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {SIDEBAR_DENSITY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setSidebarDensity(option.value)}
              className={`flex flex-col items-start gap-1 rounded-lg border p-4 text-left transition-colors ${
                sidebarDensity === option.value
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border hover:border-muted-foreground/30 hover:bg-muted/50'
              }`}
              aria-pressed={sidebarDensity === option.value}
            >
              <span className="text-sm font-medium">{option.label}</span>
              <span className="text-xs text-muted-foreground">{option.description}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
