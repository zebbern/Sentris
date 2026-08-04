import { Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';

import {
  OPERATOR_SESSION_STREAM_VERSION,
  type OperatorSessionStreamError,
  type OperatorSessionStreamReady,
  type OperatorSessionStreamSnapshot,
} from '@sentris/shared';

import type { AuthContext } from '../auth/types';
import { streamOperatorPollingProjection } from './operator-polling-stream';
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

  streamSession(auth: AuthContext | null, sessionId: string, response: Response): Promise<void> {
    const ready: OperatorSessionStreamReady = {
      version: OPERATOR_SESSION_STREAM_VERSION,
      sessionId,
      mode: 'polling',
      intervalMs: OPERATOR_SESSION_STREAM_POLL_INTERVAL_MS,
    };
    return streamOperatorPollingProjection({
      response,
      pollIntervalMs: OPERATOR_SESSION_STREAM_POLL_INTERVAL_MS,
      keepaliveIntervalMs: OPERATOR_SESSION_STREAM_KEEPALIVE_INTERVAL_MS,
      load: () => this.operatorService.getSession(auth, sessionId),
      ready: { event: 'ready', payload: ready },
      snapshot: (session) => ({
        event: 'snapshot',
        payload: {
          version: OPERATOR_SESSION_STREAM_VERSION,
          session,
        } satisfies OperatorSessionStreamSnapshot,
      }),
      readError: { event: 'error', payload: SESSION_READ_ERROR },
      onReadError: (error) =>
        this.logger.warn(
          `Failed to read Operator session ${sessionId} while streaming`,
          error instanceof Error ? error.stack : String(error),
        ),
      onWriteError: (error) =>
        this.logger.warn(
          `Failed to write Operator session stream ${sessionId}`,
          error instanceof Error ? error.stack : String(error),
        ),
    });
  }
}
