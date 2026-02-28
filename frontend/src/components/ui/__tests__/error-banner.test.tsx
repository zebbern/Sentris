import { describe, it, expect, vi, afterEach } from 'bun:test';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ErrorBanner } from '../error-banner';

afterEach(cleanup);

describe('ErrorBanner', () => {
  it('renders the error message text', () => {
    render(<ErrorBanner message="Something went wrong" />);

    expect(screen.getByText('Something went wrong')).toBeTruthy();
  });

  it('renders the "Try again" button when onRetry is provided', () => {
    render(<ErrorBanner message="Error" onRetry={vi.fn()} />);

    expect(screen.getByText('Try again')).toBeTruthy();
  });

  it('does not render a button when onRetry is omitted', () => {
    const { container } = render(<ErrorBanner message="Error" />);

    expect(container.querySelector('button')).toBeNull();
  });

  it('calls onRetry when the "Try again" button is clicked', () => {
    const handleRetry = vi.fn();
    render(<ErrorBanner message="Error" onRetry={handleRetry} />);

    fireEvent.click(screen.getByText('Try again'));

    expect(handleRetry).toHaveBeenCalledTimes(1);
  });

  it('applies custom className to the root element', () => {
    const { container } = render(<ErrorBanner message="Error" className="mb-6" />);

    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('mb-6');
    // Base classes should also be present
    expect(root.className).toContain('rounded-md');
  });

  it('renders message inside a span element', () => {
    render(<ErrorBanner message="Network failure" />);

    const span = screen.getByText('Network failure');
    expect(span.tagName).toBe('SPAN');
  });
});
