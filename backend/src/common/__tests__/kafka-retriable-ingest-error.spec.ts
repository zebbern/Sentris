import { describe, expect, it } from 'bun:test';

import {
  RetriableKafkaIngestError,
  runRetriableKafkaIngest,
} from '../kafka-retriable-ingest-error';

describe('runRetriableKafkaIngest', () => {
  it('marks projection failures retryable without exposing the raw error as a cause', async () => {
    const databaseError = new Error('database unavailable');

    let thrown: unknown;
    try {
      await runRetriableKafkaIngest('trace topic[1]@42', async () => {
        throw databaseError;
      });
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RetriableKafkaIngestError);
    expect(thrown).toMatchObject({
      name: 'RetriableKafkaIngestError',
      message: 'trace topic[1]@42: database unavailable',
      retriable: true,
      originalError: databaseError,
    });
    expect((thrown as Error & { cause?: unknown }).cause).toBeUndefined();
  });

  it('does not wrap an already retryable ingest error again', async () => {
    const error = new RetriableKafkaIngestError(
      'trace topic[1]@42',
      new Error('database unavailable'),
    );

    await expect(
      runRetriableKafkaIngest('outer context', async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });
});
