import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { TERMINAL_STATUSES } from '@sentris/shared';

import type { AuthContext } from '../auth/types';
import { requireOrganizationId } from '../common/auth/require-organization-id';
import type { NodeIORecord, WorkflowRunRecord } from '../database/schema';
import { NodeIORepository } from '../node-io/node-io.repository';
import { ScopesService } from '../scopes/scopes.service';
import { StorageService } from '../storage/storage.service';
import { WorkflowRunRepository } from '../workflows/repository/workflow-run.repository';
import { WorkflowVersionRepository } from '../workflows/repository/workflow-version.repository';
import { extractAssets, RECON_COMPONENT_IDS, type AssetType } from './asset-extractor';

export type AssetObservationStatus = 'observed' | 'not-observed' | 'not-scanned';
export type AssetComparisonChange = 'new' | 'unchanged' | 'missing';

export interface AssetRunComparisonItem {
  assetType: AssetType;
  assetValue: string;
  sourceComponentIds: string[];
  baselineObserved: boolean;
  currentObserved: boolean;
  observationStatus: AssetObservationStatus;
  change: AssetComparisonChange;
}

export interface AssetRunCoverage {
  completedComponents: string[];
  failedComponents: string[];
}

export interface AssetRunComparison {
  scopeId: string;
  workflowId: string;
  baselineRunId: string;
  currentRunId: string;
  baselineCoverage: AssetRunCoverage;
  currentCoverage: AssetRunCoverage;
  summary: {
    observed: number;
    notObserved: number;
    notScanned: number;
  };
  items: AssetRunComparisonItem[];
}

interface RunObservations {
  observations: Map<
    string,
    {
      assetType: AssetType;
      assetValue: string;
      sourceComponentIds: Set<string>;
      coverageKeys: Set<string>;
    }
  >;
  coverage: AssetRunCoverage;
  completedCoverageKeys: Set<string>;
}

interface ComparisonWorkflowGraph {
  nodes: {
    id: string;
    type: string;
    data?: { config?: { params?: Record<string, unknown> } };
  }[];
}

@Injectable()
export class AssetRunComparisonService {
  constructor(
    private readonly scopesService: ScopesService,
    private readonly nodeIORepository: NodeIORepository,
    private readonly workflowRunRepository: WorkflowRunRepository,
    private readonly workflowVersionRepository: WorkflowVersionRepository,
    private readonly storage: StorageService,
  ) {}

  async compare(
    auth: AuthContext | null,
    scopeId: string,
    input: { baselineRunId: string; currentRunId: string },
  ): Promise<AssetRunComparison> {
    if (input.baselineRunId === input.currentRunId) {
      throw new BadRequestException('Choose two different runs to compare');
    }

    const organizationId = requireOrganizationId(auth);
    await this.scopesService.getScope(auth, scopeId);

    const [baselineRun, currentRun] = await Promise.all([
      this.workflowRunRepository.findByRunId(input.baselineRunId, { organizationId }),
      this.workflowRunRepository.findByRunId(input.currentRunId, { organizationId }),
    ]);
    this.assertComparableRun(baselineRun, scopeId, 'baseline');
    this.assertComparableRun(currentRun, scopeId, 'current');

    if (baselineRun.workflowId !== currentRun.workflowId) {
      throw new BadRequestException('Asset comparison requires runs of the same workflow');
    }

    const versionIds = [
      ...new Set(
        [baselineRun.workflowVersionId, currentRun.workflowVersionId].filter(
          (versionId): versionId is string => typeof versionId === 'string',
        ),
      ),
    ];
    const versions =
      versionIds.length > 0
        ? await this.workflowVersionRepository.findByIds(versionIds, { organizationId })
        : [];
    const graphByVersionId = new Map(versions.map((version) => [version.id, version.graph]));

    const [baseline, current] = await Promise.all([
      this.loadRunObservations(
        input.baselineRunId,
        organizationId,
        baselineRun.workflowVersionId
          ? graphByVersionId.get(baselineRun.workflowVersionId)
          : undefined,
      ),
      this.loadRunObservations(
        input.currentRunId,
        organizationId,
        currentRun.workflowVersionId
          ? graphByVersionId.get(currentRun.workflowVersionId)
          : undefined,
      ),
    ]);

    const allKeys = new Set([...baseline.observations.keys(), ...current.observations.keys()]);
    const items = [...allKeys]
      .map((key): AssetRunComparisonItem => {
        const baselineAsset = baseline.observations.get(key);
        const currentAsset = current.observations.get(key);
        const asset = currentAsset ?? baselineAsset!;
        const sourceComponentIds = new Set([
          ...(baselineAsset?.sourceComponentIds ?? []),
          ...(currentAsset?.sourceComponentIds ?? []),
        ]);

        if (currentAsset) {
          return {
            assetType: asset.assetType,
            assetValue: asset.assetValue,
            sourceComponentIds: [...sourceComponentIds].sort(),
            baselineObserved: Boolean(baselineAsset),
            currentObserved: true,
            observationStatus: 'observed',
            change: baselineAsset ? 'unchanged' : 'new',
          };
        }

        const comparableScannerRan = [...(baselineAsset?.coverageKeys ?? [])].some((coverageKey) =>
          current.completedCoverageKeys.has(coverageKey),
        );
        return {
          assetType: asset.assetType,
          assetValue: asset.assetValue,
          sourceComponentIds: [...sourceComponentIds].sort(),
          baselineObserved: true,
          currentObserved: false,
          observationStatus: comparableScannerRan ? 'not-observed' : 'not-scanned',
          change: 'missing',
        };
      })
      .sort(
        (left, right) =>
          left.assetType.localeCompare(right.assetType) ||
          left.assetValue.localeCompare(right.assetValue),
      );

    return {
      scopeId,
      workflowId: baselineRun.workflowId,
      baselineRunId: input.baselineRunId,
      currentRunId: input.currentRunId,
      baselineCoverage: baseline.coverage,
      currentCoverage: current.coverage,
      summary: {
        observed: items.filter((item) => item.observationStatus === 'observed').length,
        notObserved: items.filter((item) => item.observationStatus === 'not-observed').length,
        notScanned: items.filter((item) => item.observationStatus === 'not-scanned').length,
      },
      items,
    };
  }

