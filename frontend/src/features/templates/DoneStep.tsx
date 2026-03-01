import { Button } from '@/components/ui/button';
import { CheckCircle2, Search } from 'lucide-react';

interface DoneStepProps {
  onCheckPrStatus: () => void;
  onClose: () => void;
}

export function DoneStep({ onCheckPrStatus, onClose }: DoneStepProps) {
  return (
    <div className="py-6">
      <div className="flex flex-col items-center text-center space-y-4">
        <div className="h-12 w-12 rounded-full bg-success/10 flex items-center justify-center">
          <CheckCircle2 className="h-6 w-6 text-success" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">Template Submitted!</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Your template has been submitted for review. You&apos;ll be notified once it&apos;s
            approved and added to the library.
          </p>
        </div>

        <div className="flex gap-2 w-full">
          <Button variant="outline" className="flex-1 gap-2" onClick={onCheckPrStatus}>
            <Search className="h-4 w-4" />
            Check PR Status
          </Button>
          <Button className="flex-1" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
