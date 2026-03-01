import { Play, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import Editor from '@monaco-editor/react';
import { cn } from '@/lib/utils';
import type { RuntimeInput, WebhookTestResult } from './webhookEditorTypes';

interface WebhookTestingPanelProps {
  testPayload: string;
  setTestPayload: (value: string) => void;
  testHeaders: string;
  setTestHeaders: (value: string) => void;
  isTesting: boolean;
  testResult: WebhookTestResult | null;
  workflowRuntimeInputs: RuntimeInput[];
  onTest: () => void;
}

export function WebhookTestingPanel({
  testPayload,
  setTestPayload,
  testHeaders,
  setTestHeaders,
  isTesting,
  testResult,
  workflowRuntimeInputs,
  onTest,
}: WebhookTestingPanelProps) {
  return (
    <div className="flex flex-col h-full overflow-hidden bg-muted/10">
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <h3 className="font-medium flex items-center gap-2">
          <Play className="h-4 w-4 text-success" /> Test Console
        </h3>
        <Button size="sm" onClick={onTest} disabled={isTesting}>
          {isTesting ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Play className="h-4 w-4 mr-2" />
          )}
          Run Test
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Test Inputs */}
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label>Test Payload (JSON)</Label>
            <div
              className="h-[200px] border rounded-md overflow-hidden"
              role="group"
              aria-label="Test Payload (JSON)"
            >
              <Editor
                language="json"
                value={testPayload}
                onChange={(v) => setTestPayload(v || '')}
                theme="vs-dark"
                options={{ minimap: { enabled: false }, fontSize: 12 }}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Test Headers (JSON)</Label>
            <div
              className="h-[100px] border rounded-md overflow-hidden"
              role="group"
              aria-label="Test Headers (JSON)"
            >
              <Editor
                language="json"
                value={testHeaders}
                onChange={(v) => setTestHeaders(v || '')}
                theme="vs-dark"
                options={{ minimap: { enabled: false }, fontSize: 12 }}
              />
            </div>
          </div>
        </div>

        {/* Test Result */}
        <div className="h-px bg-border my-4" />
        <div className="space-y-2">
          <Label>Result</Label>
          <div className="min-h-[200px] p-4 border rounded-md bg-muted/30 font-mono text-xs overflow-auto">
            {testResult ? (
              testResult.error ? (
                <div className="text-destructive whitespace-pre-wrap">{testResult.error}</div>
              ) : (
                <div className="space-y-2">
                  <div
                    className={cn(
                      'flex items-center gap-2 font-medium pb-2 border-b',
                      testResult.success ? 'text-success' : 'text-destructive',
                    )}
                  >
                    {testResult.success ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <AlertTriangle className="h-4 w-4" />
                    )}
                    {testResult.success ? 'Successfully Parsed' : 'Parsing Failed'}
                  </div>
                  <pre>{JSON.stringify(testResult, null, 2)}</pre>

                  {/* Validation against workflow inputs */}
                  <div className="pt-4 border-t mt-4">
                    <span className="text-muted-foreground mb-2 block font-sans">
                      Workflow Input Matching:
                    </span>
                    {testResult.errorMessage && (
                      <div className="text-destructive text-xs mb-4 p-2 bg-destructive/10 rounded">
                        Error: {testResult.errorMessage}
                      </div>
                    )}
                    {workflowRuntimeInputs.map((input) => {
                      const value = testResult.parsedData?.[input.id];
                      const isMissing = input.required && value === undefined;
                      return (
                        <div
                          key={input.id}
                          className={cn(
                            'flex items-center gap-2 py-1',
                            isMissing ? 'text-destructive' : 'text-foreground',
                          )}
                        >
                          {isMissing ? (
                            <AlertTriangle className="h-3 w-3" />
                          ) : (
                            <CheckCircle2 className="h-3 w-3 text-success" />
                          )}
                          <span>
                            {input.id}:{' '}
                            {value !== undefined
                              ? typeof value === 'object'
                                ? JSON.stringify(value)
                                : String(value)
                              : 'undefined'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )
            ) : (
              <div className="text-muted-foreground flex items-center justify-center h-full">
                Run a test to see results
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
