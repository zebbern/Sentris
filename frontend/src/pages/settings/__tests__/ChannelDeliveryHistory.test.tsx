import { describe, it, beforeEach, afterEach, expect, mock } from 'bun:test';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { NotificationDelivery } from '@sentris/shared';

// ---------------------------------------------------------------------------
// Mutable mock state
// ---------------------------------------------------------------------------

let mockDeliveries: NotificationDelivery[] = [];
let mockIsLoading = false;
let mockError: Error | null = null;
const mockRefetch = mock(() => Promise.resolve());
const mockResendMutate = mock((_vars: any, _opts?: any) => {});
let mockResendIsPending = false;
let mockResendVariables: { channelId: string; deliveryId: string } | undefined;

const mockToast = mock(() => ({ id: 'toast-1' }));
const mockDismiss = mock();

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makeDelivery(overrides: Partial<NotificationDelivery> = {}): NotificationDelivery {
  return {
    id: overrides.id ?? 'del-1',
    channelId: overrides.channelId ?? 'ch-1',
    runId: overrides.runId ?? 'run-1',
    eventType: overrides.eventType ?? 'run.failed',
    status: overrides.status ?? 'sent',
    payload: overrides.payload ?? { runId: 'run-1', status: 'FAILED' },
    errorMessage: overrides.errorMessage ?? null,
    durationMs: overrides.durationMs ?? null,
    responseStatus: overrides.responseStatus ?? null,
    responseBody: overrides.responseBody ?? null,
    createdAt: overrides.createdAt ?? '2026-03-04T12:00:00.000Z',
    sentAt: overrides.sentAt ?? '2026-03-04T12:00:00.150Z',
  };
}

// ---------------------------------------------------------------------------
// Module mocks (must precede component import)
// ---------------------------------------------------------------------------

mock.module('@/hooks/queries/useNotificationChannelQueries', () => ({
  useNotificationChannelDeliveries: () => ({
    data: mockDeliveries.length > 0 ? mockDeliveries : undefined,
    isLoading: mockIsLoading,
    error: mockError,
    refetch: mockRefetch,
  }),
  useResendDelivery: () => ({
    mutate: mockResendMutate,
    isPending: mockResendIsPending,
    variables: mockResendVariables,
  }),
}));

mock.module('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mockToast, dismiss: mockDismiss }),
}));

mock.module('@/lib/humanizeApiError', () => ({
  humanizeApiError: (err: unknown) => (err instanceof Error ? err.message : 'Unknown error'),
}));

