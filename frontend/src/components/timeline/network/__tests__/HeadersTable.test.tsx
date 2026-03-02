import { describe, it, expect, afterEach, mock } from 'bun:test';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { HarHeader } from '../types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCopy = mock(async (_val: string, _opts?: any) => {});
const mockIsCopied = mock((_val: string) => false);

mock.module('@/hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({
    copy: mockCopy,
    isCopied: mockIsCopied,
  }),
}));

import { HeadersTable } from '../HeadersTable';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHeader(name: string, value: string): HarHeader {
  return { name, value };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HeadersTable', () => {
  afterEach(() => {
    cleanup();
    mockCopy.mockClear();
    mockIsCopied.mockClear();
    mockIsCopied.mockReturnValue(false);
  });

  it('renders "No ..." message when headers array is empty', () => {
    render(<HeadersTable headers={[]} title="Request Headers" />);

    expect(screen.getByText('No request headers')).toBeTruthy();
  });

  it('renders title heading', () => {
    const headers = [makeHeader('Content-Type', 'application/json')];
    render(<HeadersTable headers={headers} title="Response Headers" />);

    expect(screen.getByText('Response Headers')).toBeTruthy();
  });

  it('renders header names and values', () => {
    const headers = [
      makeHeader('Content-Type', 'application/json'),
      makeHeader('Authorization', 'Bearer token-123'),
    ];
    render(<HeadersTable headers={headers} title="Request Headers" />);

    expect(screen.getByText('Content-Type:')).toBeTruthy();
    expect(screen.getByText('application/json')).toBeTruthy();
    expect(screen.getByText('Authorization:')).toBeTruthy();
    expect(screen.getByText('Bearer token-123')).toBeTruthy();
  });

  it('renders multiple headers with the same name', () => {
    const headers = [
      makeHeader('Set-Cookie', 'session=abc'),
      makeHeader('Set-Cookie', 'theme=dark'),
    ];
    render(<HeadersTable headers={headers} title="Response Headers" />);

    expect(screen.getByText('session=abc')).toBeTruthy();
    expect(screen.getByText('theme=dark')).toBeTruthy();
  });

  it('calls copy with header value on copy button click', () => {
    const headers = [makeHeader('X-Request-Id', 'req-456')];
    const { container } = render(<HeadersTable headers={headers} title="Headers" />);

    // The copy button is inside each header row
    const copyButton = container.querySelector('button');
    expect(copyButton).toBeTruthy();
    if (copyButton) {
      fireEvent.click(copyButton);
      expect(mockCopy).toHaveBeenCalledWith('req-456', { showToast: false });
    }
  });

  it('renders single header correctly', () => {
    const headers = [makeHeader('Accept', '*/*')];
    render(<HeadersTable headers={headers} title="Request Headers" />);

    expect(screen.getByText('Accept:')).toBeTruthy();
    expect(screen.getByText('*/*')).toBeTruthy();
  });
});
