import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import {
  StreamRunQueryDto,
  StreamRunQuerySchema,
  TerminalChunksQueryDto,
  TerminalChunksQuerySchema,
} from './dto/workflow-graph.dto';
import {
  TerminalArchiveRequestDto,
  TerminalRecordingDto,
  TerminalRecordListDto,
  TerminalRecordParamDto,
  TerminalArchiveRequestSchema,
  TerminalRecordParamSchema,
} from './dto/terminal-record.dto';
import { TraceService } from '../trace/trace.service';
import { WorkflowsService } from './workflows.service';
import { TerminalStreamService } from '../terminal/terminal-stream.service';
import { TerminalArchiveService } from './terminal-archive.service';
import { LogStreamService } from '../trace/log-stream.service';
import type { Request, Response } from 'express';
import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import type { WorkflowTerminalRecord } from '../database/schema';
import { TERMINAL_STATUSES } from '@sentris/shared';

const TERMINAL_COMPLETION_STATUSES = new Set(TERMINAL_STATUSES);

@ApiTags('workflows')
@Controller('workflows')
export class WorkflowRunStreamController {
  private readonly logger = new Logger(WorkflowRunStreamController.name);

  constructor(
    private readonly workflowsService: WorkflowsService,
    private readonly traceService: TraceService,
    private readonly terminalStreamService: TerminalStreamService,
    private readonly terminalArchiveService: TerminalArchiveService,
    private readonly logStreamService: LogStreamService,
  ) {}

