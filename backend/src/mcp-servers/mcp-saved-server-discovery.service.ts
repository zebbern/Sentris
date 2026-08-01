import { Injectable } from '@nestjs/common';
import {
  McpCatalogSchema,
  McpRuntimeKeySchema,
  type McpCatalog,
  type McpRuntimeKey,
} from '@sentris/shared';

import { TemporalService } from '../temporal/temporal.service';

const SAVED_SERVER_DISCOVERY_TIMEOUT_MS = 150_000;

interface SavedServerDiscoveryResult {
  status?: string;
  catalog?: unknown;
  error?: string;
}

/** Canonical backend boundary for complete saved-server discovery via the worker runtime. */
@Injectable()
export class McpSavedServerDiscoveryService {
  constructor(private readonly temporalService: TemporalService) {}

  async discover(runtimeKeyInput: McpRuntimeKey): Promise<McpCatalog> {
    const runtimeKey = McpRuntimeKeySchema.parse(runtimeKeyInput);
    const workflow = await this.temporalService.startWorkflow({
      workflowType: 'mcpDiscoveryWorkflow',
      taskQueue: this.temporalService.getDefaultTaskQueue(),
      args: [{ mode: 'saved-server', runtimeKey }],
    });

    let timeout: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      const result = (await Promise.race([
        this.temporalService.getWorkflowResult({
          workflowId: workflow.workflowId,
          runId: workflow.runId,
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            timedOut = true;
            reject(new Error('MCP saved-server discovery timed out after 150 seconds'));
          }, SAVED_SERVER_DISCOVERY_TIMEOUT_MS);
          timeout.unref?.();
        }),
      ])) as SavedServerDiscoveryResult;

      if (result.status !== 'completed') {
        throw new Error(`MCP saved-server discovery failed: ${result.error ?? 'unknown failure'}`);
      }
      return McpCatalogSchema.parse(result.catalog);
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
