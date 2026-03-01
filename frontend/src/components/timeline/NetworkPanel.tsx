import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Globe, ChevronDown, ChevronRight, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useExecutionTimelineStore } from '@/store/executionTimelineStore';
import { cn } from '@/lib/utils';

import type { HttpEventData, NetworkRequest } from './network/types';
import { getStatusColor, formatDuration, parseUrl } from './network/utils';
import { RequestDetailView } from './network/RequestDetailView';

export function NetworkPanel() {
  const events = useExecutionTimelineStore((s) => s.events);
  const selectedNodeId = useExecutionTimelineStore((s) => s.selectedNodeId);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [expandedHosts, setExpandedHosts] = useState<Set<string>>(new Set());

  // Resizable pane state
  const [leftPaneWidth, setLeftPaneWidth] = useState<number | null>(null); // null = 50%, number = pixels
  const containerRef = useRef<HTMLDivElement>(null);
  const isResizing = useRef(false);

  // Build network requests from HTTP events
  const networkRequests = useMemo(() => {
    const requestMap = new Map<string, NetworkRequest>();

    // Filter to HTTP events only
    const httpEvents = events.filter(
      (e) =>
        e.type === 'HTTP_REQUEST_SENT' ||
        e.type === 'HTTP_RESPONSE_RECEIVED' ||
        e.type === 'HTTP_REQUEST_ERROR',
    );

    // Group by correlation ID
    for (const event of httpEvents) {
      const data = event.data as HttpEventData | undefined;
      if (!data?.correlationId) continue;

      const correlationId = data.correlationId;
      const existing = requestMap.get(correlationId);

      if (event.type === 'HTTP_REQUEST_SENT' && data.request) {
        requestMap.set(correlationId, {
          id: event.id,
          correlationId,
          nodeId: event.nodeId,
          method: data.request.method,
          url: data.request.url,
          startTime: event.timestamp,
          request: data.request,
          ...existing,
        });
      } else if (event.type === 'HTTP_RESPONSE_RECEIVED' && data.har) {
        const existingOrNew = existing || {
          id: event.id,
          correlationId,
          nodeId: event.nodeId,
          method: data.har.request.method,
          url: data.har.request.url,
          startTime: data.har.startedDateTime,
        };
        requestMap.set(correlationId, {
          ...existingOrNew,
          status: data.har.response.status,
          statusText: data.har.response.statusText,
          duration: data.har.time,
          request: data.har.request,
          response: data.har.response,
          timings: data.har.timings,
        });
      } else if (event.type === 'HTTP_REQUEST_ERROR' && data.error) {
        const existingOrNew = existing || {
          id: event.id,
          correlationId,
          nodeId: event.nodeId,
          method: data.request?.method || 'GET',
          url: data.request?.url || '',
          startTime: event.timestamp,
        };
        requestMap.set(correlationId, {
          ...existingOrNew,
          error: data.error,
          request: data.request,
        });
      }
    }

    return Array.from(requestMap.values()).sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
    );
  }, [events]);

  // Filter by selected node if any
  const filteredRequests = useMemo(() => {
    if (!selectedNodeId) return networkRequests;
    return networkRequests.filter((r) => r.nodeId === selectedNodeId);
  }, [networkRequests, selectedNodeId]);

  // Group by host
  const requestsByHost = useMemo(() => {
    const groups = new Map<string, NetworkRequest[]>();
    for (const request of filteredRequests) {
      const { host } = parseUrl(request.url);
      const existing = groups.get(host) || [];
      existing.push(request);
      groups.set(host, existing);
    }
    return groups;
  }, [filteredRequests]);

  const selectedRequest = selectedRequestId
    ? filteredRequests.find((r) => r.correlationId === selectedRequestId)
    : null;

  const toggleHost = (host: string) => {
    setExpandedHosts((prev) => {
      const next = new Set(prev);
      if (next.has(host)) {
        next.delete(host);
      } else {
        next.add(host);
      }
      return next;
    });
  };

  // Auto-expand all hosts on first render
  useEffect(() => {
    setExpandedHosts(new Set(requestsByHost.keys()));
  }, [filteredRequests.length]);

  // Resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = e.clientX - containerRect.left;
      const minWidth = 120;
      const maxWidth = containerRect.width * 0.8;
      setLeftPaneWidth(Math.max(minWidth, Math.min(maxWidth, newWidth)));
    };

    const handleMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  if (filteredRequests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
        <Globe className="h-12 w-12 mb-4 opacity-30" />
        <p className="text-sm font-medium">No HTTP requests recorded</p>
        <p className="text-xs mt-1">
          {selectedNodeId
            ? `No requests from node "${selectedNodeId}"`
            : 'HTTP requests made by components will appear here'}
        </p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex h-full">
      {/* Request List */}
      <div
        className="flex flex-col min-h-0 flex-shrink-0"
        style={{
          width: selectedRequest ? (leftPaneWidth !== null ? `${leftPaneWidth}px` : '50%') : '100%',
        }}
      >
        {/* Header */}
        <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Network</span>
            <Badge variant="secondary" className="text-[10px]">
              {filteredRequests.length} request{filteredRequests.length !== 1 ? 's' : ''}
            </Badge>
          </div>
          {selectedNodeId && (
            <Badge variant="outline" className="text-[10px]">
              Node: {selectedNodeId}
            </Badge>
          )}
        </div>

        {/* Request List */}
        <div className="flex-1 overflow-auto">
          {Array.from(requestsByHost.entries()).map(([host, requests]) => {
            const isExpanded = expandedHosts.has(host);
            return (
              <div key={host}>
                {/* Host Header */}
                <button
                  onClick={() => toggleHost(host)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs bg-muted/20 hover:bg-muted/40 border-b transition-colors"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3 w-3 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  )}
                  <span className="font-medium">{host}</span>
                  <span className="text-muted-foreground">({requests.length})</span>
                </button>

                {/* Requests */}
                {isExpanded &&
                  requests.map((request) => {
                    const { path } = parseUrl(request.url);
                    const isSelected = selectedRequestId === request.correlationId;

                    return (
                      <button
                        key={request.correlationId}
                        onClick={() =>
                          setSelectedRequestId(isSelected ? null : request.correlationId)
                        }
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-2 text-xs border-b hover:bg-muted/50 transition-colors text-left',
                          isSelected && 'bg-primary/10 border-l-2 border-l-primary',
                        )}
                      >
                        <Badge
                          variant="outline"
                          className={cn(
                            'font-mono text-[10px] w-14 justify-center flex-shrink-0',
                            request.method === 'GET' &&
                              'border-emerald-500/50 text-emerald-600 dark:text-emerald-400',
                            request.method === 'POST' &&
                              'border-blue-500/50 text-blue-600 dark:text-blue-400',
                            request.method === 'PUT' &&
                              'border-amber-500/50 text-amber-600 dark:text-amber-400',
                            request.method === 'DELETE' &&
                              'border-rose-500/50 text-rose-600 dark:text-rose-400',
                            request.method === 'PATCH' &&
                              'border-purple-500/50 text-purple-600 dark:text-purple-400',
                          )}
                        >
                          {request.method}
                        </Badge>
                        <span
                          className={cn(
                            'font-mono text-xs w-10 text-center flex-shrink-0',
                            getStatusColor(request.status, !!request.error),
                          )}
                        >
                          {request.status || (request.error ? 'ERR' : '...')}
                        </span>
                        <span className="font-mono text-xs truncate flex-1" title={path}>
                          {path}
                        </span>
                        <span className="text-[10px] text-muted-foreground flex-shrink-0 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDuration(request.duration)}
                        </span>
                      </button>
                    );
                  })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Resize Handle */}
      {selectedRequest && (
        <div
          onMouseDown={handleResizeStart}
          className="w-1 bg-border hover:bg-primary/50 cursor-col-resize flex-shrink-0 transition-colors group relative"
        >
          <div className="absolute inset-y-0 -left-1 -right-1" />
        </div>
      )}

      {/* Request Detail */}
      {selectedRequest && (
        <div className="flex-1 min-h-0 min-w-0">
          <RequestDetailView request={selectedRequest} />
        </div>
      )}
    </div>
  );
}
