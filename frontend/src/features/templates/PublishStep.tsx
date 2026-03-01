import { Button } from '@/components/ui/button';
import {
  Check,
  ClipboardCheck,
  ExternalLink,
  GitPullRequest,
  RefreshCw,
  Search,
} from 'lucide-react';
import { JsonPreview } from './JsonPreview';

interface PublishStepProps {
  returnedFromGithub: boolean;
  hasCopiedOnSubmit: boolean;
  generatedTemplateJson: string;
  isCopied: boolean;
  onCopyToClipboard: () => Promise<void>;
  onCheckPrStatus: () => void;
  onConfirmDone: () => void;
  onResetReturn: () => void;
}

export function PublishStepView({
  returnedFromGithub,
  hasCopiedOnSubmit,
  generatedTemplateJson,
  isCopied,
  onCopyToClipboard,
  onCheckPrStatus,
  onConfirmDone,
  onResetReturn,
}: PublishStepProps) {
  return (
    <div className="py-4">
      <div className="flex flex-col items-center text-center space-y-4">
        {returnedFromGithub ? (
          <>
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <GitPullRequest className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">Welcome back!</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Did you create the pull request on GitHub?
              </p>
            </div>
            <div className="flex gap-2 w-full">
              <Button variant="outline" className="flex-1" onClick={onResetReturn}>
                Not yet
              </Button>
              <Button className="flex-1 gap-2" onClick={onConfirmDone}>
                <Check className="h-4 w-4" />
                Yes, I created it
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <ExternalLink className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">Create Your Pull Request</h3>
              <p className="text-xs text-muted-foreground mt-1">
                A GitHub editor has opened in a new tab. Paste the template code there to propose
                your changes.
              </p>
              <p className="text-sm font-medium mt-2">
                {hasCopiedOnSubmit
                  ? 'Template code has been copied to your clipboard.'
                  : 'Copy the template code below and paste it in the GitHub editor.'}
              </p>
            </div>
          </>
        )}

        {/* Copy Template Code Button */}
        <Button variant="outline" className="w-full gap-2" onClick={onCopyToClipboard}>
          {isCopied ? (
            <>
              <ClipboardCheck className="h-4 w-4 text-success" />
              Copied to Clipboard!
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4" />
              Copy Template Code Again
            </>
          )}
        </Button>

        {/* Collapsible JSON preview — collapsed in publish state */}
        <div className="w-full">
          <JsonPreview
            json={generatedTemplateJson}
            defaultOpen={false}
            onCopy={onCopyToClipboard}
            isCopied={isCopied}
          />
        </div>

        <div className="w-full p-3 rounded-lg bg-muted/50 space-y-3 text-sm">
          <p className="text-left">
            <strong>Instructions:</strong>
          </p>
          <ol className="text-left list-decimal list-inside space-y-2 text-muted-foreground">
            <li>
              <strong>Replace</strong> the placeholder comment in the GitHub editor with the copied
              template code
            </li>
            <li>
              <strong>Important:</strong> Click &quot;Propose new file&quot; (NOT &quot;Commit
              directly&quot;)
            </li>
            <li>
              <strong>Create Pull Request</strong> to submit your template for review
            </li>
          </ol>
          <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded text-xs">
            <strong>Note:</strong> Creating a PR allows reviewers to check your template before
            it&apos;s added to the library.
          </div>
        </div>

        {!returnedFromGithub && (
          <div className="flex gap-2 w-full">
            <Button variant="outline" className="flex-1 gap-2" onClick={onCheckPrStatus}>
              <Search className="h-4 w-4" />
              Check PR Status
            </Button>
            <Button className="flex-1 gap-2" onClick={onConfirmDone}>
              <Check className="h-4 w-4" />
              I&apos;ve Created the PR
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
