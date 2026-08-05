import {
  LLM_PROVIDER_CATALOG,
  LLM_PROVIDER_IDS,
  type LlmModelProvider,
  type OperatorSessionDetail,
} from '@sentris/shared';
import {
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Cpu,
  Globe2,
  KeyRound,
  Loader2,
  Network,
  Search,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useToast } from '@/components/ui/use-toast';
import { useUpdateOperatorSession } from '@/hooks/queries/useOperatorQueries';
import { cn } from '@/lib/utils';
import { OperatorModelForm } from './OperatorModelForm';
import {
  changeOperatorModelProvider,
  draftToModelConfig,
  modelConfigToDraft,
  type OperatorModelDraft,
} from './operatorModelDraft';

const PROVIDER_PRESENTATION: Record<
  LlmModelProvider,
  { icon: LucideIcon; tone: string; surface: string }
> = {
  anthropic: {
    icon: Bot,
    tone: 'text-orange-400',
    surface: 'border-orange-500/20 bg-orange-500/10',
  },
  openai: {
    icon: CircleDot,
    tone: 'text-zinc-300',
    surface: 'border-zinc-400/20 bg-zinc-400/10',
  },
  gemini: {
    icon: Sparkles,
    tone: 'text-blue-400',
    surface: 'border-blue-500/20 bg-blue-500/10',
  },
  openrouter: {
    icon: Network,
    tone: 'text-violet-400',
    surface: 'border-violet-500/20 bg-violet-500/10',
  },
  'zai-coding-plan': {
    icon: Cpu,
    tone: 'text-cyan-400',
    surface: 'border-cyan-500/20 bg-cyan-500/10',
  },
};

interface ModelPointer {
  provider: LlmModelProvider;
  modelId: string;
}

function selectedModelLabel(provider: LlmModelProvider, modelId: string): string {
  return (
    LLM_PROVIDER_CATALOG[provider].models.find((model) => model.value === modelId)?.label ?? modelId
  );
}

