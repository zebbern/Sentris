// Simple format function to avoid webpack issues with node:util
function format(...args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg === null || arg === undefined) return String(arg);
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    })
    .join(' ');
}

function shouldMirrorComponentDiagnostics(): boolean {
  return process.env.SENTRIS_DEBUG_COMPONENTS === '1';
}

import type {
  ExecutionContext,
  ExecutionContextMetadata,
  Logger,
  ProgressEventInput,
  LogEventInput,
  TerminalChunkInput,
  AgentTracePublisher,
  IScopedTraceService,
  TraceEventInput,
} from './types';
import type {
  IFileStorageService,
  ISecretsService,
  IArtifactService,
  ITraceService,
  TraceEvent,
} from './interfaces';
import { createHttpClient } from './http/instrumented-fetch';

export interface CreateContextOptions {
  runId: string;
  componentRef: string;
  metadata?: Partial<Omit<ExecutionContextMetadata, 'runId' | 'componentRef'>>;
  storage?: IFileStorageService;
  secrets?: ISecretsService;
  artifacts?: IArtifactService;
  trace?: ITraceService;
  logCollector?: (entry: LogEventInput) => void;
  terminalCollector?: (chunk: TerminalChunkInput) => void;
  agentTracePublisher?: AgentTracePublisher;
  workflowId?: string;
  workflowName?: string;
  organizationId?: string | null;
  scopeId?: string | null;
  signal?: AbortSignal;
}

export function createExecutionContext(options: CreateContextOptions): ExecutionContext {
  const {
    runId,
    componentRef,
    metadata: metadataInput,
    storage,
    secrets,
    artifacts,
    trace,
    logCollector,
    terminalCollector,
    agentTracePublisher,
    workflowId,
    workflowName,
    organizationId,
    scopeId,
    signal,
  } = options;
  const metadata = createMetadata(runId, componentRef, metadataInput);
  const scopedTrace = trace
    ? createScopedTrace(trace, metadata, workflowId ?? null, organizationId ?? null)
    : undefined;

  const pushLog = (
    stream: LogEventInput['stream'],
    level: LogEventInput['level'],
    args: unknown[],
  ) => {
    if (args.length === 0) {
      return;
    }
    const message = format(...args);
    if (message.length === 0) {
      return;
    }
    const entry: LogEventInput = {
      runId,
      nodeRef: componentRef,
      stream,
      level,
      message,
      timestamp: new Date().toISOString(),
      metadata,
    };

    if (logCollector) {
      logCollector(entry);
    }

    if (scopedTrace) {
      scopedTrace.record({
        type: 'NODE_PROGRESS',
        runId,
        nodeRef: componentRef,
        timestamp: entry.timestamp,
        level: level ?? 'info',
        message,
        data: { stream, origin: 'log' },
      });
    }
  };

  const logger: Logger = Object.freeze({
    debug: (...args: unknown[]) => {
      pushLog('stdout', 'debug', args);
      if (shouldMirrorComponentDiagnostics()) {
        console.debug(`[${componentRef}]`, ...args);
      }
    },
    info: (...args: unknown[]) => {
      pushLog('stdout', 'info', args);
      if (shouldMirrorComponentDiagnostics()) {
        console.log(`[${componentRef}]`, ...args);
      }
    },
    warn: (...args: unknown[]) => {
      pushLog('stdout', 'warn', args);
      console.warn(`[${componentRef}]`, ...args);
    },
    error: (...args: unknown[]) => {
      pushLog('stderr', 'error', args);
      console.error(`[${componentRef}]`, ...args);
    },
  }) as Logger;

  const emitProgress = (progress: ProgressEventInput | string) => {
    const normalized: ProgressEventInput =
      typeof progress === 'string' ? { message: progress, level: 'info' } : progress;
    const level = normalized.level ?? 'info';
    const message = normalized.message;

    if (shouldMirrorComponentDiagnostics()) {
      console.log(`[${componentRef}] progress [${level}]: ${message}`);
    }
    if (scopedTrace) {
      scopedTrace.record({
        type: 'NODE_PROGRESS',
        runId,
        nodeRef: componentRef,
        timestamp: new Date().toISOString(),
        level,
        message,
        data: normalized.data,
      });
    }
  };

  const context: ExecutionContext = {
    runId,
    componentRef,
    logger,
    emitProgress,
    storage,
    secrets,
    artifacts,
    trace: scopedTrace,
    logCollector,
    terminalCollector,
    metadata,
    agentTracePublisher,
    workflowId,
    workflowName,
    organizationId,
    scopeId,
    signal,
    http: undefined as unknown as ExecutionContext['http'],
  };

  (context as ExecutionContext).http = createHttpClient(context);

  // Override logger methods to use logCollector instead of trace.record
  if (logCollector) {
    const loggerWithCollector: Logger = Object.freeze({
      debug: (...args: unknown[]) => {
        logCollector({
          runId,
          nodeRef: componentRef,
          stream: 'stdout',
          level: 'debug',
          message: format(...args),
          timestamp: new Date().toISOString(),
          metadata,
        });
        if (shouldMirrorComponentDiagnostics()) {
          console.debug(`[${componentRef}]`, ...args);
        }
      },
      info: (...args: unknown[]) => {
        logCollector({
          runId,
          nodeRef: componentRef,
          stream: 'stdout',
          level: 'info',
          message: format(...args),
          timestamp: new Date().toISOString(),
          metadata,
        });
        if (shouldMirrorComponentDiagnostics()) {
          console.log(`[${componentRef}]`, ...args);
        }
      },
      warn: (...args: unknown[]) => {
        logCollector({
          runId,
          nodeRef: componentRef,
          stream: 'stdout',
          level: 'warn',
          message: format(...args),
          timestamp: new Date().toISOString(),
          metadata,
        });
        console.warn(`[${componentRef}]`, ...args);
      },
      error: (...args: unknown[]) => {
        logCollector({
          runId,
          nodeRef: componentRef,
          stream: 'stderr',
          level: 'error',
          message: format(...args),
          timestamp: new Date().toISOString(),
          metadata,
        });
        console.error(`[${componentRef}]`, ...args);
      },
    }) as Logger;

    // Replace the logger in context
    (context as any).logger = loggerWithCollector;
  }

  return Object.freeze(context) as ExecutionContext;
}

