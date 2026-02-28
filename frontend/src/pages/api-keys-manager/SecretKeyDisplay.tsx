import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Copy } from 'lucide-react';
import { DialogFooter } from '@/components/ui/dialog';

export interface SecretKeyDisplayProps {
  secretKey: string;
  onCopy: (text: string) => void;
  onDone: () => void;
}

export function SecretKeyDisplay({ secretKey, onCopy, onDone }: SecretKeyDisplayProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-md bg-warning/10 dark:bg-warning/10 p-4 mb-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <AlertTriangle className="h-5 w-5 text-warning" aria-hidden="true" />
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-warning">Save your secret key</h3>
            <div className="mt-2 text-sm text-warning">
              <p>
                This is the only time we will show you the secret key. Make sure to copy it now.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Secret Key</Label>
        <div className="flex items-center gap-2">
          <Input readOnly value={secretKey} className="font-mono bg-muted" />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Copy secret key"
            onClick={() => onCopy(secretKey)}
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <DialogFooter>
        <Button onClick={onDone}>Done</Button>
      </DialogFooter>
    </div>
  );
}
