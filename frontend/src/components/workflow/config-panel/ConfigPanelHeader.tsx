import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface ConfigPanelHeaderProps {
  isToolMode: boolean;
  onClose: () => void;
}

export function ConfigPanelHeader({ isToolMode, onClose }: ConfigPanelHeaderProps) {
  return (
    <div className="flex items-center justify-between px-3 md:px-4 py-3 border-b min-h-[56px] md:min-h-0">
      <h3 className="font-medium text-sm">{isToolMode ? 'Tool' : 'Configuration'}</h3>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 md:h-7 md:w-7 hover:bg-muted"
        onClick={onClose}
        aria-label="Close panel"
      >
        <X className="h-5 w-5 md:h-4 md:w-4" />
      </Button>
    </div>
  );
}
