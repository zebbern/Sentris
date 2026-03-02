import { describe, expect, it } from 'bun:test';

import { getTriggerDisplay } from '../triggerDisplay';

describe('getTriggerDisplay', () => {
  it('returns manual trigger display', () => {
    const result = getTriggerDisplay('manual');
    expect(result.icon).toBe('👤');
    expect(result.variant).toBe('secondary');
    expect(result.label).toBe('Manual run');
  });

  it('returns schedule trigger display', () => {
    const result = getTriggerDisplay('schedule');
    expect(result.icon).toBe('🕐');
    expect(result.variant).toBe('outline');
    expect(result.label).toBe('Scheduled run');
  });

  it('returns api trigger display', () => {
    const result = getTriggerDisplay('api');
    expect(result.icon).toBe('🌐');
    expect(result.variant).toBe('outline');
    expect(result.label).toBe('API trigger');
  });

  it('returns webhook trigger display', () => {
    const result = getTriggerDisplay('webhook');
    expect(result.icon).toBe('🔗');
    expect(result.variant).toBe('default');
    expect(result.label).toBe('Webhook trigger');
  });

  it('uses custom label when provided', () => {
    const result = getTriggerDisplay('manual', 'My Custom Run');
    expect(result.label).toBe('My Custom Run');
    expect(result.icon).toBe('👤');
  });

  it('uses fallback label when custom label is empty', () => {
    const result = getTriggerDisplay('schedule', '');
    expect(result.label).toBe('Scheduled run');
  });

  it('uses fallback label when custom label is whitespace', () => {
    const result = getTriggerDisplay('api', '   ');
    expect(result.label).toBe('API trigger');
  });

  it('falls back to manual for null triggerType', () => {
    const result = getTriggerDisplay(null);
    expect(result.icon).toBe('👤');
    expect(result.variant).toBe('secondary');
    expect(result.label).toBe('Manual run');
  });

  it('falls back to manual for undefined triggerType', () => {
    const result = getTriggerDisplay(undefined);
    expect(result.icon).toBe('👤');
    expect(result.variant).toBe('secondary');
    expect(result.label).toBe('Manual run');
  });

  it('uses custom label even with null trigger type', () => {
    const result = getTriggerDisplay(null, 'Custom');
    expect(result.label).toBe('Custom');
    expect(result.icon).toBe('👤');
  });
});
