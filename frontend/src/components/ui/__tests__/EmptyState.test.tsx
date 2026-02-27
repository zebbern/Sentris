import { describe, it, expect, afterEach } from 'bun:test';
import { render, screen, cleanup } from '@testing-library/react';
import { EmptyState } from '../EmptyState';

afterEach(cleanup);

// Minimal SVG icon component for testing
function MockIcon({ className }: { className?: string }) {
  return (
    <svg data-testid="mock-icon" className={className}>
      <circle cx="12" cy="12" r="10" />
    </svg>
  );
}

describe('EmptyState', () => {
  it('renders the title text', () => {
    render(<EmptyState title="No items found" />);

    expect(screen.getByText('No items found')).toBeTruthy();
  });

  it('renders the title as a heading element', () => {
    render(<EmptyState title="Nothing here" />);

    const heading = screen.getByText('Nothing here');
    expect(heading.tagName).toBe('H3');
  });

  it('renders description when provided', () => {
    render(<EmptyState title="Empty" description="Try adding some items to get started." />);

    const desc = screen.getByText('Try adding some items to get started.');
    expect(desc).toBeTruthy();
    expect(desc.tagName).toBe('P');
  });

  it('does not render description when omitted', () => {
    const { container } = render(<EmptyState title="Empty" />);

    expect(container.querySelector('p')).toBeNull();
  });

  it('renders the icon when provided', () => {
    render(<EmptyState title="No data" icon={MockIcon} />);

    expect(screen.getByTestId('mock-icon')).toBeTruthy();
  });

  it('does not render the icon container when icon is omitted', () => {
    const { container } = render(<EmptyState title="No data" />);

    // The icon wrapper uses a rounded-full div — should not exist
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders action slot when provided', () => {
    render(
      <EmptyState title="No secrets yet" action={<button type="button">Create Secret</button>} />,
    );

    expect(screen.getByRole('button', { name: 'Create Secret' })).toBeTruthy();
  });

  it('does not render action wrapper when action is omitted', () => {
    const { container } = render(<EmptyState title="Empty" />);

    expect(container.querySelector('button')).toBeNull();
  });

  it('renders with only the required title prop', () => {
    const { container } = render(<EmptyState title="Minimal" />);

    expect(screen.getByText('Minimal')).toBeTruthy();
    // No optional elements
    expect(container.querySelector('p')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });

  it('applies custom className to the root container', () => {
    const { container } = render(<EmptyState title="Styled" className="custom-class" />);

    const root = container.firstElementChild as HTMLElement;
    expect(root.classList.contains('custom-class')).toBe(true);
  });

  it('title uses font-semibold styling', () => {
    render(<EmptyState title="Styled title" />);

    const heading = screen.getByText('Styled title');
    expect(heading.classList.contains('font-semibold')).toBe(true);
  });

  it('description uses text-muted-foreground styling', () => {
    render(<EmptyState title="T" description="Styled description" />);

    const desc = screen.getByText('Styled description');
    expect(desc.classList.contains('text-muted-foreground')).toBe(true);
  });
});
