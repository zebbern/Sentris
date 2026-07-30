/**
 * Node I/O is required operational telemetry, but a publish failure after a
 * component has completed must not reclassify or re-run that component. Kafka's
 * idempotent producer performs its own retries; this boundary only handles the
 * exhausted/degraded case and leaves worker readiness to stop new work.
 */
export async function recordNodeIoWithoutChangingExecution(
  record: () => Promise<void> | undefined,
  logger: Pick<Console, 'error'> = console,
): Promise<void> {
  try {
    await record();
  } catch (error: unknown) {
    logger.error(
      `[NodeIO] Idempotent Kafka delivery retries were exhausted; preserving the component result: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
