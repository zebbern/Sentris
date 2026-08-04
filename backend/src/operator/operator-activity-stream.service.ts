import { Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';

import {
  OPERATOR_ACTIVITY_STREAM_VERSION,
  type OperatorActivityStreamError,
  type OperatorActivityStreamReady,
  type OperatorActivityStreamSnapshot,
} from '@sentris/shared';

import type { AuthContext } from '../auth/types';
import { streamOperatorPollingProjection } from './operator-polling-stream';
import { OperatorService } from './operator.service';

export const OPERATOR_ACTIVITY_STREAM_POLL_INTERVAL_MS = 1_000;
const OPERATOR_ACTIVITY_STREAM_KEEPALIVE_INTERVAL_MS = 15_000;

const ACTIVITY_READ_ERROR: OperatorActivityStreamError = {
  version: OPERATOR_ACTIVITY_STREAM_VERSION,
  code: 'activity_read_failed',
  message: 'Operator activity update could not be read',
};

@Injectable()
export class OperatorActivityStreamService {
  private readonly logger = new Logger(OperatorActivityStreamService.name);

  constructor(private readonly operatorService: OperatorService) {}

  streamActivity(auth: AuthContext | null, response: Response): Promise<void> {
    const ready: OperatorActivityStreamReady = {
      version: OPERATOR_ACTIVITY_STREAM_VERSION,
      mode: 'polling',
      intervalMs: OPERATOR_ACTIVITY_STREAM_POLL_INTERVAL_MS,
    };
    return streamOperatorPollingProjection({
      response,
      pollIntervalMs: OPERATOR_ACTIVITY_STREAM_POLL_INTERVAL_MS,
      keepaliveIntervalMs: OPERATOR_ACTIVITY_STREAM_KEEPALIVE_INTERVAL_MS,
      load: () => this.operatorService.listSessions(auth),
      ready: { event: 'ready', payload: ready },
      snapshot: (sessions) => ({
        event: 'snapshot',
        payload: {
          version: OPERATOR_ACTIVITY_STREAM_VERSION,
          sessions,
        } satisfies OperatorActivityStreamSnapshot,
      }),
      readError: { event: 'error', payload: ACTIVITY_READ_ERROR },
      onReadError: (error) =>
        this.logger.warn(
          'Failed to read Operator activity while streaming',
          error instanceof Error ? error.stack : String(error),
        ),
      onWriteError: (error) =>
        this.logger.warn(
          'Failed to write Operator activity stream',
          error instanceof Error ? error.stack : String(error),
        ),
    });
  }
}