function createMetadata(
  runId: string,
  componentRef: string,
  metadata?: Partial<Omit<ExecutionContextMetadata, 'runId' | 'componentRef'>>,
): ExecutionContextMetadata {
  const scoped: ExecutionContextMetadata = {
    ...metadata,
    runId,
    componentRef,
  };

  return Object.freeze(scoped);
}

function createScopedTrace(
  trace: ITraceService,
  metadata: ExecutionContextMetadata,
  workflowId: string | null,
  organizationId: string | null,
): IScopedTraceService {
  let ordinal = 0;

  return {
    record(event: TraceEventInput) {
      const eventOrdinal = ++ordinal;
      const identityScope = metadata.activityId ?? `component:${metadata.componentRef}`;
      const eventId = event.eventId ?? `trace:${metadata.runId}:${identityScope}:${eventOrdinal}`;
      const enriched: TraceEvent = {
        timestamp: new Date().toISOString(),
        ...event,
        eventId,
        sequence: event.sequence ?? stableTraceSequence(metadata.activityId, eventOrdinal, eventId),
        runId: metadata.runId,
        workflowId: event.workflowId ?? workflowId,
        organizationId: event.organizationId ?? organizationId,
        nodeRef: metadata.componentRef,
        context: metadata,
      } as TraceEvent;

      void Promise.resolve(trace.record(enriched)).catch((error: unknown) => {
        console.error(
          `[Trace] Failed to publish component trace event ${eventId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    },
  };
}

function stableTraceSequence(
  activityId: string | undefined,
  ordinal: number,
  eventId: string,
): number {
  if (activityId && /^\d+$/.test(activityId)) {
    const activitySequence = Number(activityId);
    const sequence = activitySequence * 10_000 + ordinal;
    if (Number.isSafeInteger(sequence) && sequence > 0 && sequence <= 2_147_483_647) {
      return sequence;
    }
  }

  let hash = 2_166_136_261;
  for (let index = 0; index < eventId.length; index += 1) {
    hash ^= eventId.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return ((hash >>> 0) % 2_147_483_646) + 1;
}