  @Get('/runs/:runId/stream')
  @ApiOperation({ summary: 'Stream workflow run updates via SSE' })
  @ApiOkResponse({ description: 'Server-sent events stream for workflow run updates' })
  async stream(
    @Param('runId') runId: string,
    @Query(new ZodValidationPipe(StreamRunQuerySchema)) query: StreamRunQueryDto,
    @CurrentAuth() auth: AuthContext | null,
    @Res() res: Response,
    @Req() req: Request,
  ): Promise<void> {
    // Auth is now handled via headers (Authorization and X-Organization-Id)
    // using a fetch-based SSE client that supports custom headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const rawRes = res as unknown as { flushHeaders?: () => void };
    if (typeof rawRes.flushHeaders === 'function') {
      rawRes.flushHeaders();
    }

    await this.workflowsService.ensureRunAccess(runId, auth);

    let lastSequence = Number.parseInt(query.cursor ?? '0', 10);
    let terminalCursor = query.terminalCursor;
    let lastLogCursor = query.logCursor ?? null;
    if (Number.isNaN(lastSequence) || lastSequence < 0) {
      lastSequence = 0;
    }

    let active = true;
    let lastStatusSignature: string | null = null;
    let intervalId: NodeJS.Timeout | undefined;
    // eslint-disable-next-line prefer-const -- initialized later after cleanup function is defined
    let heartbeatId: NodeJS.Timeout | undefined;
    let earliestEventTimestamp: number | null = null;
    let latestEventTimestamp: number | null = null;

    const send = (event: string, payload: unknown) => {
      if (!active) {
        return;
      }
      try {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
        // Flush headers if available (helps with immediate delivery)
        const rawRes = res as unknown as { flush?: () => void };
        if (typeof rawRes.flush === 'function') {
          rawRes.flush();
        }
      } catch (error: unknown) {
        // Connection closed or error writing
        this.logger.warn(`Failed to send SSE event ${event}:`, error);
        if (!active) {
          return;
        }
        active = false;
        void cleanup();
      }
    };

    const cleanup = async () => {
      if (!active) {
        return;
      }
      active = false;
      if (intervalId) {
        clearInterval(intervalId);
      }
      if (heartbeatId) {
        clearInterval(heartbeatId);
      }
      if (unsubscribe) {
        try {
          await unsubscribe();
        } catch (error: unknown) {
          this.logger.error('Error unsubscribing from trace events:', error);
        }
      }
      await this.workflowsService.releaseFlowContext(runId).catch((error) => {
        this.logger.warn('Failed to clear flow context:', error);
      });
      res.end();
    };

    const pump = async () => {
      if (!active) {
        return;
      }

      try {
        const { events, cursor } = await this.traceService.listSince(runId, lastSequence, auth);
        if (events.length > 0) {
          const lastId = events[events.length - 1]?.id;
          if (lastId) {
            const parsed = Number.parseInt(lastId, 10);
            if (!Number.isNaN(parsed)) {
              lastSequence = parsed;
            }
          }
          send('trace', { events, cursor: cursor ?? lastSequence.toString() });

          const timestamps = events
            .map((event) => Date.parse(event.timestamp))
            .filter((value) => !Number.isNaN(value));
          if (timestamps.length > 0) {
            const first = Math.min(...timestamps);
            const last = Math.max(...timestamps);
            if (earliestEventTimestamp === null || first < earliestEventTimestamp) {
              earliestEventTimestamp = first;
            }
            if (latestEventTimestamp === null || last > latestEventTimestamp) {
              latestEventTimestamp = last;
            }

            const packets = await this.workflowsService.buildDataFlows(runId, events, {
              baseTimestamp: earliestEventTimestamp ?? first,
              latestTimestamp: latestEventTimestamp ?? last,
            });

            if (packets.length > 0) {
              send('dataflow', { packets });
            }
          }
        }

        const terminal = await this.terminalStreamService.fetchChunks(runId, {
          cursor: terminalCursor,
        });
        if (terminal.chunks.length > 0) {
          terminalCursor = terminal.cursor;
          send('terminal', { runId, ...terminal });
        }

        const { logs: newLogs, cursor: nextCursor } = await this.logStreamService.fetchRecentLogs(
          runId,
          auth?.organizationId ?? null,
          lastLogCursor,
        );
        if (newLogs.length > 0) {
          lastLogCursor = nextCursor ?? lastLogCursor;
          send('logs', { logs: newLogs, cursor: lastLogCursor });
        }
      } catch (error: unknown) {
        send('error', { message: 'trace_fetch_failed', detail: String(error) });
      }

      try {
        const status = await this.workflowsService.getRunStatus(runId, query.temporalRunId, auth);
        const signature = JSON.stringify(status);
        if (signature !== lastStatusSignature) {
          lastStatusSignature = signature;
          send('status', status);
          if (TERMINAL_COMPLETION_STATUSES.has(status.status)) {
            this.terminalArchiveService.archiveRun(auth, runId).catch((error) => {
              this.logger.warn(`Failed to archive terminal for run ${runId}`, error);
            });
            send('complete', { runId, status: status.status });
            cleanup();
          }
        }
      } catch (error: unknown) {
        send('error', { message: 'status_fetch_failed', detail: String(error) });
      }
    };

    // Try to set up real-time LISTEN/NOTIFY subscription
    let unsubscribe: (() => Promise<void>) | undefined;
    let useRealtime = false;

    try {
      // Access repository for realtime subscription (private in TraceService, exposed via type assertion)
      const traceRepo = (
        this.traceService as unknown as {
          repository: {
            subscribeToRun?: (
              runId: string,
              cb: (payload: string) => Promise<void>,
            ) => Promise<() => Promise<void>>;
          };
        }
      ).repository;
      if (traceRepo && typeof traceRepo.subscribeToRun === 'function') {
        unsubscribe = await traceRepo.subscribeToRun(runId, async (payload: string) => {
          if (!active) return;

          try {
            const notification = JSON.parse(payload);
            if (notification.sequence > lastSequence) {
              const { events } = await this.traceService.listSince(runId, lastSequence, auth);
              if (events.length > 0) {
                const lastId = events[events.length - 1]?.id;
                if (lastId) {
                  const parsed = Number.parseInt(lastId, 10);
                  if (!Number.isNaN(parsed)) {
                    lastSequence = parsed;
                  }
                }
                send('trace', { events, cursor: lastSequence.toString() });

                const timestamps = events
                  .map((event) => Date.parse(event.timestamp))
                  .filter((value) => !Number.isNaN(value));
                if (timestamps.length > 0) {
                  const first = Math.min(...timestamps);
                  const last = Math.max(...timestamps);
                  if (earliestEventTimestamp === null || first < earliestEventTimestamp) {
                    earliestEventTimestamp = first;
                  }
                  if (latestEventTimestamp === null || last > latestEventTimestamp) {
                    latestEventTimestamp = last;
                  }

                  const packets = await this.workflowsService.buildDataFlows(runId, events, {
                    baseTimestamp: earliestEventTimestamp ?? first,
                    latestTimestamp: latestEventTimestamp ?? last,
                  });

                  if (packets.length > 0) {
                    send('dataflow', { packets });
                  }
                }
              }
            }
          } catch (error: unknown) {
            send('error', { message: 'notification_parse_failed', detail: String(error) });
          }
        });

        useRealtime = true;
        this.logger.log(`[Stream] Setting up realtime mode for run ${runId}`);
        send('ready', { mode: 'realtime', runId });
      } else {
        throw new Error('Repository does not support LISTEN/NOTIFY');
      }
    } catch (error: unknown) {
      // Fallback to polling mode if LISTEN/NOTIFY fails
      this.logger.warn(
        `[Stream] Failed to set up LISTEN/NOTIFY for run ${runId}, falling back to polling:`,
        error,
      );
      send('ready', { mode: 'polling', runId, interval: 1000 });
      intervalId = setInterval(() => {
        void pump();
      }, 1000);
    }

    await pump();
    this.logger.log(
      `[Stream] Initial pump completed for run ${runId}, mode: ${useRealtime ? 'realtime' : 'polling'}`,
    );

    // Always run a lightweight poll loop so terminal chunks are flushed even when TRACE notifications are realtime.
    // Only create this interval if we don't already have one (polling mode already has one)
    if (!intervalId) {
      intervalId = setInterval(() => {
        void pump();
      }, 1000);
      this.logger.log(`[Stream] Started backup polling interval for run ${runId}`);
    }

    heartbeatId = setInterval(() => {
      if (!active) {
        return;
      }
      res.write(': keepalive\n\n');
    }, 15000);

    req.on('close', cleanup);
  }

