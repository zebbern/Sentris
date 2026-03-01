import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  useWebhook,
  useWebhookDeliveries,
  useCreateWebhook,
  useUpdateWebhook,
  useDeleteWebhook,
  useTestWebhookScript,
} from '@/hooks/queries/useWebhookQueries';
import { useWorkflowsSummary, useWorkflowRuntimeInputs } from '@/hooks/queries/useWorkflowQueries';
import { useToast } from '@/components/ui/use-toast';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import type {
  WebhookConfiguration,
  WebhookInputDefinition,
  WebhookDelivery,
} from '@sentris/shared';
import { loader } from '@monaco-editor/react';
import type {
  WebhookFormState,
  WorkflowOption,
  RuntimeInput,
  WebhookTestResult,
} from './webhookEditorTypes';
import { DEFAULT_PARSING_SCRIPT } from './webhookEditorTypes';

// Configure Monaco
loader.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs' } });

export function useWebhookEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const isNew = !id || id === 'new';
  useDocumentTitle(isNew ? 'New Webhook' : 'Edit Webhook');
  const { confirm, dialogProps } = useConfirmDialog();
  const queryClient = useQueryClient();

  // Get returnTo state for back button (if navigated from workflow webhooks sidebar)
  const navigationState = location.state as {
    returnTo?: { path: string; openWebhooksSidebar?: boolean };
  } | null;
  const returnToPath = navigationState?.returnTo?.path;
  const openWebhooksSidebarOnReturn = navigationState?.returnTo?.openWebhooksSidebar;

  // Derive active tab from URL
  const activeTab = useMemo(() => {
    if (location.pathname.endsWith('/deliveries')) return 'deliveries';
    if (location.pathname.endsWith('/settings')) return 'settings';
    return 'editor';
  }, [location.pathname]);

  const navigateToTab = useCallback(
    (tab: string) => {
      if (isNew) return;
      const basePath = `/webhooks/${id}`;
      if (tab === 'editor') {
        navigate(basePath);
      } else {
        navigate(`${basePath}/${tab}`);
      }
    },
    [isNew, id, navigate],
  );

  // --- Mutation hooks ---
  const createWebhook = useCreateWebhook();
  const updateWebhook = useUpdateWebhook();
  const deleteWebhook = useDeleteWebhook();
  const testScriptMutation = useTestWebhookScript();

  const isSaving = createWebhook.isPending || updateWebhook.isPending;

  // --- Query hooks for server data ---
  const {
    data: webhookData,
    isLoading: isLoadingWebhook,
    error: webhookError,
  } = useWebhook(isNew ? undefined : id);
  const webhook = (webhookData as WebhookConfiguration) ?? null;
  const { data: rawWorkflows = [] } = useWorkflowsSummary();
  const workflows: WorkflowOption[] = useMemo(
    () => rawWorkflows.map((w) => ({ id: w.id, name: w.name })),
    [rawWorkflows],
  );

  // Form State
  const [form, setForm] = useState<WebhookFormState>({
    workflowId: '',
    name: 'New Webhook',
    description: '',
    parsingScript: DEFAULT_PARSING_SCRIPT,
    expectedInputs: [],
  });

  const [initialForm, setInitialForm] = useState<WebhookFormState | null>(
    isNew
      ? {
          workflowId: '',
          name: 'New Webhook',
          description: '',
          parsingScript: DEFAULT_PARSING_SCRIPT,
          expectedInputs: [],
        }
      : null,
  );

  // Sync webhook query data → form state (once, on initial load)
  const formInitializedRef = useRef(false);
  useEffect(() => {
    if (isNew || formInitializedRef.current || !webhook) return;
    formInitializedRef.current = true;
    const loadedForm = {
      workflowId: webhook.workflowId,
      name: webhook.name,
      description: webhook.description || '',
      parsingScript: webhook.parsingScript,
      expectedInputs: webhook.expectedInputs,
    };
    setForm(loadedForm);
    setInitialForm(loadedForm);
  }, [isNew, webhook]);

  // Handle webhook load error — navigate away
  useEffect(() => {
    if (webhookError && !isNew) {
      const errorMessage = String(webhookError);
      const isNotFound = errorMessage.includes('not found') || errorMessage.includes('404');
      toast({
        title: isNotFound ? 'Webhook not found' : 'Error loading webhook',
        description: isNotFound
          ? 'This webhook may have been deleted or the URL is invalid.'
          : errorMessage,
        variant: 'destructive',
      });
      navigate('/webhooks');
    }
  }, [webhookError, isNew, navigate, toast]);

  const isLoading = !isNew && isLoadingWebhook;

  const isDirty = useMemo(() => {
    if (!initialForm) return false;
    try {
      return JSON.stringify(form) !== JSON.stringify(initialForm);
    } catch (_e: unknown) {
      return true;
    }
  }, [form, initialForm]);

  // Test State
  const [testPayload, setTestPayload] = useState('{\n  "message": "Hello World"\n}');
  const [testHeaders, setTestHeaders] = useState('{\n  "content-type": "application/json"\n}');
  const isTesting = testScriptMutation.isPending;
  const testResult: WebhookTestResult | null =
    testScriptMutation.data ??
    (testScriptMutation.error ? { error: String(testScriptMutation.error) } : null);

  // --- Runtime inputs query (reactive to form.workflowId) ---
  const { data: runtimeInputsData } = useWorkflowRuntimeInputs(form.workflowId || undefined);
  const workflowRuntimeInputs: RuntimeInput[] = useMemo(
    () => runtimeInputsData?.inputs || [],
    [runtimeInputsData],
  );

  // Sync runtime inputs → expectedInputs in form
  useEffect(() => {
    if (!form.workflowId) return;
    if (workflowRuntimeInputs.length === 0) return;
    const mappedInputs: WebhookInputDefinition[] = workflowRuntimeInputs.map((input) => {
      const VALID_TYPES = new Set<WebhookInputDefinition['type']>([
        'text',
        'number',
        'json',
        'array',
        'file',
      ]);
      const resolvedType: WebhookInputDefinition['type'] =
        input.type === 'string'
          ? 'text'
          : VALID_TYPES.has(input.type as WebhookInputDefinition['type'])
            ? (input.type as WebhookInputDefinition['type'])
            : 'text';
      return {
        id: input.id,
        label: input.label || input.id,
        type: resolvedType,
        required: input.required !== false,
        description: input.description || '',
      };
    });
    setForm((prev) => ({ ...prev, expectedInputs: mappedInputs }));
  }, [form.workflowId, workflowRuntimeInputs]);

  // --- Deliveries query ---
  const { data: deliveries = [] as WebhookDelivery[], isLoading: isLoadingDeliveries } =
    useWebhookDeliveries(isNew ? undefined : id);

  const handleSave = useCallback(async () => {
    if (!form.workflowId) {
      toast({
        title: 'Validation error',
        description: 'Please select a workflow before saving.',
        variant: 'destructive',
      });
      return;
    }

    try {
      const payload = {
        ...form,
        expectedInputs: form.expectedInputs,
      };

      if (isNew) {
        const created = await createWebhook.mutateAsync(payload);
        toast({
          title: 'Webhook created',
          description: 'Your webhook is now active and listening for events.',
        });
        setInitialForm(payload);
        navigate(`/webhooks/${(created as WebhookConfiguration).id}`, { replace: true });
      } else {
        await updateWebhook.mutateAsync({ id: id!, payload });
        setInitialForm(payload);
        toast({
          title: 'Webhook saved',
          description: 'Webhook configuration updated.',
        });
      }
    } catch (error: unknown) {
      toast({
        title: 'Save failed',
        description: String(error),
        variant: 'destructive',
      });
    }
  }, [form, isNew, id, createWebhook, updateWebhook, navigate, toast]);

  // Keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        const canSave = (isDirty || isNew) && !isSaving;
        if (canSave) {
          handleSave();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, isDirty, isNew, isSaving]);

  const handleTest = useCallback(async () => {
    testScriptMutation.reset();
    try {
      const payloadObj = JSON.parse(testPayload);
      const headersObj = JSON.parse(testHeaders);

      await testScriptMutation.mutateAsync({
        parsingScript: form.parsingScript,
        testPayload: payloadObj,
        testHeaders: headersObj,
      });
    } catch {
      // Error is captured in testScriptMutation.error and displayed via testResult
    }
  }, [testScriptMutation, testPayload, testHeaders, form.parsingScript]);

  const handleDelete = useCallback(async () => {
    const ok = await confirm({
      title: 'Delete webhook',
      description: 'Are you sure you want to delete this webhook?',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await queryClient.cancelQueries({ queryKey: queryKeys.webhooks.detail(id!) });
      await deleteWebhook.mutateAsync(id!);
      queryClient.removeQueries({ queryKey: queryKeys.webhooks.detail(id!) });
      navigate('/webhooks');
    } catch (error: unknown) {
      toast({
        title: 'Delete failed',
        description: String(error),
        variant: 'destructive',
      });
    }
  }, [confirm, queryClient, id, deleteWebhook, navigate, toast]);

  const handleBack = useCallback(() => {
    if (returnToPath) {
      const url = openWebhooksSidebarOnReturn
        ? `${returnToPath}?openWebhooksSidebar=true`
        : returnToPath;
      navigate(url);
    } else {
      navigate('/webhooks');
    }
  }, [returnToPath, openWebhooksSidebarOnReturn, navigate]);

  return {
    // Route state
    isNew,
    isLoading,
    activeTab,
    navigateToTab,

    // Form state
    form,
    setForm,
    isDirty,
    isSaving,

    // Server data
    webhook,
    workflows,
    workflowRuntimeInputs,

    // Test state
    testPayload,
    setTestPayload,
    testHeaders,
    setTestHeaders,
    isTesting,
    testResult,

    // Deliveries
    deliveries,
    isLoadingDeliveries,

    // Actions
    handleSave,
    handleDelete,
    handleTest,
    handleBack,

    // Navigation
    navigate,

    // Dialog
    dialogProps,

    // Toast
    toast,
  };
}