// Mock Sheet to just render children (Radix Dialog doesn't work in jsdom)
mock.module('@/components/ui/sheet', () => ({
  Sheet: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? children : null,
  SheetContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="sheet-content">{children}</div>
  ),
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  SheetDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

// Import AFTER all mock.module calls
import { ChannelDeliveryHistory } from '../ChannelDeliveryHistory';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetMocks() {
  mockDeliveries = [];
  mockIsLoading = false;
  mockError = null;
  mockResendIsPending = false;
  mockResendVariables = undefined;
  mockRefetch.mockClear();
  mockResendMutate.mockClear();
  mockToast.mockClear();
  mockDismiss.mockClear();
}

function renderComponent(overrides: { channelId?: string; channelName?: string } = {}) {
  return render(
    <ChannelDeliveryHistory
      channelId={overrides.channelId ?? 'ch-1'}
      channelName={overrides.channelName ?? 'Test Channel'}
      open={true}
      onOpenChange={() => {}}
    />,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChannelDeliveryHistory', () => {
  beforeEach(() => {
    cleanup();
    resetMocks();
  });

  afterEach(cleanup);

  // ── Latency badge ─────────────────────────────────────────────

  it('renders latency badge when durationMs is present', () => {
    mockDeliveries = [makeDelivery({ id: 'del-1', durationMs: 150 })];
    renderComponent();

    expect(screen.getByText('150ms')).toBeTruthy();
  });

  it('does not render latency badge when durationMs is null', () => {
    mockDeliveries = [makeDelivery({ id: 'del-1', durationMs: null })];
    renderComponent();

    expect(screen.queryByText(/\d+ms/)).toBeNull();
  });

  // ── Resend button ─────────────────────────────────────────────

  it('renders Resend button only on expanded failed deliveries', () => {
    mockDeliveries = [
      makeDelivery({ id: 'del-failed', status: 'failed', errorMessage: 'Slack error' }),
      makeDelivery({ id: 'del-sent', status: 'sent' }),
      makeDelivery({ id: 'del-pending', status: 'pending' }),
    ];
    renderComponent();

    // Expand all accordion items by clicking triggers
    const triggers = screen.getAllByRole('button', { expanded: false });
    triggers.forEach((t) => fireEvent.click(t));

    // Only one Resend button should be present (for the failed delivery)
    const resendButtons = screen.getAllByText('Resend');
    expect(resendButtons.length).toBe(1);
  });

  it('does not render Resend button for sent delivery when expanded', () => {
    mockDeliveries = [makeDelivery({ id: 'del-sent', status: 'sent' })];
    renderComponent();

    // Expand the accordion item
    const trigger = screen.getByRole('button', { expanded: false });
    fireEvent.click(trigger);

    expect(screen.queryByText('Resend')).toBeNull();
  });

  it('does not render Resend button for pending delivery when expanded', () => {
    mockDeliveries = [makeDelivery({ id: 'del-pending', status: 'pending' })];
    renderComponent();

    // Expand the accordion item
    const trigger = screen.getByRole('button', { expanded: false });
    fireEvent.click(trigger);

    expect(screen.queryByText('Resend')).toBeNull();
  });

  it('calls resend mutation with correct channelId and deliveryId', () => {
    mockDeliveries = [
      makeDelivery({ id: 'del-failed', channelId: 'ch-1', status: 'failed', errorMessage: 'err' }),
    ];
    renderComponent({ channelId: 'ch-1' });

    // Expand the accordion item to reveal the Resend button
    const trigger = screen.getByRole('button', { expanded: false });
    fireEvent.click(trigger);

    const resendButton = screen.getByText('Resend');
    fireEvent.click(resendButton);

    expect(mockResendMutate).toHaveBeenCalledTimes(1);
    const [vars] = (mockResendMutate as any).mock.calls[0];
    expect(vars.channelId).toBe('ch-1');
    expect(vars.deliveryId).toBe('del-failed');
  });

  // ── Expandable detail panel ───────────────────────────────────

  it('shows request payload as JSON when expanded', () => {
    const payload = { runId: 'run-999', status: 'FAILED' };
    mockDeliveries = [makeDelivery({ id: 'del-1', payload })];
    renderComponent();

    // Expand the accordion item
    const trigger = screen.getByRole('button', { expanded: false });
    fireEvent.click(trigger);

    const jsonText = screen.getByText(/"runId": "run-999"/);
    expect(jsonText).toBeTruthy();
  });

  it('shows response status when expanded and responseStatus is present', () => {
    mockDeliveries = [makeDelivery({ id: 'del-1', responseStatus: 200, responseBody: 'ok' })];
    renderComponent();

    // Expand the accordion item
    const trigger = screen.getByRole('button', { expanded: false });
    fireEvent.click(trigger);

    expect(screen.getByText('HTTP 200')).toBeTruthy();
  });

  it('shows response body when expanded and responseBody is present', () => {
    mockDeliveries = [makeDelivery({ id: 'del-1', responseStatus: 200, responseBody: 'all_good' })];
    renderComponent();

    // Expand the accordion item
    const trigger = screen.getByRole('button', { expanded: false });
    fireEvent.click(trigger);

    expect(screen.getByText('all_good')).toBeTruthy();
  });

  it('shows "No response data captured" when expanded and both are null', () => {
    mockDeliveries = [makeDelivery({ id: 'del-1', responseStatus: null, responseBody: null })];
    renderComponent();

    // Expand the accordion item
    const trigger = screen.getByRole('button', { expanded: false });
    fireEvent.click(trigger);

    expect(screen.getByText('No response data captured')).toBeTruthy();
  });

  // ── Load more pagination ──────────────────────────────────────

  it('shows Load more button when results equal page size', () => {
    // PAGE_SIZE is 20 in the component
    mockDeliveries = Array.from({ length: 20 }, (_, i) => makeDelivery({ id: `del-${i}` }));
    renderComponent();

    expect(screen.getByText('Load more')).toBeTruthy();
  });

  it('hides Load more button when results are fewer than page size', () => {
    mockDeliveries = [makeDelivery({ id: 'del-1' })];
    renderComponent();

    expect(screen.queryByText('Load more')).toBeNull();
  });

  // ── Status badges ─────────────────────────────────────────────

  it('renders status badge for each delivery', () => {
    mockDeliveries = [
      makeDelivery({ id: 'del-1', status: 'sent' }),
      makeDelivery({ id: 'del-2', status: 'failed' }),
    ];
    renderComponent();

    expect(screen.getByText('sent')).toBeTruthy();
    expect(screen.getByText('failed')).toBeTruthy();
  });

  // ── Event type display ────────────────────────────────────────

  it('renders event type for each delivery', () => {
    mockDeliveries = [
      makeDelivery({ id: 'del-1', eventType: 'run.failed' }),
      makeDelivery({ id: 'del-2', eventType: 'run.completed' }),
    ];
    renderComponent();

    expect(screen.getByText('run.failed')).toBeTruthy();
    expect(screen.getByText('run.completed')).toBeTruthy();
  });
});
