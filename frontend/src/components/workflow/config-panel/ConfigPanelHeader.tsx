import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useUserPreferencesStore } from '@/store/userPreferencesStore';
import { Label } from '@/components/ui/label';

export interface ConfigPanelHeaderProps {
  isToolMode: boolean;
  onClose: () => void;
}

export function ConfigPanelHeader({ isToolMode, onClose }: ConfigPanelHeaderProps) {
  const hideConfigInfoSections = useUserPreferencesStore((s) => s.hideConfigInfoSections);
  const setHideConfigInfoSections = useUserPreferencesStore((s) => s.setHideConfigInfoSections);

  const toggleLabel = hideConfigInfoSections ? 'Show info sections?' : 'Hide info sections?';

  return (
    <div className="flex items-center justify-between gap-2 px-3 md:px-4 py-3 border-b min-h-[56px] md:min-h-0">
      <h3 className="font-medium text-sm shrink-0">{isToolMode ? 'Tool' : 'Configuration'}</h3>
      <div className="flex items-center gap-2 min-w-0">
        <Label
          htmlFor="config-hide-info-sections"
          className="text-[11px] text-muted-foreground font-normal cursor-pointer truncate"
        >
          {toggleLabel}
        </Label>
        <Switch
          id="config-hide-info-sections"
          checked={hideConfigInfoSections}
          onCheckedChange={setHideConfigInfoSections}
          className="h-5 w-9 [&>span]:h-4 [&>span]:w-4 [&>span]:data-[state=checked]:translate-x-4"
          aria-label={toggleLabel}
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 md:h-7 md:w-7 hover:bg-muted shrink-0"
          onClick={onClose}
          aria-label="Close panel"
        >
          <X className="h-5 w-5 md:h-4 md:w-4" />
        </Button>
      </div>
    </div>
  );
}
