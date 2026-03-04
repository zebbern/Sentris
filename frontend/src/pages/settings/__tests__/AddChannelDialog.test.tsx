import { describe, it, expect } from 'bun:test';

// ---------------------------------------------------------------------------
// AddChannelDialog unit tests
// ---------------------------------------------------------------------------
// NOTE: AddChannelDialog uses Radix UI Dialog primitives (<Dialog.Root>,
// <Dialog.Content>, focus-scope, dismissable-layer) which dispatch custom
// events during mount effects. These events are incompatible with jsdom's
// strict Event type checking, causing AggregateErrors that cannot be
// suppressed (React's act() wrapping rethrows them).
//
// The ChannelSettings.test.tsx covers the parent page layout, channel list
// rendering, button presence, and state management. Dialog interaction
// behavior (form validation, create/edit flows, cancel) should be tested
// via E2E tests using Playwright where a real browser handles Radix events.
// ---------------------------------------------------------------------------

describe('AddChannelDialog', () => {
  it.skip('requires Playwright for Radix UI Dialog testing (jsdom incompatible)', () => {
    expect(true).toBe(true);
  });
});
