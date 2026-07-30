import { describe, expect, it, mock } from 'bun:test';

import { recordNodeIoWithoutChangingExecution } from '../node-io-delivery';

describe('recordNodeIoWithoutChangingExecution', () => {
  it('preserves a completed component result when exhausted telemetry delivery fails', async () => {
    const logger = { error: mock(() => undefined) };

    await expect(
      recordNodeIoWithoutChangingExecution(async () => {
        throw new Error('Kafka unavailable');
      }, logger),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('preserving the component result'),
    );
  });
});
