import { describe, expect, test } from 'bun:test';

import { getProviderDeclaredModelError, assertProviderModelFinished } from '../model-finish';

describe('provider-declared model finish', () => {
  test('classifies only the normalized error finish reason', () => {
    expect(
      getProviderDeclaredModelError({ finishReason: 'stop', rawFinishReason: 'error' }),
    ).toBeNull();
    expect(
      getProviderDeclaredModelError({ finishReason: 'ERROR', rawFinishReason: 'error' }),
    ).toBeNull();
  });

  test('throws a bounded diagnostic and omits unsafe raw provider text', () => {
    const unsafeReason = `bad reason\u001b[31m${'x'.repeat(300)}`;

    expect(() =>
      assertProviderModelFinished(
        { finishReason: 'error', rawFinishReason: unsafeReason },
        'AI Agent',
      ),
    ).toThrow('AI Agent model generation failed');

    const error = getProviderDeclaredModelError(
      { finishReason: 'error', rawFinishReason: unsafeReason },
      'AI Agent',
    );
    expect(error?.message).toBe('AI Agent model generation failed');
    expect(error?.message).not.toContain('\u001b');
    expect(error?.message.length).toBeLessThan(200);
  });
});
