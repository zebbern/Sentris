import { useState, useCallback, useEffect, useRef } from 'react';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { useTemplates } from '@/hooks/queries/useTemplateQueries';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  GitPullRequest,
  X,
  ExternalLink,
  Copy,
  ClipboardCheck,
  ChevronDown,
  ChevronRight,
  Check,
  Search,
  RefreshCw,
  Info,
} from 'lucide-react';
import { API_BASE_URL, getApiAuthHeaders } from '@/services/api';
import { cn } from '@/lib/utils';

interface PublishTemplateModalProps {
  workflowId: string;
  workflowName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

const DEFAULT_GITHUB_TEMPLATE_REPO =
  import.meta.env.VITE_GITHUB_TEMPLATE_REPO || 'zebbern/sentris-templates';
const DEFAULT_GITHUB_BRANCH = import.meta.env.VITE_GITHUB_TEMPLATE_BRANCH || 'main';

const TEMPLATE_CATEGORIES = [
  'Security',
  'Monitoring',
  'Compliance',
  'Incident Response',
  'Data Processing',
  'Integration',
  'Automation',
  'Reporting',
  'Testing',
  'Other',
];

const COMMON_TAGS = [
  'security',
  'monitoring',
  'automation',
  'integration',
  'api',
  'notification',
  'compliance',
  'scanning',
  'analysis',
  'reporting',
  'incident',
  'response',
  'forensics',
  'enrichment',
  'detection',
];

interface WorkflowResponse {
  id: string;
  name: string;
  description?: string;
  manifest: Record<string, unknown>;
  graph: Record<string, unknown>;
}

interface TemplateMetadata {
  name: string;
  description?: string;
  category: string;
  tags: string[];
  author: string;
  version: string;
}

interface TemplateJson {
  _metadata: TemplateMetadata;
  graph: Record<string, unknown>;
  requiredSecrets: { name: string; type: string; description?: string }[];
}

type PublishStep = 'configure' | 'review' | 'publish' | 'done';

const PUBLISH_STEPS: { key: PublishStep; label: string }[] = [
  { key: 'configure', label: 'Configure' },
  { key: 'review', label: 'Review' },
  { key: 'publish', label: 'Publish' },
  { key: 'done', label: 'Done' },
];

function StepIndicator({ currentStep }: { currentStep: PublishStep }) {
  const currentIndex = PUBLISH_STEPS.findIndex((s) => s.key === currentStep);

  return (
    <nav aria-label="Publishing progress" className="flex items-center gap-1 w-full mb-4">
      {PUBLISH_STEPS.map((step, index) => {
        const isCompleted = index < currentIndex;
        const isCurrent = index === currentIndex;

        return (
          <div key={step.key} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  'flex items-center justify-center h-7 w-7 rounded-full text-xs font-medium transition-colors',
                  isCompleted && 'bg-success text-success-foreground',
                  isCurrent && 'bg-primary text-primary-foreground',
                  !isCompleted && !isCurrent && 'bg-muted text-muted-foreground',
                )}
              >
                {isCompleted ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </div>
              <span
                className={cn(
                  'text-[10px] font-medium whitespace-nowrap',
                  isCurrent ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {step.label}
              </span>
            </div>
            {index < PUBLISH_STEPS.length - 1 && (
              <div
                className={cn(
                  'flex-1 h-0.5 mx-1.5 mt-[-14px]',
                  index < currentIndex ? 'bg-success' : 'bg-muted',
                )}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}

function formatJsonSize(json: string): string {
  const bytes = new Blob([json]).size;
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function JsonPreview({
  json,
  defaultOpen,
  onCopy,
  isCopied,
}: {
  json: string;
  defaultOpen: boolean;
  onCopy: () => void;
  isCopied: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="rounded-lg border overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsOpen(!isOpen);
          }
        }}
        className="w-full flex items-center justify-between px-3 py-2 text-left bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">Template JSON</span>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {formatJsonSize(json)}
          </Badge>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={(e) => {
            e.stopPropagation();
            onCopy();
          }}
        >
          {isCopied ? (
            <>
              <ClipboardCheck className="h-3.5 w-3.5 text-success" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copy
            </>
          )}
        </Button>
      </div>
      {isOpen && (
        <pre className="px-3 py-2 text-xs font-mono overflow-x-auto max-h-64 overflow-y-auto bg-muted/10 border-t whitespace-pre text-muted-foreground leading-relaxed">
          {json}
        </pre>
      )}
    </div>
  );
}

/**
 * Sanitize secrets from the workflow graph by replacing secret references with placeholders
 */
function sanitizeGraphForTemplate(graph: Record<string, unknown>): Record<string, unknown> {
  const sanitized = JSON.parse(JSON.stringify(graph)); // Deep clone

  // Helper to recursively sanitize secret references
  const traverseAndSanitize = (obj: unknown): unknown => {
    if (typeof obj === 'object' && obj !== null) {
      if (Array.isArray(obj)) {
        return obj.map(traverseAndSanitize);
      }

      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        // Check for secret reference patterns
        if (
          key === 'secretId' ||
          key === 'secret_name' ||
          key === 'secretName' ||
          key === 'secret_ref' ||
          key === 'secretRef'
        ) {
          result[key] = '{{SECRET_PLACEHOLDER}}';
        } else if (
          typeof value === 'string' &&
          (value.includes('${secrets.') ||
            value.includes('${secret.') ||
            value.includes('{{secret.') ||
            value.includes('{{secret:'))
        ) {
          // Replace secret interpolation expressions with placeholder
          result[key] = value
            .replace(/\$\{secrets\.[^}]+\}/g, '{{SECRET_PLACEHOLDER}}')
            .replace(/\$\{secret\.[^}]+\}/g, '{{SECRET_PLACEHOLDER}}')
            .replace(/\{\{secret\.[^}]+\}\}/g, '{{SECRET_PLACEHOLDER}}')
            .replace(/\{\{secret:[a-f0-9-]+\}\}/gi, '{{SECRET_PLACEHOLDER}}');
        } else {
          result[key] = traverseAndSanitize(value);
        }
      }
      return result;
    }
    return obj;
  };

  return traverseAndSanitize(sanitized) as Record<string, unknown>;
}

/**
 * Extract secret requirements from the graph for documentation
 */
function extractRequiredSecrets(
  graph: Record<string, unknown>,
): { name: string; type: string; description?: string }[] {
  const secrets = new Map<string, { type: string; description?: string }>();

  const traverseAndExtract = (obj: unknown, path: string[] = []) => {
    if (typeof obj === 'object' && obj !== null) {
      if (Array.isArray(obj)) {
        obj.forEach((item, idx) => traverseAndExtract(item, [...path, String(idx)]));
        return;
      }

      for (const [key, value] of Object.entries(obj)) {
        if (key === 'secretId' || key === 'secret_name' || key === 'secretName') {
          if (typeof value === 'string') {
            // Infer type from context
            const context = path[path.length - 2] || 'generic';
            const type = context.toLowerCase().includes('api')
              ? 'api_key'
              : context.toLowerCase().includes('token')
                ? 'token'
                : context.toLowerCase().includes('password')
                  ? 'password'
                  : 'generic';
            secrets.set(value, { type, description: `Secret for ${context}` });
          }
        } else if (typeof value === 'object' && value !== null) {
          traverseAndExtract(value, [...path, key]);
        }
      }
    }
  };

  traverseAndExtract(graph);
  return Array.from(secrets.entries()).map(([name, info]) => ({
    name,
    type: info.type,
    description: info.description,
  }));
}

/**
 * Strip viewport from graph to reduce JSON size.
 * Viewport is a UI layout hint and not needed for the template's functionality.
 * Note: Node positions are preserved because WorkflowGraphSchema requires them.
 */
function stripLayoutData(graph: Record<string, unknown>): Record<string, unknown> {
  const stripped = { ...graph };
  delete stripped.viewport;
  return stripped;
}

/**
 * Generate the template JSON structure with metadata
 */
function generateTemplateJson(workflow: WorkflowResponse, metadata: TemplateMetadata): string {
  const sanitizedGraph = sanitizeGraphForTemplate(workflow.graph);
  const compactGraph = stripLayoutData(sanitizedGraph);
  const requiredSecrets = extractRequiredSecrets(workflow.graph);

  const template: TemplateJson = {
    _metadata: metadata,
    graph: compactGraph,
    requiredSecrets,
  };

  return JSON.stringify(template, null, 2);
}

/**
 * Generate GitHub URL for creating a new file.
 * Content is NOT included in the URL to avoid browser URL length limits.
 * Users will paste the template code (copied to clipboard) into the GitHub editor.
 */
function generateGitHubUrl(
  owner: string,
  repo: string,
  branch: string,
  filename: string,
  templateName: string,
): string {
  const baseUrl = `https://github.com/${owner}/${repo}/new/${branch}`;
  const params = new URLSearchParams();
  params.set('filename', filename);
  params.set('message', `Add template: ${templateName}`);
  params.set(
    'value',
    '// Paste your copied template JSON below this line, then delete this comment before creating the PR\n',
  );
  params.set('quick_pull', '1');

  return `${baseUrl}?${params.toString()}`;
}

/**
 * Sanitize filename to be safe for use in URLs
 */
function sanitizeFilename(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') + '.jsonc'
  );
}

export function PublishTemplateModal({
  workflowId,
  workflowName,
  open,
  onOpenChange,
  onSuccess,
}: PublishTemplateModalProps) {
  const [step, setStep] = useState<PublishStep>('configure');
  const [name, setName] = useState(workflowName);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string>('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [author, setAuthor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [generatedTemplateJson, setGeneratedTemplateJson] = useState<string>('');
  const { copy: copyToClipboard, copiedText } = useCopyToClipboard();
  const [hasCopiedOnSubmit, setHasCopiedOnSubmit] = useState(false);
  const [repoUrl, setRepoUrl] = useState(`https://github.com/${DEFAULT_GITHUB_TEMPLATE_REPO}`);
  const [returnedFromGithub, setReturnedFromGithub] = useState(false);
  const focusListenerRef = useRef(false);
  const [existingTemplate, setExistingTemplate] = useState<{ name: string; path: string } | null>(
    null,
  );

  // Check for existing templates that match this workflow
  const { data: templates = [] } = useTemplates();

  useEffect(() => {
    if (open && templates.length > 0 && name.trim()) {
      const normalizedName = name.trim().toLowerCase();
      const match = templates.find(
        (t) => t.name.toLowerCase() === normalizedName || t.path?.includes(sanitizeFilename(name)),
      );
      setExistingTemplate(match ? { name: match.name, path: match.path } : null);
    }
  }, [open, templates, name]);

  // Window focus listener for GitHub return detection
  useEffect(() => {
    if (!focusListenerRef.current) return;

    const handleFocus = () => {
      if (focusListenerRef.current) {
        setReturnedFromGithub(true);
        focusListenerRef.current = false;
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [step]);

  // Clean up focus listener on unmount or modal close
  useEffect(() => {
    if (!open) {
      focusListenerRef.current = false;
    }
  }, [open]);

  const handleConfigure = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      if (!name.trim()) {
        setError('Please enter a template name');
        return;
      }
      if (!category) {
        setError('Please select a category');
        return;
      }
      if (!author.trim()) {
        setError('Please enter your name or organization');
        return;
      }

      // Move to review step — generate template JSON preview
      setIsLoading(true);
      (async () => {
        try {
          const headers = await getApiAuthHeaders();
          const response = await fetch(`${API_BASE_URL}/api/v1/workflows/${workflowId}`, {
            headers,
          });
          if (!response.ok) {
            throw new Error('Failed to fetch workflow data');
          }

          const workflow: WorkflowResponse = await response.json();

          const metadata: TemplateMetadata = {
            name: name.trim(),
            description: description.trim() || undefined,
            category: category || '',
            tags,
            author: author.trim(),
            version: '1.0.0',
          };

          const templateJson = generateTemplateJson(workflow, metadata);
          setGeneratedTemplateJson(templateJson);
          setStep('review');
        } catch (err: unknown) {
          setError(
            err instanceof Error ? err.message : 'Failed to prepare template for publishing',
          );
        } finally {
          setIsLoading(false);
        }
      })();
    },
    [workflowId, name, description, category, tags, author],
  );

  const handlePublish = useCallback(async () => {
    setError(null);
    setIsLoading(true);

    try {
      const filename = `templates/${sanitizeFilename(name.trim())}`;

      // Copy template code to clipboard
      const copied = await copyToClipboard(generatedTemplateJson, { showToast: false });
      if (copied) setHasCopiedOnSubmit(true);

      // Fetch repo config from backend, fall back to defaults
      let owner: string;
      let repo: string;
      let branch: string;
      try {
        const repoInfoRes = await fetch(`${API_BASE_URL}/api/v1/templates/repo-info`);
        if (repoInfoRes.ok) {
          const repoInfo = await repoInfoRes.json();
          owner = repoInfo.owner;
          repo = repoInfo.repo;
          branch = repoInfo.branch;
        } else {
          [owner, repo] = DEFAULT_GITHUB_TEMPLATE_REPO.split('/');
          branch = DEFAULT_GITHUB_BRANCH;
        }
      } catch {
        [owner, repo] = DEFAULT_GITHUB_TEMPLATE_REPO.split('/');
        branch = DEFAULT_GITHUB_BRANCH;
      }

      setRepoUrl(`https://github.com/${owner}/${repo}`);

      // Generate GitHub URL without content (avoids long URL errors)
      const githubUrl = generateGitHubUrl(owner, repo, branch, filename, name.trim());

      // Activate focus listener before opening new tab
      focusListenerRef.current = true;
      setReturnedFromGithub(false);

      // Open the GitHub URL in a new tab
      window.open(githubUrl, '_blank', 'noopener,noreferrer');

      // Move to publish step (awaiting user return)
      setStep('publish');
      onSuccess?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to prepare template for publishing');
    } finally {
      setIsLoading(false);
    }
  }, [name, generatedTemplateJson, copyToClipboard, onSuccess]);

  const handleAddTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
    }
    setTagInput('');
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((tag) => tag !== tagToRemove));
  };

  const handleAddCommonTag = (tag: string) => {
    if (!tags.includes(tag)) {
      setTags([...tags, tag]);
    }
  };

  const handleClose = () => {
    if (!isLoading) {
      onOpenChange(false);
      // Reset form after a delay to avoid visual glitch
      setTimeout(() => {
        setStep('configure');
        setName(workflowName);
        setDescription('');
        setCategory('');
        setTags([]);
        setAuthor('');
        setError(null);
        setHasCopiedOnSubmit(false);
        setGeneratedTemplateJson('');
        setRepoUrl(`https://github.com/${DEFAULT_GITHUB_TEMPLATE_REPO}`);
        setReturnedFromGithub(false);
        setExistingTemplate(null);
        focusListenerRef.current = false;
      }, 200);
    }
  };

  const handleCheckPrStatus = () => {
    const prSearchUrl = `${repoUrl}/pulls?q=is%3Apr+author%3A%40me+is%3Aopen`;
    window.open(prSearchUrl, '_blank', 'noopener,noreferrer');
  };

  const handleConfirmDone = () => {
    setStep('done');
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitPullRequest className="h-5 w-5" />
            {existingTemplate ? 'Update Template' : 'Publish as Template'}
          </DialogTitle>
          <DialogDescription>
            {existingTemplate
              ? 'Update your existing template via a GitHub pull request.'
              : 'Submit your workflow as a template via a GitHub pull request.'}
          </DialogDescription>
        </DialogHeader>

        <StepIndicator currentStep={step} />

        {/* Existing template notice */}
        {existingTemplate && step === 'configure' && (
          <div className="flex items-start gap-2 p-3 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
            <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
            <p className="text-sm text-blue-700 dark:text-blue-300">
              This workflow was previously published as &ldquo;{existingTemplate.name}&rdquo;.
              Publishing again will create a new PR to update it.
            </p>
          </div>
        )}

        {step === 'done' ? (
          /* Done State */
          <div className="py-6">
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="h-12 w-12 rounded-full bg-success/10 flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-success" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Template Submitted!</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Your template has been submitted for review. You&apos;ll be notified once
                  it&apos;s approved and added to the library.
                </p>
              </div>

              <div className="flex gap-2 w-full">
                <Button variant="outline" className="flex-1 gap-2" onClick={handleCheckPrStatus}>
                  <Search className="h-4 w-4" />
                  Check PR Status
                </Button>
                <Button className="flex-1" onClick={handleClose}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        ) : step === 'publish' ? (
          /* Publish / Awaiting GitHub Step */
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
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => setReturnedFromGithub(false)}
                    >
                      Not yet
                    </Button>
                    <Button className="flex-1 gap-2" onClick={handleConfirmDone}>
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
                      A GitHub editor has opened in a new tab. Paste the template code there to
                      propose your changes.
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
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={async () => {
                  await copyToClipboard(generatedTemplateJson, { showToast: false });
                }}
              >
                {copiedText !== null ? (
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
                  onCopy={async () => {
                    await copyToClipboard(generatedTemplateJson, { showToast: false });
                  }}
                  isCopied={copiedText !== null}
                />
              </div>

              <div className="w-full p-3 rounded-lg bg-muted/50 space-y-3 text-sm">
                <p className="text-left">
                  <strong>Instructions:</strong>
                </p>
                <ol className="text-left list-decimal list-inside space-y-2 text-muted-foreground">
                  <li>
                    <strong>Replace</strong> the placeholder comment in the GitHub editor with the
                    copied template code
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
                  <strong>Note:</strong> Creating a PR allows reviewers to check your template
                  before it&apos;s added to the library.
                </div>
              </div>

              {!returnedFromGithub && (
                <div className="flex gap-2 w-full">
                  <Button variant="outline" className="flex-1 gap-2" onClick={handleCheckPrStatus}>
                    <Search className="h-4 w-4" />
                    Check PR Status
                  </Button>
                  <Button className="flex-1 gap-2" onClick={handleConfirmDone}>
                    <Check className="h-4 w-4" />
                    I&apos;ve Created the PR
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : step === 'review' ? (
          /* Review Step */
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
              onCopy={async () => {
                await copyToClipboard(generatedTemplateJson, { showToast: false });
              }}
              isCopied={copiedText !== null}
            />

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/50">
                <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep('configure')}
                disabled={isLoading}
              >
                Back
              </Button>
              <Button onClick={handlePublish} disabled={isLoading} className="gap-2">
                {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                <ExternalLink className="h-4 w-4" />
                Copy &amp; Open GitHub
              </Button>
            </DialogFooter>
          </div>
        ) : (
          /* Configure Form */
          <form onSubmit={handleConfigure} className="space-y-4">
            {/* Template Name */}
            <div className="space-y-2">
              <Label htmlFor="template-name">Template Name *</Label>
              <Input
                id="template-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Security Template"
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what this template does..."
                rows={3}
              />
            </div>

            {/* Category */}
            <div className="space-y-2">
              <Label htmlFor="category">Category *</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="category">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat.toLowerCase()}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Tags */}
            <div className="space-y-2">
              <Label>Tags</Label>
              <div className="flex gap-2">
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddTag();
                    }
                  }}
                  placeholder="Add a tag..."
                />
                <Button type="button" variant="outline" onClick={handleAddTag}>
                  Add
                </Button>
              </div>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="gap-1">
                      {tag}
                      <X className="h-3 w-3 cursor-pointer" onClick={() => handleRemoveTag(tag)} />
                    </Badge>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-1 mt-2">
                {COMMON_TAGS.slice(0, 8).map((tag) => (
                  <Badge
                    key={tag}
                    variant="outline"
                    className={cn(
                      'cursor-pointer',
                      tags.includes(tag) && 'bg-primary text-primary-foreground',
                    )}
                    onClick={() => handleAddCommonTag(tag)}
                  >
                    + {tag}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Author */}
            <div className="space-y-2">
              <Label htmlFor="author">Author / Organization *</Label>
              <Input
                id="author"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="Your name or organization"
              />
            </div>

            {/* Info Box */}
            <div className="p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground">
              <p>
                <strong>Note:</strong> Your workflow will be sanitized before publishing. All secret
                references will be removed and replaced with placeholders. Clicking
                &ldquo;Next&rdquo; will generate a preview for your review.
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/50">
                <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose} disabled={isLoading}>
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading} className="gap-2">
                {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                Next: Review
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
