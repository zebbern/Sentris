import { Code, History as LucideHistory, Settings } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import {
  useWebhookEditor,
  WebhookEditorHeader,
  WebhookFormSection,
  WebhookTestingPanel,
  WebhookDeliveryLog,
  WebhookSettingsTab,
} from './webhook-editor';

export function WebhookEditorPage() {
  const {
    isNew,
    isLoading,
    activeTab,
    navigateToTab,
    form,
    setForm,
    isDirty,
    isSaving,
    webhook,
    workflows,
    workflowRuntimeInputs,
    testPayload,
    setTestPayload,
    testHeaders,
    setTestHeaders,
    isTesting,
    testResult,
    deliveries,
    isLoadingDeliveries,
    handleSave,
    handleDelete,
    handleTest,
    handleBack,
    navigate,
    dialogProps,
  } = useWebhookEditor();
  const { copy } = useCopyToClipboard();

  if (isLoading) {
    return (
      <div className="flex flex-col h-full bg-background overflow-hidden">
        {/* Header skeleton */}
        <div className="flex items-center gap-3 px-6 py-4 border-b">
          <Skeleton className="h-8 w-8 rounded" />
          <Skeleton className="h-6 w-48" />
          <div className="ml-auto flex gap-2">
            <Skeleton className="h-9 w-20 rounded-md" />
            <Skeleton className="h-9 w-24 rounded-md" />
          </div>
        </div>
        {/* Tabs skeleton */}
        <div className="px-6 py-2 border-b bg-muted/40">
          <div className="flex gap-2">
            <Skeleton className="h-8 w-28 rounded-md" />
            <Skeleton className="h-8 w-24 rounded-md" />
            <Skeleton className="h-8 w-24 rounded-md" />
          </div>
        </div>
        {/* Content skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 flex-1 divide-x">
          <div className="p-6 space-y-4">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-24 w-full rounded-md" />
          </div>
          <div className="p-6 space-y-4">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-40 w-full rounded-md" />
            <Skeleton className="h-9 w-24 rounded-md" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background no-scrollbar overflow-hidden">
      <WebhookEditorHeader
        form={form}
        webhook={webhook}
        isNew={isNew}
        isSaving={isSaving}
        isDirty={isDirty}
        activeTab={activeTab}
        onNameChange={(name) => setForm((prev) => ({ ...prev, name }))}
        onSave={handleSave}
        onDelete={handleDelete}
        onBack={handleBack}
        onCopyPath={(path) => {
          void copy(window.location.host + path, {
            successDescription: 'Webhook path copied to clipboard.',
          });
        }}
      />

      <div className="flex-1 overflow-hidden">
        <Tabs value={activeTab} onValueChange={navigateToTab} className="h-full flex flex-col">
          <div className="px-6 py-2 border-b bg-muted/40 shrink-0">
            <TabsList>
              <TabsTrigger value="editor" className="gap-2">
                <Code className="h-4 w-4" /> Editor & Test
              </TabsTrigger>
              <TabsTrigger value="deliveries" className="gap-2" disabled={isNew}>
                <LucideHistory className="h-4 w-4" /> Deliveries
              </TabsTrigger>
              <TabsTrigger value="settings" className="gap-2" disabled={isNew}>
                <Settings className="h-4 w-4" /> Settings
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="editor" className="flex-1 overflow-hidden m-0 p-0 h-full">
            <div className="grid grid-cols-1 md:grid-cols-2 h-full divide-x">
              <WebhookFormSection
                form={form}
                setForm={setForm}
                workflows={workflows}
                workflowRuntimeInputs={workflowRuntimeInputs}
              />
              <WebhookTestingPanel
                testPayload={testPayload}
                setTestPayload={setTestPayload}
                testHeaders={testHeaders}
                setTestHeaders={setTestHeaders}
                isTesting={isTesting}
                testResult={testResult}
                workflowRuntimeInputs={workflowRuntimeInputs}
                onTest={handleTest}
              />
            </div>
          </TabsContent>

          <TabsContent value="deliveries" className="flex-1 overflow-auto p-6 m-0">
            <WebhookDeliveryLog
              deliveries={deliveries}
              isLoadingDeliveries={isLoadingDeliveries}
              navigate={navigate}
            />
          </TabsContent>

          <TabsContent value="settings" className="flex-1 overflow-auto p-6 m-0 space-y-6">
            <WebhookSettingsTab
              form={form}
              onDescriptionChange={(desc) => setForm((prev) => ({ ...prev, description: desc }))}
              onDelete={handleDelete}
            />
          </TabsContent>
        </Tabs>
      </div>
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
