import { Injectable } from '@nestjs/common';
import {
  McpCatalogSchema,
  McpPromptGetOperationSchema,
  McpResourceReadOperationSchema,
  McpRuntimeKeySchema,
  McpSavedServerPreviewResponseSchema,
  type McpCatalog,
  type McpPromptGetOperation,
  type McpResourceReadOperation,
  type McpRuntimeKey,
  type McpSavedServerPreviewResponse,
} from '@sentris/shared';

import { TemporalService } from '../temporal/temporal.service';

const SAVED_SERVER_OPERATION_TIMEOUT_MS = 150_000;

interface SavedServerDiscoveryResult {
  status?: string;
  catalog?: unknown;
  error?: string;
}

/** Canonical backend boundary for saved-server operations through the worker runtime. */
@Injectable()
export class McpSavedServerRuntimeService {
  constructor(private readonly temporalService: TemporalService) {}

  async discover(runtimeKeyInput: McpRuntimeKey): Promise<McpCatalog> {
    const result = await this.runWorkflow<SavedServerDiscoveryResult>(
      'mcpDiscoveryWorkflow',
      [{ mode: 'saved-server', runtimeKey: McpRuntimeKeySchema.parse(runtimeKeyInput) }],
      'MCP saved-server discovery timed out after 150 seconds',
    );
    if (result.status !== 'completed') {
      throw new Error(`MCP saved-server discovery failed: ${result.error ?? 'unknown failure'}`);
    }
    return McpCatalogSchema.parse(result.catalog);
  }

  async preview(
    runtimeKeyInput: McpRuntimeKey,
    operationInput: McpResourceReadOperation | McpPromptGetOperation,
  ): Promise<McpSavedServerPreviewResponse> {
    const operation =
      operationInput.kind === 'resource-read'
        ? McpResourceReadOperationSchema.parse(operationInput)
        : McpPromptGetOperationSchema.parse(operationInput);
    const result = await this.runWorkflow<unknown>(
      'mcpSavedServerPreviewWorkflow',
      [{ runtimeKey: McpRuntimeKeySchema.parse(runtimeKeyInput), operation }],
      'MCP saved-server preview timed out after 150 seconds',
    );
    return McpSavedServerPreviewResponseSchema.parse(result);
  }

  private async runWorkflow<T>(
    workflowType: string,
    args: unknown[],
    timeoutMessage: string,
  ): Promise<T> {
    const workflow = await this.temporalService.startWorkflow({
      workflowType,
      taskQueue: this.temporalService.getDefaultTaskQueue(),
      args,
    });

    let timeout: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      return (await Promise.race([
        this.temporalService.getWorkflowResult({
          workflowId: workflow.workflowId,
          runId: workflow.runId,
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            timedOut = true;
            reject(new Error(timeoutMessage));
          }, SAVED_SERVER_OPERATION_TIMEOUT_MS);
          timeout.unref?.();
        }),
      ])) as T;
    } catch (error: unknown) {
      if (timedOut) {
        try {
          await this.temporalService.cancelWorkflow({
            workflowId: workflow.workflowId,
            runId: workflow.runId,
          });
        } catch {
          // The timeout remains the primary failure even if Temporal cancellation is unavailable.
        }
      }
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
