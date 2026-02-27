/**
 * Kafka Topic Resolver
 *
 * Provides instance-aware topic naming for multi-instance deployments.
 * When instanceId is set, topics are namespaced with the instance number.
 *
 * Topic names and instance ID are provided via TopicResolverConfig,
 * typically sourced from the KafkaConfig namespace (ConfigService).
 */

export interface TopicResolverConfig {
  instanceId?: string;
  enableInstanceSuffix?: boolean;
  topics?: {
    logs?: string;
    events?: string;
    agentTrace?: string;
    nodeIo?: string;
  };
}

export class KafkaTopicResolver {
  private instanceId: string | undefined;
  private enableInstanceSuffix: boolean;
  private topics: Required<NonNullable<TopicResolverConfig['topics']>>;

  constructor(config: TopicResolverConfig = {}) {
    this.instanceId = config.instanceId;
    // Enable instance suffix only if instanceId is set
    this.enableInstanceSuffix = config.enableInstanceSuffix ?? Boolean(this.instanceId);
    this.topics = {
      logs: config.topics?.logs ?? 'telemetry.logs',
      events: config.topics?.events ?? 'telemetry.events',
      agentTrace: config.topics?.agentTrace ?? 'telemetry.agent-trace',
      nodeIo: config.topics?.nodeIo ?? 'telemetry.node-io',
    };
  }

  /**
   * Resolve topic name with instance suffix if applicable
   * @param baseTopic The base topic name
   * @returns The topic name with instance suffix (if enabled)
   */
  resolveTopic(baseTopic: string): string {
    if (!this.enableInstanceSuffix || !this.instanceId) {
      return baseTopic;
    }
    return `${baseTopic}.instance-${this.instanceId}`;
  }

  /**
   * Get logs topic
   */
  getLogsTopic(): string {
    return this.resolveTopic(this.topics.logs);
  }

  /**
   * Get events topic
   */
  getEventsTopic(): string {
    return this.resolveTopic(this.topics.events);
  }

  /**
   * Get agent trace topic
   */
  getAgentTraceTopic(): string {
    return this.resolveTopic(this.topics.agentTrace);
  }

  /**
   * Get node I/O topic
   */
  getNodeIOTopic(): string {
    return this.resolveTopic(this.topics.nodeIo);
  }

  /**
   * Check if instance isolation is enabled
   */
  isInstanceIsolated(): boolean {
    return this.enableInstanceSuffix;
  }

  /**
   * Get instance ID (if set)
   */
  getInstanceId(): string | undefined {
    return this.instanceId;
  }
}

// Singleton instance
let resolver: KafkaTopicResolver;

/**
 * Get or create the singleton topic resolver
 */
export function getTopicResolver(config?: TopicResolverConfig): KafkaTopicResolver {
  if (!resolver) {
    resolver = new KafkaTopicResolver(config);
  }
  return resolver;
}

/**
 * Reset the singleton (useful for testing)
 */
export function resetTopicResolver(): void {
  resolver = undefined!;
}
