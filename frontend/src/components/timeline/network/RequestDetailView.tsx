import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

import type { NetworkRequest } from './types';
import { getStatusColor, formatDuration, formatBytes, tryFormatJson } from './utils';
import { HeadersTable } from './HeadersTable';
import { TimingBar } from './TimingBar';

interface RequestDetailProps {
  request: NetworkRequest;
}

export function RequestDetailView({ request }: RequestDetailProps) {
  const [activeTab, setActiveTab] = useState('headers');

  const requestHeaders = request.request?.headers || [];
  const responseHeaders = request.response?.headers || [];
  const requestBody = request.request?.postData?.text;
  const responseBody = request.response?.content?.text;

  return (
    <div className="h-full flex flex-col overflow-hidden border-l">
      {/* Request Summary Header */}
      <div className="p-3 border-b bg-muted/30 flex-shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <Badge variant="outline" className="font-mono text-xs">
            {request.method}
          </Badge>
          <span
            className={cn(
              'font-mono text-sm font-medium',
              getStatusColor(request.status, !!request.error),
            )}
          >
            {request.status || (request.error ? 'ERR' : 'Pending')}
          </span>
          {request.statusText && (
            <span className="text-xs text-muted-foreground">{request.statusText}</span>
          )}
        </div>
        <div className="font-mono text-xs text-muted-foreground break-all">{request.url}</div>
        {request.error && (
          <div className="mt-2 flex items-center gap-2 text-rose-600 dark:text-rose-400 text-xs">
            <AlertCircle className="h-3.5 w-3.5" />
            <span>{request.error.message}</span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="w-full justify-start rounded-none border-b bg-transparent h-9 flex-shrink-0">
          <TabsTrigger value="headers" className="text-xs">
            Headers
          </TabsTrigger>
          <TabsTrigger value="payload" className="text-xs">
            Payload
          </TabsTrigger>
          <TabsTrigger value="response" className="text-xs">
            Response
          </TabsTrigger>
          <TabsTrigger value="timing" className="text-xs">
            Timing
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-auto min-h-0">
          <TabsContent value="headers" className="m-0 p-3 space-y-4">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-muted-foreground">Node:</span>
                  <span className="ml-2 font-mono">{request.nodeId}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Duration:</span>
                  <span className="ml-2 font-mono">{formatDuration(request.duration)}</span>
                </div>
              </div>
              <HeadersTable headers={requestHeaders} title="Request Headers" />
              <HeadersTable headers={responseHeaders} title="Response Headers" />
            </div>
          </TabsContent>

          <TabsContent value="payload" className="m-0 p-3">
            {requestBody ? (
              <pre className="text-xs font-mono bg-muted/30 rounded-md p-3 whitespace-pre-wrap break-all">
                {tryFormatJson(requestBody)}
              </pre>
            ) : (
              <div className="text-xs text-muted-foreground py-4 text-center">No request body</div>
            )}
          </TabsContent>

          <TabsContent value="response" className="m-0 p-3">
            {request.response?.content && (
              <div className="space-y-2 mb-3">
                <div className="flex items-center gap-4 text-xs">
                  <div>
                    <span className="text-muted-foreground">Size:</span>
                    <span className="ml-2 font-mono">
                      {formatBytes(request.response.content.size)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Type:</span>
                    <span className="ml-2 font-mono">{request.response.content.mimeType}</span>
                  </div>
                </div>
              </div>
            )}
            {responseBody ? (
              <pre className="text-xs font-mono bg-muted/30 rounded-md p-3 whitespace-pre-wrap break-all">
                {tryFormatJson(responseBody)}
              </pre>
            ) : (
              <div className="text-xs text-muted-foreground py-4 text-center">
                No response body captured
              </div>
            )}
          </TabsContent>

          <TabsContent value="timing" className="m-0 p-3">
            {request.timings ? (
              <div className="space-y-4">
                <div className="text-xs">
                  <span className="text-muted-foreground">Total Time:</span>
                  <span className="ml-2 font-mono font-medium">
                    {formatDuration(request.duration)}
                  </span>
                </div>
                <TimingBar timings={request.timings} totalTime={request.duration || 0} />
              </div>
            ) : (
              <div className="text-xs text-muted-foreground py-4 text-center">
                No timing data available
              </div>
            )}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
