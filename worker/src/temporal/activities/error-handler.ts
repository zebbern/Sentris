/**
 * Error handling for component activity execution.
 *
 * Extracts structured error properties (type, retryable, details, fieldErrors)
 * from component errors, records trace events, and converts them into
 * Temporal `ApplicationFailure` instances.
 */

import { ApplicationFailure } from '@temporalio/common';
import { ValidationError } from '@shipsec/component-sdk';
import type { INodeIOService, IScopedTraceService } from '@shipsec/component-sdk';
import {
  truncateText,
  getErrorMessage,
  truncateDetails,
  ERROR_LOG_LIMIT,
} from '../utils/string-helpers';

interface ErrorHandlerContext {
  actionRef: string;
  componentId: string;
  activityId: string;
  attempt: number;
  runId: string;
  streamId: string;
  joinStrategy?: unknown;
  triggeredBy?: string;
  failure?: unknown;
  trace: IScopedTraceService | undefined;
  nodeIO: INodeIOService | undefined;
}

/**
 * Process a component execution error: log it, record trace/IO events, and
 * throw the appropriate `ApplicationFailure`.
 *
 * @throws {ApplicationFailure} Always — either retryable or non-retryable.
 */
export async function handleComponentError(
  error: unknown,
  ctx: ErrorHandlerContext,
): Promise<never> {
  const rawErrorMsg = getErrorMessage(error);
  const errorMsg = truncateText(rawErrorMsg, ERROR_LOG_LIMIT);
  console.error(`[Activity] Failed ${ctx.actionRef}: ${errorMsg}`);

  let errorType: string | undefined;
  let errorDetails: Record<string, unknown> | undefined;
  let fieldErrors: Record<string, string[]> | undefined;
  let isRetryable = false;

  if (error instanceof Error) {
    errorType = error.name;

    if ('type' in error && typeof (error as { type: unknown }).type === 'string') {
      errorType = (error as { type: string }).type;
    }

    if ('retryable' in error && typeof (error as { retryable: unknown }).retryable === 'boolean') {
      isRetryable = (error as { retryable: boolean }).retryable;
    }

    if (
      'details' in error &&
      typeof (error as { details: unknown }).details === 'object' &&
      (error as { details: unknown }).details !== null
    ) {
      errorDetails = truncateDetails(
        (error as { details: Record<string, unknown> }).details,
        ERROR_LOG_LIMIT,
      );
    }

    if (error instanceof ValidationError && error.fieldErrors) {
      fieldErrors = error.fieldErrors;
    }
  }

  const traceError = {
    message: errorMsg,
    type: errorType || 'UnknownError',
    stack:
      error instanceof Error && error.stack
        ? truncateText(error.stack, ERROR_LOG_LIMIT)
        : undefined,
    details: errorDetails,
    fieldErrors,
  };

  ctx.trace?.record({
    type: 'NODE_FAILED',
    timestamp: new Date().toISOString(),
    message: errorMsg,
    error: traceError,
    level: 'error',
  });

  await ctx.nodeIO?.recordCompletion({
    runId: ctx.runId,
    nodeRef: ctx.actionRef,
    componentId: ctx.componentId,
    outputs: {},
    status: 'failed',
    errorMessage: errorMsg,
  });

  const finalErrorType = errorType || 'ComponentError';
  const details = {
    componentId: ctx.componentId,
    nodeRef: ctx.actionRef,
    attempt: ctx.attempt,
    activityId: ctx.activityId,
    streamId: ctx.streamId,
    joinStrategy: ctx.joinStrategy,
    triggeredBy: ctx.triggeredBy,
    failure: ctx.failure,
    stack: error instanceof Error ? error.stack : undefined,
  };

  if (isRetryable) {
    throw ApplicationFailure.retryable(errorMsg, finalErrorType, [details]);
  }

  throw ApplicationFailure.nonRetryable(errorMsg, finalErrorType, [details]);
}
