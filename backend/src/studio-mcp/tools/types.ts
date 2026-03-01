import { Logger } from '@nestjs/common';
import type { TraceEventPayload, WorkflowSchedule } from '@sentris/shared';
import type { AuthContext, ApiKeyPermissions } from '../../auth/types';
import type {
  HumanInputResponseDto,
  ListHumanInputsQueryDto,
  ResolveHumanInputDto,
} from '../../human-inputs/dto/human-inputs.dto';
import type { NodeIODetail, NodeIOSummary } from '../../node-io/node-io.service';
import type {
  CreateScheduleRequestDto,
  UpdateScheduleRequestDto,
} from '../../schedules/dto/schedule.dto';
import type { ScheduleRepositoryFilters } from '../../schedules/repository/schedule.repository';
import type { SecretSummary } from '../../secrets/secrets.repository';
import type {
  CreateSecretInput,
  RotateSecretInput,
  UpdateSecretInput,
} from '../../secrets/secrets.service';
import type {
  ArtifactListResponseDto,
  ArtifactMetadataDto,
  RunArtifactsResponseDto,
} from '../../storage/dto/artifact.dto';
import type {
  TerminalFetchOptions,
  TerminalFetchResult,
  TerminalStreamDescriptor,
} from '../../terminal/terminal-stream.service';
import type { WorkflowsService } from '../../workflows/workflows.service';

export type PermissionPath =
  | 'workflows.list'
  | 'workflows.read'
  | 'workflows.create'
  | 'workflows.update'
  | 'workflows.delete'
  | 'workflows.run'
  | 'runs.read'
  | 'runs.cancel'
  | 'artifacts.read'
  | 'artifacts.delete'
  | 'secrets.list'
  | 'secrets.read'
  | 'secrets.create'
  | 'secrets.update'
  | 'secrets.delete'
  | 'schedules.list'
  | 'schedules.read'
  | 'schedules.create'
  | 'schedules.update'
  | 'schedules.delete'
  | 'human-inputs.read'
  | 'human-inputs.resolve';

export interface ToolResult {
  [x: string]: unknown;
  content: [{ type: 'text'; text: string }, ...{ type: 'text'; text: string }[]];
  isError?: boolean;
}

export interface StudioMcpDeps {
  workflowsService: WorkflowsService;
  traceService?: {
    list(
      runId: string,
      auth?: AuthContext | null,
    ): Promise<{ events: TraceEventPayload[]; cursor?: string }>;
  };
  nodeIOService?: {
    listSummaries(runId: string, organizationId?: string): Promise<NodeIOSummary[]>;
    getNodeIO(runId: string, nodeRef: string, full?: boolean): Promise<NodeIODetail | null>;
  };
  logStreamService?: {
    fetch(
      runId: string,
      auth: AuthContext | null,
      options?: {
        nodeRef?: string;
        stream?: string;
        level?: string;
        limit?: number;
        cursor?: string;
        startTime?: string;
        endTime?: string;
      },
    ): Promise<unknown>;
  };
  terminalStreamService?: {
    listStreams(runId: string): Promise<TerminalStreamDescriptor[]>;
    fetchChunks(runId: string, options?: TerminalFetchOptions): Promise<TerminalFetchResult>;
  };
  artifactsService?: {
    listArtifacts(
      auth: AuthContext | null,
      filters?: {
        workflowId?: string;
        componentId?: string;
        destination?: string;
        search?: string;
        limit?: number;
      },
    ): Promise<ArtifactListResponseDto>;
    listRunArtifacts(auth: AuthContext | null, runId: string): Promise<RunArtifactsResponseDto>;
    downloadArtifact(
      auth: AuthContext | null,
      artifactId: string,
    ): Promise<{ buffer: Buffer; artifact: ArtifactMetadataDto }>;
    deleteArtifact(auth: AuthContext | null, artifactId: string): Promise<void>;
  };
  schedulesService?: {
    list(
      auth: AuthContext | null,
      filters?: ScheduleRepositoryFilters,
    ): Promise<WorkflowSchedule[]>;
    get(auth: AuthContext | null, id: string): Promise<WorkflowSchedule>;
    create(auth: AuthContext | null, dto: CreateScheduleRequestDto): Promise<WorkflowSchedule>;
    update(
      auth: AuthContext | null,
      id: string,
      dto: UpdateScheduleRequestDto,
    ): Promise<WorkflowSchedule>;
    delete(auth: AuthContext | null, id: string): Promise<void>;
    pause(auth: AuthContext | null, id: string): Promise<WorkflowSchedule>;
    resume(auth: AuthContext | null, id: string): Promise<WorkflowSchedule>;
    trigger(auth: AuthContext | null, id: string): Promise<void>;
  };
  secretsService?: {
    listSecrets(auth: AuthContext | null): Promise<SecretSummary[]>;
    createSecret(auth: AuthContext | null, input: CreateSecretInput): Promise<SecretSummary>;
    rotateSecret(
      auth: AuthContext | null,
      secretId: string,
      input: RotateSecretInput,
    ): Promise<SecretSummary>;
    updateSecret(
      auth: AuthContext | null,
      secretId: string,
      input: UpdateSecretInput,
    ): Promise<SecretSummary>;
    deleteSecret(auth: AuthContext | null, secretId: string): Promise<void>;
  };
  humanInputsService?: {
    list(
      query?: ListHumanInputsQueryDto,
      organizationId?: string,
    ): Promise<HumanInputResponseDto[]>;
    getById(id: string, organizationId?: string): Promise<HumanInputResponseDto>;
    resolve(
      id: string,
      dto: ResolveHumanInputDto,
      organizationId?: string,
      auth?: AuthContext | null,
    ): Promise<HumanInputResponseDto>;
  };
}

const logger = new Logger('StudioMcpTools');

/**
 * Check whether the caller's API key permits the given action.
 * Non-API-key callers (e.g. internal service tokens) are always allowed.
 */
export function checkPermission(
  auth: AuthContext,
  permission: PermissionPath,
):
  | { allowed: true }
  | { allowed: false; error: { content: { type: 'text'; text: string }[]; isError: true } } {
  const perms = auth.apiKeyPermissions;
  if (!perms) return { allowed: true }; // non-API-key auth → unrestricted

  const [scope, action] = permission.split('.') as [keyof ApiKeyPermissions, string];
  const scopePerms = perms[scope] as Record<string, boolean> | undefined;
  if (!scopePerms || !scopePerms[action]) {
    return {
      allowed: false,
      error: {
        content: [
          {
            type: 'text' as const,
            text: `Permission denied: API key lacks '${permission}' permission.`,
          },
        ],
        isError: true,
      },
    };
  }
  return { allowed: true };
}

export function errorResult(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`Studio MCP tool error: ${message}`);
  return {
    content: [{ type: 'text' as const, text: `Error: ${message}` }],
    isError: true,
  };
}

export function jsonResult(data: unknown): ToolResult {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}
