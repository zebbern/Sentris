import { describe, it, afterEach, expect } from 'bun:test';
import { render, screen, cleanup } from '@testing-library/react';
import type { NodeProgressBarProps } from '../types';

const { NodeProgressBar } = await import('../NodeProgressBar');

function createDefaultProps(overrides: Partial<NodeProgressBarProps> = {}): NodeProgressBarProps {
  return {
    progress: 0,
    events: 0,
    totalEvents: 0,
    isRunning: false,
    status: 'idle',
    ...overrides,
  };
}

describe('NodeProgressBar', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders "Events observed" label', () => {
    render(<NodeProgressBar {...createDefaultProps()} />);

    expect(screen.getByText('Events observed')).toBeInTheDocument();
  });

  it('renders event count with total when totalEvents > 0', () => {
    render(<NodeProgressBar {...createDefaultProps({ events: 3, totalEvents: 10 })} />);

    expect(screen.getByText('3/10 events')).toBeInTheDocument();
  });

  it('renders singular "event" when events === 1 and no total', () => {
    render(<NodeProgressBar {...createDefaultProps({ events: 1, totalEvents: 0 })} />);

    expect(screen.getByText('1 event')).toBeInTheDocument();
  });

  it('renders plural "events" when events !== 1 and no total', () => {
    render(<NodeProgressBar {...createDefaultProps({ events: 5, totalEvents: 0 })} />);

    expect(screen.getByText('5 events')).toBeInTheDocument();
  });

  it('renders 0 events correctly', () => {
    render(<NodeProgressBar {...createDefaultProps({ events: 0, totalEvents: 0 })} />);

    expect(screen.getByText('0 events')).toBeInTheDocument();
  });

  it('sets bar width to 100% when status is success', () => {
    const { container } = render(
      <NodeProgressBar
        {...createDefaultProps({ status: 'success', events: 5, totalEvents: 10 })}
      />,
    );

    const bar = container.querySelector('.rounded-full.transition-all') as HTMLElement;
    expect(bar.style.width).toBe('100%');
  });

  it('sets bar width based on events/totalEvents ratio', () => {
    const { container } = render(
      <NodeProgressBar {...createDefaultProps({ events: 3, totalEvents: 10 })} />,
    );

    const bar = container.querySelector('.rounded-full.transition-all') as HTMLElement;
    expect(bar.style.width).toBe('30%');
  });

  it('uses progress value when no event-based ratio is available', () => {
    const { container } = render(
      <NodeProgressBar {...createDefaultProps({ progress: 50, events: 0, totalEvents: 0 })} />,
    );

    const bar = container.querySelector('.rounded-full.transition-all') as HTMLElement;
    expect(bar.style.width).toBe('50%');
  });

  it('uses fallback width of 5% when running with no finite progress data', () => {
    const { container } = render(
      <NodeProgressBar
        {...createDefaultProps({ isRunning: true, progress: NaN, events: 0, totalEvents: 0 })}
      />,
    );

    const bar = container.querySelector('.rounded-full.transition-all') as HTMLElement;
    expect(bar.style.width).toBe('5%');
  });

  it('applies green color class for success status', () => {
    const { container } = render(
      <NodeProgressBar
        {...createDefaultProps({ status: 'success', events: 10, totalEvents: 10 })}
      />,
    );

    const bar = container.querySelector('.rounded-full.transition-all') as HTMLElement;
    expect(bar.classList.contains('bg-green-500')).toBe(true);
  });

  it('applies red color class for error status', () => {
    const { container } = render(
      <NodeProgressBar {...createDefaultProps({ status: 'error', events: 3, totalEvents: 10 })} />,
    );

    const bar = container.querySelector('.rounded-full.transition-all') as HTMLElement;
    expect(bar.classList.contains('bg-red-600')).toBe(true);
  });

  it('applies blue animate-pulse class when running', () => {
    const { container } = render(
      <NodeProgressBar
        {...createDefaultProps({ isRunning: true, status: 'running', events: 2, totalEvents: 10 })}
      />,
    );

    const bar = container.querySelector('.rounded-full.transition-all') as HTMLElement;
    expect(bar.classList.contains('bg-blue-500')).toBe(true);
    expect(bar.classList.contains('animate-pulse')).toBe(true);
  });

  it('clamps progress to 100% maximum', () => {
    const { container } = render(
      <NodeProgressBar {...createDefaultProps({ progress: 200, events: 0, totalEvents: 0 })} />,
    );

    const bar = container.querySelector('.rounded-full.transition-all') as HTMLElement;
    expect(bar.style.width).toBe('100%');
  });

  it('clamps progress to 0% minimum', () => {
    const { container } = render(
      <NodeProgressBar {...createDefaultProps({ progress: -50, events: 0, totalEvents: 0 })} />,
    );

    const bar = container.querySelector('.rounded-full.transition-all') as HTMLElement;
    expect(bar.style.width).toBe('0%');
  });
});
