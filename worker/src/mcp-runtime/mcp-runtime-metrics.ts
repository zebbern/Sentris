export type McpRuntimeMetricOutcome = 'success' | 'failure' | 'stale' | 'ambiguous';
export type McpRuntimeOperationKind =
  | 'acquire'
  | 'discover'
  | 'invoke'
  | 'read'
  | 'get-prompt'
  | 'health'
  | 'renew'
  | 'release';

export interface McpRuntimeMetricsSnapshot {
  ownedRuntimes: number;
  selfFences: number;
  operations: Readonly<Record<string, number>>;
}

/** Dependency-free process metrics. Labels are closed enums and never include tenant/runtime data. */
export class McpRuntimeMetrics {
  private ownedRuntimes = 0;
  private selfFences = 0;
  private readonly operations = new Map<string, number>();

  recordOperation(kind: McpRuntimeOperationKind, outcome: McpRuntimeMetricOutcome): void {
    const key = `${kind}:${outcome}`;
    this.operations.set(key, (this.operations.get(key) ?? 0) + 1);
  }

  recordSelfFence(): void {
    this.selfFences += 1;
  }

  setOwnedRuntimes(count: number): void {
    this.ownedRuntimes = Math.max(0, Math.trunc(count));
  }

  snapshot(): McpRuntimeMetricsSnapshot {
    return {
      ownedRuntimes: this.ownedRuntimes,
      selfFences: this.selfFences,
      operations: Object.freeze(Object.fromEntries(this.operations)),
    };
  }
}
