import { describe, it, expect, mock, afterEach } from 'bun:test';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { JsonPreview } from '../JsonPreview';

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDefaultProps(overrides: Partial<Parameters<typeof JsonPreview>[0]> = {}) {
  return {
    json: JSON.stringify({ key: 'value', nested: { a: 1 } }, null, 2),
    defaultOpen: false,
    onCopy: mock(() => {}),
    isCopied: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('JsonPreview', () => {
  it('renders collapsed by default when defaultOpen is false', () => {
    const { container } = render(<JsonPreview {...createDefaultProps({ defaultOpen: false })} />);

    // The JSON pre element should NOT be visible
    expect(container.querySelector('pre')).toBeNull();
    // But the header should still be visible
    expect(screen.getByText('Template JSON')).toBeTruthy();
  });

  it('renders expanded by default when defaultOpen is true', () => {
    const json = JSON.stringify({ key: 'value' }, null, 2);
    const { container } = render(
      <JsonPreview {...createDefaultProps({ defaultOpen: true, json })} />,
    );

    // The pre element should be visible with the JSON content
    const pre = container.querySelector('pre');
    expect(pre).toBeTruthy();
    expect(pre!.textContent).toContain('"key"');
  });

  it('expands on click to show JSON content', () => {
    const json = JSON.stringify({ hello: 'world' }, null, 2);
    const { container } = render(
      <JsonPreview {...createDefaultProps({ defaultOpen: false, json })} />,
    );

    // Should start collapsed
    expect(container.querySelector('pre')).toBeNull();

    // Click the header to expand
    fireEvent.click(screen.getByText('Template JSON'));

    // JSON content should now be visible in the pre
    const pre = container.querySelector('pre');
    expect(pre).toBeTruthy();
    expect(pre!.textContent).toContain('"hello"');
  });

  it('collapses on second click', () => {
    const json = JSON.stringify({ hello: 'world' }, null, 2);
    const { container } = render(
      <JsonPreview {...createDefaultProps({ defaultOpen: true, json })} />,
    );

    // Should start expanded
    expect(container.querySelector('pre')).toBeTruthy();

    // Click to collapse
    fireEvent.click(screen.getByText('Template JSON'));

    // Content should be hidden
    expect(container.querySelector('pre')).toBeNull();
  });

  it('copy button fires onCopy callback', () => {
    const onCopy = mock(() => {});
    render(<JsonPreview {...createDefaultProps({ onCopy })} />);

    fireEvent.click(screen.getByText('Copy'));

    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it('shows "Copied" text when isCopied is true', () => {
    render(<JsonPreview {...createDefaultProps({ isCopied: true })} />);

    expect(screen.getByText('Copied')).toBeTruthy();
    expect(screen.queryByText('Copy')).toBeNull();
  });

  it('shows "Copy" text when isCopied is false', () => {
    render(<JsonPreview {...createDefaultProps({ isCopied: false })} />);

    expect(screen.getByText('Copy')).toBeTruthy();
    expect(screen.queryByText('Copied')).toBeNull();
  });

  it('displays formatted size badge', () => {
    // A short JSON string should display a size badge
    const json = JSON.stringify({ a: 1 });
    render(<JsonPreview {...createDefaultProps({ json })} />);

    // The badge should show the formatted size (e.g., "7 B")
    // formatJsonSize returns something like "7 B" for a 7-byte string
    const badge = screen.getByText(/\d+\s*B/);
    expect(badge).toBeTruthy();
  });

  it('expands on Enter key press', () => {
    const json = JSON.stringify({ test: true }, null, 2);
    const { container } = render(
      <JsonPreview {...createDefaultProps({ defaultOpen: false, json })} />,
    );

    // The header div has role="button" — find it by role and tabIndex
    const header = screen.getByText('Template JSON').closest('[role="button"]')!;
    fireEvent.keyDown(header, { key: 'Enter' });

    const pre = container.querySelector('pre');
    expect(pre).toBeTruthy();
    expect(pre!.textContent).toContain('"test"');
  });
});