  private assertComparableRun(
    run: WorkflowRunRecord | undefined,
    scopeId: string,
    label: string,
  ): asserts run is WorkflowRunRecord {
    if (!run) {
      throw new NotFoundException(`${label} run not found`);
    }
    if (run.scopeId !== scopeId) {
      throw new BadRequestException(`${label} run does not belong to the selected target`);
    }
    if (!run.status || !(TERMINAL_STATUSES as readonly string[]).includes(run.status)) {
      throw new BadRequestException(`${label} run must be complete before comparison`);
    }
  }

  private async loadRunObservations(
    runId: string,
    organizationId: string,
    graph: ComparisonWorkflowGraph | undefined,
  ): Promise<RunObservations> {
    const rows = await this.nodeIORepository.listByRunId(runId, organizationId);
    if (rows.length === 0) {
      throw new ServiceUnavailableException(`Observation data is unavailable for run ${runId}`);
    }

    const completedComponents = new Set<string>();
    const completedCoverageKeys = new Set<string>();
    const failedComponents = new Set<string>();
    const observations: RunObservations['observations'] = new Map();

    for (const row of rows) {
      if (!RECON_COMPONENT_IDS.has(row.componentId)) continue;
      if (row.status !== 'completed') {
        if (row.status === 'failed') failedComponents.add(row.componentId);
        continue;
      }

      completedComponents.add(row.componentId);
      const [inputs, outputs] = await Promise.all([
        this.resolveInputs(row, runId),
        this.resolveOutputs(row, runId),
      ]);
      const coverageKey = this.buildCoverageKey(row, inputs, graph);
      if (coverageKey) completedCoverageKeys.add(coverageKey);
      const assets = extractAssets({
        componentId: row.componentId,
        nodeRef: row.nodeRef,
        runId,
        outputs,
      });
      for (const asset of assets) {
        const key = JSON.stringify([asset.assetType, asset.assetValue]);
        const existing = observations.get(key);
        if (existing) {
          existing.sourceComponentIds.add(asset.sourceComponentId);
          if (coverageKey) existing.coverageKeys.add(coverageKey);
        } else {
          observations.set(key, {
            assetType: asset.assetType,
            assetValue: asset.assetValue,
            sourceComponentIds: new Set([asset.sourceComponentId]),
            coverageKeys: new Set(coverageKey ? [coverageKey] : []),
          });
        }
      }
    }

    return {
      observations,
      completedCoverageKeys,
      coverage: {
        completedComponents: [...completedComponents].sort(),
        failedComponents: [...failedComponents].sort(),
      },
    };
  }

  private buildCoverageKey(
    row: Pick<NodeIORecord, 'componentId' | 'nodeRef'>,
    inputs: Record<string, unknown> | null,
    graph: ComparisonWorkflowGraph | undefined,
  ): string | null {
    if (!inputs) return null;

    const graphNode = graph?.nodes.find((node) => node.id === row.nodeRef);
    const parameterValues = graphNode?.data?.config?.params;
    const surfaceInputs =
      graphNode?.type === row.componentId &&
      parameterValues &&
      typeof parameterValues === 'object' &&
      !Array.isArray(parameterValues)
        ? Object.fromEntries(
            Object.entries(inputs).filter(([key]) => !Object.hasOwn(parameterValues, key)),
          )
        : inputs;

    return canonicalJson([row.componentId, row.nodeRef, surfaceInputs]);
  }

  private async resolveInputs(
    row: Pick<NodeIORecord, 'inputs' | 'inputsSpilled' | 'inputsStorageRef'>,
    runId: string,
  ): Promise<Record<string, unknown> | null> {
    if (!row.inputsSpilled) return row.inputs;
    return this.downloadObservationPayload(row.inputsStorageRef, runId);
  }

  private async resolveOutputs(
    row: Pick<NodeIORecord, 'outputs' | 'outputsSpilled' | 'outputsStorageRef'>,
    runId: string,
  ): Promise<Record<string, unknown> | null> {
    if (!row.outputsSpilled) return row.outputs;
    return this.downloadObservationPayload(row.outputsStorageRef, runId);
  }

  private async downloadObservationPayload(
    storageRef: string | null,
    runId: string,
  ): Promise<Record<string, unknown>> {
    if (!storageRef) {
      throw new ServiceUnavailableException(`Observation data is unavailable for run ${runId}`);
    }
    try {
      const payload = JSON.parse(
        (await this.storage.downloadFile(storageRef)).toString('utf8'),
      ) as unknown;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('Observation payload must be an object');
      }
      return payload as Record<string, unknown>;
    } catch {
      throw new ServiceUnavailableException(`Observation data is unavailable for run ${runId}`);
    }
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
