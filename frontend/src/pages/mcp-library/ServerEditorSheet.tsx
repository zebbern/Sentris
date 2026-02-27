import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileJson } from 'lucide-react';
import type {
  ServerFormData,
  HeaderEntry,
  DiscoveryPreviewItem,
  DiscoveryStatusState,
} from './types';
import { ManualServerForm } from './ManualServerForm';
import { JsonServerForm } from './JsonServerForm';

interface ServerEditorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingServer: string | null;
  formData: ServerFormData;
  onFormDataChange: (data: ServerFormData) => void;
  activeTab: 'manual' | 'json';
  onActiveTabChange: (tab: 'manual' | 'json') => void;
  isSaving: boolean;
  isImporting: boolean;
  headerEntries: HeaderEntry[];
  secretPickerEntryIndex: number | null;
  onSecretPickerEntryIndexChange: (index: number | null) => void;
  onAddHeader: () => void;
  onUpdateHeader: (index: number, field: 'key' | 'value' | 'secretId', value: string) => void;
  onRemoveHeader: (index: number) => void;
  discoveryStatus: DiscoveryStatusState | null;
  onTestAndDiscover: () => void;
  onSave: () => void;
  jsonValue: string;
  onJsonValueChange: (value: string) => void;
  jsonParseError: string | null;
  onJsonParseErrorChange: (error: string | null) => void;
  isTestingDiscovery: boolean;
  discoveryPreview: DiscoveryPreviewItem[] | null;
  onClearDiscoveryPreview: () => void;
  onJsonTestAndDiscover: () => void;
  onJsonSave: () => void;
}

export function ServerEditorSheet({
  open,
  onOpenChange,
  editingServer,
  formData,
  onFormDataChange,
  activeTab,
  onActiveTabChange,
  isSaving,
  isImporting,
  headerEntries,
  secretPickerEntryIndex,
  onSecretPickerEntryIndexChange,
  onAddHeader,
  onUpdateHeader,
  onRemoveHeader,
  discoveryStatus,
  onTestAndDiscover,
  onSave,
  jsonValue,
  onJsonValueChange,
  jsonParseError,
  onJsonParseErrorChange,
  isTestingDiscovery,
  discoveryPreview,
  onClearDiscoveryPreview,
  onJsonTestAndDiscover,
  onJsonSave,
}: ServerEditorSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{editingServer ? 'Edit MCP Server' : 'Add MCP Server'}</SheetTitle>
          <SheetDescription>
            Configure an MCP server that AI agents can use to access tools.
          </SheetDescription>
        </SheetHeader>

        <Tabs
          value={activeTab}
          onValueChange={(v) => onActiveTabChange(v as 'manual' | 'json')}
          className="mt-4"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="manual">Manual</TabsTrigger>
            <TabsTrigger value="json">
              <FileJson className="h-4 w-4 mr-2" />
              JSON
            </TabsTrigger>
          </TabsList>

          <TabsContent value="manual" className="space-y-4 mt-4">
            <ManualServerForm
              formData={formData}
              onFormDataChange={onFormDataChange}
              headerEntries={headerEntries}
              secretPickerEntryIndex={secretPickerEntryIndex}
              onSecretPickerEntryIndexChange={onSecretPickerEntryIndexChange}
              onAddHeader={onAddHeader}
              onUpdateHeader={onUpdateHeader}
              onRemoveHeader={onRemoveHeader}
              discoveryStatus={discoveryStatus}
              onTestAndDiscover={onTestAndDiscover}
              onSave={onSave}
              isSaving={isSaving}
              editingServer={editingServer}
              onClose={() => onOpenChange(false)}
            />
          </TabsContent>

          <TabsContent value="json" className="space-y-4 mt-4">
            <JsonServerForm
              editingServer={editingServer}
              jsonValue={jsonValue}
              onJsonValueChange={onJsonValueChange}
              jsonParseError={jsonParseError}
              onJsonParseErrorChange={onJsonParseErrorChange}
              isTestingDiscovery={isTestingDiscovery}
              discoveryPreview={discoveryPreview}
              onClearDiscoveryPreview={onClearDiscoveryPreview}
              onTestAndDiscover={onJsonTestAndDiscover}
              onSave={onJsonSave}
              isSaving={isSaving}
              isImporting={isImporting}
              onClose={() => onOpenChange(false)}
            />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
