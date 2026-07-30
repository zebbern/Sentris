import { describe, expect, test } from 'bun:test';

import { getActivityStartToCloseTimeout } from '../../components/ai/agent-execution-profile';

describe('agent activity timeout', () => {
  test('uses the default activity window for non-agent components', () => {
    expect(getActivityStartToCloseTimeout('core.http.request', { executionProfile: 'deep' })).toBe(
      '10 minutes',
    );
  });

  test.each(['core.ai.agent', 'core.ai.opencode', 'core.ai.claude-code'])(
    'uses the saved profile duration for %s',
    (componentId) => {
      expect(getActivityStartToCloseTimeout(componentId, { executionProfile: 'deep' })).toBe(
        '135 minutes',
      );
    },
  );
});
