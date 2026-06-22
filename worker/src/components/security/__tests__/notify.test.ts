import { describe, expect, it } from 'bun:test';
import { buildNotifyArgs } from '../notify';

describe('notify CLI args', () => {
  it('maps provider filters and silent mode to notify flags', () => {
    const args = buildNotifyArgs({
      messagesFile: '/inputs/messages.txt',
      providerConfigFile: '/inputs/provider-config.yaml',
      providerIds: ['slack', 'discord'],
      bulk: true,
      silent: true,
      verbose: false,
    });

    expect(args).toContain('-i');
    expect(args).toContain('/inputs/messages.txt');
    expect(args).toContain('-provider-config');
    expect(args).toContain('-provider');
    expect(args).toContain('slack,discord');
    expect(args).toContain('-bulk');
    expect(args).toContain('-silent');
    expect(args).not.toContain('-verbose');
  });

  it('prefers verbose over silent when both are requested', () => {
    const args = buildNotifyArgs({
      messagesFile: '/inputs/messages.txt',
      providerConfigFile: '/inputs/provider-config.yaml',
      bulk: false,
      silent: true,
      verbose: true,
    });

    expect(args).toContain('-verbose');
    expect(args).not.toContain('-silent');
  });
});
