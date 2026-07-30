export class RetriableKafkaIngestError extends Error {
  readonly retriable = true;
  readonly originalError: unknown;

  constructor(context: string, error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    super(`${context}: ${detail}`);
    this.name = 'RetriableKafkaIngestError';
    this.originalError = error;
  }
}

export async function runRetriableKafkaIngest<T>(
  context: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    if (error instanceof RetriableKafkaIngestError) {
      throw error;
    }
    throw new RetriableKafkaIngestError(context, error);
  }
}
