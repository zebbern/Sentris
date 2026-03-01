import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DialogFooter } from '@/components/ui/dialog';
import { AlertCircle, ExternalLink, Loader2 } from 'lucide-react';
import { JsonPreview } from './JsonPreview';

interface ReviewStepProps {
  name: string;
  description: string;
  category: string;
  author: string;
  tags: string[];
  generatedTemplateJson: string;
  error: string | null;
  isLoading: boolean;
  isCopied: boolean;
  onBack: () => void;
  onPublish: () => void;
  onCopyJson: () => Promise<void>;
}

export function ReviewStep({
  name,
  description,
  category,
  author,
  tags,
  generatedTemplateJson,
  error,
  isLoading,
  isCopied,
  onBack,
  onPublish,
  onCopyJson,
}: ReviewStepProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-muted-foreground">Name:</span>
            <p className="font-medium">{name}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Category:</span>
            <p className="font-medium capitalize">{category}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Author:</span>
            <p className="font-medium">{author}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Version:</span>
            <p className="font-medium">1.0.0</p>
          </div>
        </div>
        {description && (
          <div className="text-sm">
            <span className="text-muted-foreground">Description:</span>
            <p className="font-medium">{description}</p>
          </div>
        )}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* JSON Preview — expanded in review step */}
      <JsonPreview
        json={generatedTemplateJson}
        defaultOpen={true}
        onCopy={onCopyJson}
        isCopied={isCopied}
      />

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/50">
          <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onBack} disabled={isLoading}>
          Back
        </Button>
        <Button onClick={onPublish} disabled={isLoading} className="gap-2">
          {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
          <ExternalLink className="h-4 w-4" />
          Copy &amp; Open GitHub
        </Button>
      </DialogFooter>
    </div>
  );
}
