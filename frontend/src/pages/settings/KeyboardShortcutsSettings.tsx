import { Keyboard } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

const SHORTCUTS = [
  { keys: ['Ctrl', 'K'], description: 'Command palette' },
  { keys: ['Ctrl', '/'], description: 'Toggle sidebar' },
  { keys: ['Ctrl', '`'], description: 'Toggle terminal panel' },
  { keys: ['Ctrl', 'Shift', ']'], description: 'Next terminal tab' },
  { keys: ['Ctrl', 'Shift', '['], description: 'Previous terminal tab' },
] as const;

export function KeyboardShortcutsSettings() {
  useDocumentTitle('Settings · Shortcuts');

  return (
    <div className="space-y-8 max-w-2xl">
      <div className="space-y-3">
        <div>
          <Label className="text-sm font-medium">Keyboard Shortcuts</Label>
          <p className="text-xs text-muted-foreground mt-1">
            Available keyboard shortcuts for quick navigation and actions.
          </p>
        </div>

        <div className="rounded-lg border">
          <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/50">
            <Keyboard className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Global Shortcuts</span>
          </div>
          <div className="divide-y">
            {SHORTCUTS.map((shortcut) => (
              <div
                key={shortcut.description}
                className="flex items-center justify-between px-4 py-3"
              >
                <span className="text-sm text-foreground">{shortcut.description}</span>
                <div className="flex items-center gap-1">
                  {shortcut.keys.map((key, i) => (
                    <span key={i} className="flex items-center gap-1">
                      {i > 0 && <span className="text-xs text-muted-foreground">+</span>}
                      <kbd className="inline-flex h-6 min-w-[24px] items-center justify-center rounded border bg-muted px-1.5 font-mono text-xs text-muted-foreground">
                        {key}
                      </kbd>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Keyboard shortcuts follow your OS conventions. On macOS, use{' '}
          <kbd className="inline-flex h-5 min-w-[18px] items-center justify-center rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground">
            ⌘
          </kbd>{' '}
          instead of{' '}
          <kbd className="inline-flex h-5 min-w-[18px] items-center justify-center rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground">
            Ctrl
          </kbd>
          .
        </p>
      </div>
    </div>
  );
}
