import { Sun, Moon, Monitor } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { useThemeStore } from '@/store/themeStore';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { cn } from '@/lib/utils';

type ThemePreference = 'light' | 'dark' | 'system';

const THEME_OPTIONS: {
  value: ThemePreference;
  label: string;
  description: string;
  icon: typeof Sun;
}[] = [
  {
    value: 'light',
    label: 'Light',
    description: 'Clean, bright interface for well-lit environments',
    icon: Sun,
  },
  {
    value: 'dark',
    label: 'Dark',
    description: 'Easy on the eyes, ideal for low-light environments',
    icon: Moon,
  },
  {
    value: 'system',
    label: 'System',
    description: 'Automatically matches your operating system preference',
    icon: Monitor,
  },
];

export function AppearanceSettings() {
  useDocumentTitle('Settings · Appearance');

  const themePreference = useThemeStore((s) => s.themePreference);
  const setThemePreference = useThemeStore((s) => s.setThemePreference);

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Theme Selection */}
      <div className="space-y-3">
        <div>
          <Label className="text-sm font-medium">Theme</Label>
          <p className="text-xs text-muted-foreground mt-1">Select your preferred color scheme.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Theme preference">
          {THEME_OPTIONS.map((option) => {
            const Icon = option.icon;
            const isSelected = themePreference === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => setThemePreference(option.value)}
                className={cn(
                  'flex flex-col items-center gap-3 rounded-lg border p-5 text-center transition-colors',
                  isSelected
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-border hover:border-muted-foreground/30 hover:bg-muted/50',
                )}
              >
                <div
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-full',
                    isSelected ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                  )}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <span className="text-sm font-medium">{option.label}</span>
                  <p className="text-xs text-muted-foreground">{option.description}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