  @Get('/runs/:runId/terminal')
  @ApiOperation({ summary: 'Get workflow run terminal output' })
  @ApiOkResponse({
    description: 'Terminal chunks for a workflow run',
  })
  async terminalChunks(
    @Param('runId') runId: string,
    @Query(new ZodValidationPipe(TerminalChunksQuerySchema))
    query: TerminalChunksQueryDto,
    @CurrentAuth() auth: AuthContext | null,
  ) {
    await this.workflowsService.ensureRunAccess(runId, auth);
    const result = await this.terminalStreamService.fetchChunks(runId, {
      cursor: query.cursor,
      nodeRef: query.nodeRef,
      stream: query.stream,
      startTime: query.startTime ? new Date(query.startTime) : undefined,
      endTime: query.endTime ? new Date(query.endTime) : undefined,
    });
    if (result.chunks.length > 0 || !query.nodeRef) {
      return { runId, ...result };
    }

    try {
      const archived = await this.terminalArchiveService.replay(auth, runId, {
        nodeRef: query.nodeRef,
        stream: query.stream,
        cursor: query.cursor,
      });
      return { runId, ...archived };
    } catch (error: unknown) {
      this.logger.warn(`Failed to replay archived terminal for ${runId}`, error);
      return { runId, ...result };
    }
  }

  @Post('/runs/:runId/terminal/archive')
  @ApiOperation({ summary: 'Archive terminal output for a workflow run' })
  @ApiCreatedResponse({ type: TerminalRecordingDto })
  async archiveTerminal(
    @Param('runId') runId: string,
    @Body(new ZodValidationPipe(TerminalArchiveRequestSchema))
    body: TerminalArchiveRequestDto,
    @CurrentAuth() auth: AuthContext | null,
  ) {
    const record = await this.terminalArchiveService.archive(auth, runId, body);
    return this.toTerminalRecordingDto(record);
  }

  @Get('/runs/:runId/terminal/archive')
  @ApiOperation({ summary: 'List terminal archive recordings for a workflow run' })
  @ApiOkResponse({ type: TerminalRecordListDto })
  async listTerminalArchives(
    @Param('runId') runId: string,
    @CurrentAuth() auth: AuthContext | null,
  ) {
    const records = await this.terminalArchiveService.list(auth, runId);
    return {
      runId,
      records: records.map((record) => this.toTerminalRecordingDto(record)),
    };
  }

  @Get('/runs/:runId/terminal/archive/:recordId/download')
  @ApiOperation({ summary: 'Download a terminal archive recording' })
  @ApiOkResponse({ description: 'Download terminal recording' })
  async downloadTerminalArchive(
    @Param('runId') runId: string,
    @Param(new ZodValidationPipe(TerminalRecordParamSchema))
    params: TerminalRecordParamDto,
    @CurrentAuth() auth: AuthContext | null,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer, file } = await this.terminalArchiveService.download(
      auth,
      runId,
      params.recordId,
    );

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.setHeader('Content-Length', file.size.toString());

    return new StreamableFile(buffer);
  }

  private toTerminalRecordingDto(record: WorkflowTerminalRecord): TerminalRecordingDto {
    return {
      id: record.id,
      runId: record.runId,
      nodeRef: record.nodeRef,
      stream: record.stream,
      fileId: record.fileId,
      chunkCount: record.chunkCount,
      durationMs: record.durationMs,
      createdAt: (record.createdAt ?? new Date()).toISOString(),
    };
  }
}
