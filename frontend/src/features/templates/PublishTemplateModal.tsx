import { useState, useCallback, useEffect, useRef } from 'react';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { useTemplates } from '@/hooks/queries/useTemplateQueries';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { GitPullRequest, Info } from 'lucide-react';
import { API_BASE_URL, getApiAuthHeaders } from '@/services/api';
import {
  DEFAULT_GITHUB_TEMPLATE_REPO,
  DEFAULT_GITHUB_BRANCH,
  type PublishTemplateModalProps,
  type PublishStep,
  type WorkflowResponse,
  type TemplateMetadata,
} from './publish-template-types';
import {
  generateTemplateJson,
  generateGitHubUrl,
  sanitizeFilename,
} from './publish-template-utils';
import { StepIndicator } from './StepIndicator';
import { DoneStep } from './DoneStep';
import { PublishStepView } from './PublishStep';
import { ReviewStep } from './ReviewStep';
import { ConfigureStepForm } from './ConfigureStepForm';

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
      const copied = await copyToClipboard(generatedTemplateJson, { showToast: false });
      if (copied) setHasCopiedOnSubmit(true);
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
      const githubUrl = generateGitHubUrl(owner, repo, branch, filename, name.trim());
      focusListenerRef.current = true;
      setReturnedFromGithub(false);
      window.open(githubUrl, '_blank', 'noopener,noreferrer');
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
    if (tag && !tags.includes(tag)) setTags([...tags, tag]);
    setTagInput('');
  };
  const handleRemoveTag = (tagToRemove: string) => setTags(tags.filter((t) => t !== tagToRemove));
  const handleAddCommonTag = (tag: string) => {
    if (!tags.includes(tag)) setTags([...tags, tag]);
  };

  const handleClose = () => {
    if (isLoading) return;
    onOpenChange(false);
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
  };

  const handleCheckPrStatus = () =>
    window.open(
      `${repoUrl}/pulls?q=is%3Apr+author%3A%40me+is%3Aopen`,
      '_blank',
      'noopener,noreferrer',
    );
  const handleConfirmDone = () => setStep('done');

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
          <DoneStep onCheckPrStatus={handleCheckPrStatus} onClose={handleClose} />
        ) : step === 'publish' ? (
          <PublishStepView
            returnedFromGithub={returnedFromGithub}
            hasCopiedOnSubmit={hasCopiedOnSubmit}
            generatedTemplateJson={generatedTemplateJson}
            isCopied={copiedText !== null}
            onCopyToClipboard={async () => {
              await copyToClipboard(generatedTemplateJson, { showToast: false });
            }}
            onCheckPrStatus={handleCheckPrStatus}
            onConfirmDone={handleConfirmDone}
            onResetReturn={() => setReturnedFromGithub(false)}
          />
        ) : step === 'review' ? (
          <ReviewStep
            name={name}
            description={description}
            category={category}
            author={author}
            tags={tags}
            generatedTemplateJson={generatedTemplateJson}
            error={error}
            isLoading={isLoading}
            isCopied={copiedText !== null}
            onBack={() => setStep('configure')}
            onPublish={handlePublish}
            onCopyJson={async () => {
              await copyToClipboard(generatedTemplateJson, { showToast: false });
            }}
          />
        ) : (
          <ConfigureStepForm
            name={name}
            onNameChange={setName}
            description={description}
            onDescriptionChange={setDescription}
            category={category}
            onCategoryChange={setCategory}
            tags={tags}
            tagInput={tagInput}
            onTagInputChange={setTagInput}
            onAddTag={handleAddTag}
            onRemoveTag={handleRemoveTag}
            onAddCommonTag={handleAddCommonTag}
            author={author}
            onAuthorChange={setAuthor}
            error={error}
            isLoading={isLoading}
            onSubmit={handleConfigure}
            onClose={handleClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
