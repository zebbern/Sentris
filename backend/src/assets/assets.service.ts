import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import type { AuthContext } from '../auth/types';
import { requireOrganizationId } from '../common/auth/require-organization-id';
import type { NewAssetRecord, NodeIORecord } from '../database/schema';
import { NodeIORepository } from '../node-io/node-io.repository';
import { ScopesService } from '../scopes/scopes.service';
import { StorageService } from '../storage/storage.service';
import { WorkflowRunRepository } from '../workflows/repository/workflow-run.repository';
import { extractAssets, RECON_COMPONENT_IDS, type AssetType } from './asset-extractor';
import { AssetInventoryRepository } from './assets.repository';
import type { AssetResponse } from './dto/assets.dto';

/** Payload emitted on the `asset.nodeio.completed` event. */
export interface AssetNodeIoCompletedEvent {
  runId: string;
  nodeRef: string;
  componentId?: string;
}

@Injectable()
export class AssetInventoryService {
  private readonly logger = new Logger(AssetInventoryService.name);

  constructor(
    private readonly repository: AssetInventoryRepository,
    private readonly nodeIORepository: NodeIORepository,
    private readonly workflowRunRepository: WorkflowRunRepository,
    private readonly storage: StorageService,
    private readonly scopesService: ScopesService,
  ) {}

  /**
   * Ingest recon assets discovered by a completed node execution into the
   * per-target asset inventory. Mirrors `TicketingListenerService`: the
   * whole body is guarded so a failure here never breaks the node-io write
   * path that emitted the event.
   */
  @OnEvent('asset.nodeio.completed', { async: true })
  async onNodeIoCompleted(event: AssetNodeIoCompletedEvent): Promise<void> {
    try {
      if (event.componentId && !RECON_COMPONENT_IDS.has(event.componentId)) {
        return;
      }

      const row = await this.nodeIORepository.findByRunAndNode(event.runId, event.nodeRef);
      if (!row) return;
      if (!RECON_COMPONENT_IDS.has(row.componentId)) return;

      const run = await this.workflowRunRepository.findByRunId(event.runId);
      if (!run?.organizationId || !run?.scopeId) return;

      const outputs = await this.resolveOutputs(row);
      const extracted = extractAssets({
        componentId: row.componentId,
        nodeRef: event.nodeRef,
        runId: event.runId,
        outputs,
      });
      if (extracted.length === 0) return;

      const records: NewAssetRecord[] = extracted.map((asset) => ({
        organizationId: run.organizationId!,
        scopeId: run.scopeId!,
        assetType: asset.assetType,
        assetValue: asset.assetValue,
        firstSeenRunId: event.runId,
        lastSeenRunId: event.runId,
        sourceComponentId: asset.sourceComponentId,
        metadata: asset.metadata,
      }));

      await this.repository.upsertMany(records);
    } catch (err) {
      this.logger.error(
        `Failed to ingest assets for run=${event.runId} node=${event.nodeRef}: ${err}`,
      );
    }
  }

  async listAssets(
    auth: AuthContext | null,
    scopeId: string,
    opts: { assetType?: AssetType; limit?: number } = {},
  ): Promise<AssetResponse[]> {
    const organizationId = requireOrganizationId(auth);
    // Validate the scope belongs to the caller's organization (404s otherwise).
    await this.scopesService.getScope(auth, scopeId);
    const rows = await this.repository.listByScope(scopeId, organizationId, opts);
    return rows.map((record) => ({
      id: record.id,
      organizationId: record.organizationId,
      scopeId: record.scopeId,
      assetType: record.assetType,
      assetValue: record.assetValue,
      firstSeenAt: record.firstSeenAt.toISOString(),
      lastSeenAt: record.lastSeenAt.toISOString(),
      firstSeenRunId: record.firstSeenRunId,
      lastSeenRunId: record.lastSeenRunId,
      sourceComponentId: record.sourceComponentId,
      metadata: record.metadata ?? {},
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    }));
  }

  /** Resolve a node's full outputs, fetching from object storage when spilled. */
  private async resolveOutputs(
    row: Pick<NodeIORecord, 'outputs' | 'outputsSpilled' | 'outputsStorageRef'>,
  ): Promise<Record<string, unknown> | null> {
    if (row.outputsSpilled && row.outputsStorageRef) {
      try {
        const buffer = await this.storage.downloadFile(row.outputsStorageRef);
        return JSON.parse(buffer.toString('utf8')) as Record<string, unknown>;
      } catch (err) {
        this.logger.warn(`Failed to fetch spilled outputs from ${row.outputsStorageRef}: ${err}`);
        return row.outputs;
      }
    }
    return row.outputs;
  }
}
