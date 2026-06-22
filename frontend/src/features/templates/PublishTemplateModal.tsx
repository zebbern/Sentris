import { useState, useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import {
  templateRepoInfoQueryOptions,
  usePublishTemplate,
  useTemplates,
} from '@/hooks/queries/useTemplateQueries';
import { queryKeys } from '@/lib/queryKeys';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { GitPullRequest, Info } from 'lucide-react';
import { api } from '@/services/api';
import {
  DEFAULT_GITHUB_TEMPLATE_REPO,
  DEFAULT_GITHUB_BRANCH,
  type PublishTemplateModalProps,
  type PublishStep,
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
  const { mutateAsync: publishTemplate } = usePublishTemplate();
  const queryClient = useQueryClient();

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
          const workflow = await queryClient.fetchQuery({
            queryKey: queryKeys.workflows.detail(workflowId),
            queryFn: () => api.workflows.get(workflowId),
            staleTime: 60_000,
          });

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
    [workflowId, name, description, category, tags, author, queryClient],
  );

  const handlePublish = useCallback(async () => {
    setError(null);
    setIsLoading(true);

    try {
      const publishResult = await publishTemplate({
        workflowId,
        name: name.trim(),
        description: description.trim(),
        category,
        tags,
        author: author.trim(),
      });
      const acceptedTemplateJson = buildAcceptedTemplateJson({
        name: name.trim(),
        description: description.trim(),
        category,
        tags,
        author: author.trim(),
        manifest: publishResult.manifest,
        graph: publishResult.graph,
        requiredSecrets: publishResult.requiredSecrets,
      });
      setGeneratedTemplateJson(acceptedTemplateJson);
      const filename = `templates/${sanitizeFilename(name.trim())}`;
      const copied = await copyToClipboard(acceptedTemplateJson, { showToast: false });
      if (copied) setHasCopiedOnSubmit(true);
      let owner: string;
      let repo: string;
      let branch: string;
      try {
        const repoInfo = await queryClient.fetchQuery(templateRepoInfoQueryOptions());
        owner = repoInfo.owner;
        repo = repoInfo.repo;
        branch = repoInfo.branch;
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
  }, [
    workflowId,
    name,
    description,
    category,
    tags,
    author,
    copyToClipboard,
    onSuccess,
    publishTemplate,
    queryClient,
  ]);

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

function buildAcceptedTemplateJson(params: {
  name: string;
  description: string;
  category: string;
  tags: string[];
  author: string;
  manifest: Record<string, unknown>;
  graph: Record<string, unknown>;
  requiredSecrets: { name: string; type: string; description?: string; placeholder?: string }[];
}): string {
  const metadata: TemplateMetadata = {
    name: params.name,
    category: params.category,
    tags: params.tags,
    author: params.author,
    version: '1.0.0',
  };

  if (params.description) {
    metadata.description = params.description;
  }

  return JSON.stringify(
    {
      _metadata: metadata,
      manifest: params.manifest,
      graph: params.graph,
      requiredSecrets: params.requiredSecrets,
    },
    null,
    2,
  );
}