export function OperatorSessionModelPicker({ session }: { session: OperatorSessionDetail }) {
  const { toast } = useToast();
  const updateSession = useUpdateOperatorSession();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeProvider, setActiveProvider] = useState<LlmModelProvider | null>(null);
  const [model, setModel] = useState<OperatorModelDraft>(() => modelConfigToDraft(session.model));
  const [preview, setPreview] = useState<ModelPointer>({
    provider: session.model.provider,
    modelId: session.model.modelId,
  });
  const modelConfig = draftToModelConfig(model);
  const isDirty = modelConfig
    ? JSON.stringify(modelConfig) !== JSON.stringify(session.model)
    : false;
  const sessionPresentation = PROVIDER_PRESENTATION[session.model.provider];
  const SessionProviderIcon = sessionPresentation.icon;
  const normalizedQuery = query.trim().toLowerCase();
  const searching = normalizedQuery.length > 0;

  const visibleModels = useMemo(
    () =>
      LLM_PROVIDER_IDS.flatMap((provider) =>
        LLM_PROVIDER_CATALOG[provider].models.map((candidate) => ({ provider, ...candidate })),
      ).filter((candidate) => {
        if (!searching && activeProvider) return candidate.provider === activeProvider;
        if (!searching) return false;
        return `${candidate.label} ${candidate.value} ${LLM_PROVIDER_CATALOG[candidate.provider].label}`
          .toLowerCase()
          .includes(normalizedQuery);
      }),
    [activeProvider, normalizedQuery, searching],
  );

  const previewProvider = LLM_PROVIDER_CATALOG[preview.provider];
  const previewModel =
    previewProvider.models.find((candidate) => candidate.value === preview.modelId) ??
    previewProvider.models[0];
  const previewPresentation = PROVIDER_PRESENTATION[preview.provider];
  const PreviewProviderIcon = previewPresentation.icon;
  const previewIsSelected =
    model.provider === preview.provider && model.modelId === previewModel.value;
  const previewIsRecommended = previewProvider.recommendedModelId === previewModel.value;

  const resetDraft = () => {
    setModel(modelConfigToDraft(session.model));
    setQuery('');
    setActiveProvider(null);
    setPreview({ provider: session.model.provider, modelId: session.model.modelId });
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && !updateSession.isPending) resetDraft();
    setOpen(next);
  };

  const openProvider = (provider: LlmModelProvider) => {
    const firstModel = LLM_PROVIDER_CATALOG[provider].models[0];
    setActiveProvider(provider);
    setPreview({ provider, modelId: firstModel.value });
  };

  const selectModel = (provider: LlmModelProvider, modelId: string) => {
    const providerDraft =
      model.provider === provider ? model : changeOperatorModelProvider(model, provider);
    setModel({ ...providerDraft, modelId });
    setPreview({ provider, modelId });
  };

  const save = async () => {
    if (!modelConfig || !isDirty) return;
    try {
      await updateSession.mutateAsync({ sessionId: session.id, input: { model: modelConfig } });
      setOpen(false);
      toast({ title: 'Operator model updated' });
    } catch (error) {
      toast({
        title: 'Could not update model',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-7 max-w-48 items-center gap-1.5 rounded-full px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"
          aria-label={`Choose Operator model. Current model: ${selectedModelLabel(session.model.provider, session.model.modelId)}`}
        >
          <SessionProviderIcon
            className={cn('h-3.5 w-3.5 shrink-0', sessionPresentation.tone)}
            aria-hidden="true"
          />
          <span className="truncate">
            {selectedModelLabel(session.model.provider, session.model.modelId)}
          </span>
          <ChevronRight className="h-3 w-3 shrink-0 rotate-90" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={10}
        collisionPadding={12}
        className="max-h-[min(660px,calc(100dvh-7rem))] w-[min(680px,calc(100vw-2rem))] overflow-y-auto rounded-2xl border-border/80 bg-popover/98 p-0 shadow-[0_24px_80px_rgba(0,0,0,0.58)] backdrop-blur-xl"
      >
        <div className="grid min-h-[340px] sm:grid-cols-[248px_minmax(0,1fr)]">
          <section className="border-b border-border/60 sm:border-b-0 sm:border-r">
            <div className="flex h-12 items-center gap-2 border-b border-border/60 px-3">
              {activeProvider && !searching ? (
                <button
                  type="button"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  aria-label="Back to model providers"
                  onClick={() => setActiveProvider(null)}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
              ) : null}
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search models…"
                aria-label="Search Operator models"
                className="h-8 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
              />
            </div>

            <div className="space-y-1 p-2">
              {!activeProvider && !searching
                ? LLM_PROVIDER_IDS.map((provider) => {
                    const catalog = LLM_PROVIDER_CATALOG[provider];
                    const presentation = PROVIDER_PRESENTATION[provider];
                    const ProviderIcon = presentation.icon;
                    return (
                      <button
                        key={provider}
                        type="button"
                        className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-muted/55"
                        onClick={() => openProvider(provider)}
                      >
                        <span
                          className={cn(
                            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
                            presentation.surface,
                            presentation.tone,
                          )}
                        >
                          <ProviderIcon className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium text-foreground">
                            {catalog.label}
                          </span>
                          <span className="block text-[10px] text-muted-foreground">
                            {catalog.models.length}{' '}
                            {catalog.models.length === 1 ? 'model' : 'models'}
                          </span>
                        </span>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    );
                  })
                : visibleModels.map((candidate) => {
                    const presentation = PROVIDER_PRESENTATION[candidate.provider];
                    const ProviderIcon = presentation.icon;
                    const selected =
                      model.provider === candidate.provider && model.modelId === candidate.value;
                    return (
                      <button
                        key={`${candidate.provider}:${candidate.value}`}
                        type="button"
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors',
                          selected
                            ? 'border-foreground/15 bg-muted/60'
                            : 'border-transparent hover:bg-muted/45',
                        )}
                        onMouseEnter={() =>
                          setPreview({ provider: candidate.provider, modelId: candidate.value })
                        }
                        onFocus={() =>
                          setPreview({ provider: candidate.provider, modelId: candidate.value })
                        }
                        onClick={() => selectModel(candidate.provider, candidate.value)}
                      >
                        <ProviderIcon
                          className={cn('h-4 w-4 shrink-0', presentation.tone)}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium text-foreground">
                            {candidate.label}
                          </span>
                          {searching ? (
                            <span className="block truncate text-[10px] text-muted-foreground">
                              {LLM_PROVIDER_CATALOG[candidate.provider].label}
                            </span>
                          ) : null}
                        </span>
                        {selected ? (
                          <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        ) : null}
                      </button>
                    );
                  })}
              {(activeProvider || searching) && visibleModels.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No models match “{query}”.
                </p>
              ) : null}
            </div>
          </section>

          <section className="flex min-w-0 flex-col bg-muted/[0.12]">
            <div className="flex-1 p-4">
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border',
                    previewPresentation.surface,
                    previewPresentation.tone,
                  )}
                >
                  <PreviewProviderIcon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h3 className="truncate text-sm font-semibold text-foreground">
                      {previewModel.label}
                    </h3>
                    {previewIsSelected ? (
                      <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-400">
                        Selected
                      </span>
                    ) : null}
                    {previewIsRecommended ? (
                      <span className="rounded-full border border-blue-500/25 bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-blue-400">
                        Recommended
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {previewProvider.label}
                  </p>
                </div>
              </div>

              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                Use this provider model for future turns in this Operator chat. Existing turns keep
                the model snapshot they started with.
              </p>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-border/60 bg-background/55 p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Model ID
                  </p>
                  <p
                    className="mt-1 truncate font-mono text-[11px] text-foreground"
                    title={previewModel.value}
                  >
                    {previewModel.value}
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/55 p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Provider catalog
                  </p>
                  <p className="mt-1 text-[11px] text-foreground">
                    {previewProvider.models.length} available{' '}
                    {previewProvider.models.length === 1 ? 'model' : 'models'}
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/55 p-3">
                  <p className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <KeyRound className="h-3 w-3" /> Credential
                  </p>
                  <p
                    className={cn(
                      'mt-1 text-[11px]',
                      model.apiKeySecretId ? 'text-emerald-400' : 'text-amber-400',
                    )}
                  >
                    {model.apiKeySecretId ? 'Stored credential ready' : 'Credential required'}
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/55 p-3">
                  <p className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <Globe2 className="h-3 w-3" /> Endpoint
                  </p>
                  <p className="mt-1 text-[11px] text-foreground">
                    {model.baseUrl.trim() ? 'Custom endpoint' : 'Provider default'}
                  </p>
                </div>
              </div>

              <details className="group mt-4 rounded-xl border border-border/60 bg-background/45 px-3 py-2.5">
                <summary className="cursor-pointer list-none text-xs font-medium text-foreground">
                  Connection settings
                  <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                    credential and endpoint
                  </span>
                </summary>
                <div className="mt-3 border-t border-border/50 pt-3">
                  <OperatorModelForm
                    value={model}
                    onChange={setModel}
                    disabled={updateSession.isPending}
                    compact
                    showModelSelectors={false}
                  />
                </div>
              </details>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-3">
              <p className="text-[10px] text-muted-foreground">
                {isDirty ? 'Unsaved model change' : 'Current chat configuration'}
              </p>
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-full px-4 text-xs"
                onClick={() => void save()}
                disabled={!modelConfig || !isDirty || updateSession.isPending}
              >
                {updateSession.isPending ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : null}
                Save model
              </Button>
            </div>
          </section>
        </div>
      </PopoverContent>
    </Popover>
  );
}
