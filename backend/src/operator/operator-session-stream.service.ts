import { Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';

import {
  OPERATOR_SESSION_STREAM_VERSION,
  type OperatorSessionDetail,
  type OperatorSessionStreamError,
  type OperatorSessionStreamReady,
  type OperatorSessionStreamSnapshot,
} from '@sentris/shared';

import type { AuthContext } from '../auth/types';
import { OperatorService } from './operator.service';

export const OPERATOR_SESSION_STREAM_POLL_INTERVAL_MS = 1_000;
export const OPERATOR_SESSION_STREAM_KEEPALIVE_INTERVAL_MS = 15_000;

const SESSION_READ_ERROR: OperatorSessionStreamError = {
  version: OPERATOR_SESSION_STREAM_VERSION,
  code: 'session_read_failed',
  message: 'Operator session update could not be read',
};

@Injectable()
export class OperatorSessionStreamService {
  private readonly logger = new Logger(OperatorSessionStreamService.name);

  constructor(private readonly operatorService: OperatorService) {}

  async streamSession(
    auth: AuthContext | null,
    sessionId: string,
    response: Response,
  ): Promise<void> {
    let active = true;
    let responseCommitted = false;
    let polling = false;
    let readFailureOpen = false;
    let writeBlocked = false;
    let pendingEvent: string | null = null;
    let pendingSnapshot: string | null = null;
    const timers: {
      poll?: NodeJS.Timeout;
      keepalive?: NodeJS.Timeout;
    } = {};

    const cleanup = () => {
      if (!active) return;
      active = false;
      pendingEvent = null;
      pendingSnapshot = null;
      if (timers.poll) clearInterval(timers.poll);
      if (timers.keepalive) clearInterval(timers.keepalive);
      response.removeListener('close', cleanup);
      response.removeListener('drain', flushPendingWrites);
      if (responseCommitted && !response.writableEnded && !response.destroyed) {
        response.end();
      }
    };

    const writeNow = (chunk: string): boolean => {
      if (!active) return false;
      try {
        if (!response.write(chunk)) {
          writeBlocked = true;
          response.once('drain', flushPendingWrites);
        }
        return true;
      } catch (error: unknown) {
        this.logger.warn(
          `Failed to write Operator session stream ${sessionId}`,
          error instanceof Error ? error.stack : String(error),
        );
        cleanup();
        return false;
      }
    };

    const write = (chunk: string, coalesceSnapshot = false, preserveEvent = false): boolean => {
      if (!active) return false;
      if (writeBlocked) {
        if (coalesceSnapshot) pendingSnapshot = chunk;
        else if (preserveEvent) pendingEvent = chunk;
        return true;
      }
      return writeNow(chunk);
    };

    function flushPendingWrites() {
      if (!active) return;
      writeBlocked = false;
      const event = pendingEvent;
      pendingEvent = null;
      if (event) {
        writeNow(event);
        if (!active || writeBlocked) return;
      }
      const snapshot = pendingSnapshot;
      pendingSnapshot = null;
      if (snapshot) writeNow(snapshot);
    }

    const send = (event: string, payload: unknown, coalesceSnapshot = false): boolean =>
      write(
        `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`,
        coalesceSnapshot,
        !coalesceSnapshot,
      );

    // ServerResponse tracks the lifetime of this SSE response. IncomingMessage `close`
    // only means the request body was fully received on modern Node.js.
    response.once('close', cleanup);

    // Resolve ownership before committing an SSE response so auth failures remain normal HTTP errors.
    let initialSession: OperatorSessionDetail;
    try {
      initialSession = await this.operatorService.getSession(auth, sessionId);
    } catch (error: unknown) {
      cleanup();
      throw error;
    }

    if (!active) return;

    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
    responseCommitted = true;

    const ready: OperatorSessionStreamReady = {
      version: OPERATOR_SESSION_STREAM_VERSION,
      sessionId,
      mode: 'polling',
      intervalMs: OPERATOR_SESSION_STREAM_POLL_INTERVAL_MS,
    };
    send('ready', ready);

    let lastSnapshotSignature = JSON.stringify(initialSession);
    const initialSnapshot: OperatorSessionStreamSnapshot = {
      version: OPERATOR_SESSION_STREAM_VERSION,
      session: initialSession,
    };
    send('snapshot', initialSnapshot, true);

    if (!active) return;

    const pump = async () => {
      if (!active || polling) return;
      polling = true;
      try {
        const session: OperatorSessionDetail = await this.operatorService.getSession(
          auth,
          sessionId,
        );
        const signature = JSON.stringify(session);
        if (signature !== lastSnapshotSignature) {
          lastSnapshotSignature = signature;
          send(
            'snapshot',
            {
              version: OPERATOR_SESSION_STREAM_VERSION,
              session,
            } satisfies OperatorSessionStreamSnapshot,
            true,
          );
        }
        readFailureOpen = false;
      } catch (error: unknown) {
        this.logger.warn(
          `Failed to read Operator session ${sessionId} while streaming`,
          error instanceof Error ? error.stack : String(error),
        );
        if (!readFailureOpen) {
          readFailureOpen = true;
          send('error', SESSION_READ_ERROR);
        }
      } finally {
        polling = false;
      }
    };

    timers.poll = setInterval(() => {
      void pump();
    }, OPERATOR_SESSION_STREAM_POLL_INTERVAL_MS);
    timers.poll.unref();

    timers.keepalive = setInterval(() => {
      write(': keepalive\n\n');
    }, OPERATOR_SESSION_STREAM_KEEPALIVE_INTERVAL_MS);
    timers.keepalive.unref();
  }
}
