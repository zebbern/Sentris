import { describe, it, expect, vi, afterEach } from 'bun:test';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ErrorBoundary } from '../error-boundary';

afterEach(cleanup);

// Suppress React error boundary console.error noise during tests
const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

afterEach(() => {
  consoleErrorSpy.mockClear();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A component that throws when `shouldThrow` is true. */
function BrokenChild({ shouldThrow = true }: { shouldThrow?: boolean }) {
  if (shouldThrow) {
    throw new Error('Test explosion');
  }
  return <div data-testid="child">All good</div>;
}

function GoodChild() {
  return <div data-testid="child">Working fine</div>;
}

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ErrorBoundary', () => {
  it('renders children normally when no error is thrown', () => {
    renderWithRouter(
      <ErrorBoundary>
        <GoodChild />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId('child')).toBeTruthy();
    expect(screen.getByText('Working fine')).toBeTruthy();
  });

  it('renders fallback UI when a child component throws', () => {
    renderWithRouter(
      <ErrorBoundary>
        <BrokenChild />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.queryByTestId('child')).toBeNull();
  });

  it('shows "Try Again" and "Go Home" buttons in fallback', () => {
    renderWithRouter(
      <ErrorBoundary>
        <BrokenChild />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Try Again')).toBeTruthy();
    expect(screen.getByText('Go Home')).toBeTruthy();
  });

  it('"Try Again" button resets the boundary and re-renders children', () => {
    // Use an externally controlled flag so the test can stop throwing before reset
    const control = { shouldThrow: true };
    function Controllable() {
      if (control.shouldThrow) {
        throw new Error('Controlled error');
      }
      return <div data-testid="child">Recovered</div>;
    }

    renderWithRouter(
      <ErrorBoundary>
        <Controllable />
      </ErrorBoundary>,
    );

    // Fallback is showing
    expect(screen.getByText('Something went wrong')).toBeTruthy();

    // Stop throwing, then click "Try Again"
    control.shouldThrow = false;
    fireEvent.click(screen.getByText('Try Again'));

    // Child re-renders successfully
    expect(screen.getByTestId('child')).toBeTruthy();
    expect(screen.getByText('Recovered')).toBeTruthy();
  });

  it('uses a custom fallback render prop when provided', () => {
    const customFallback = ({
      error,
      resetErrorBoundary,
    }: {
      error: Error;
      resetErrorBoundary: () => void;
    }) => (
      <div data-testid="custom-fallback">
        <span>Custom: {error.message}</span>
        <button onClick={resetErrorBoundary}>Reset</button>
      </div>
    );

    render(
      <ErrorBoundary fallback={customFallback}>
        <BrokenChild />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId('custom-fallback')).toBeTruthy();
    expect(screen.getByText('Custom: Test explosion')).toBeTruthy();
  });

  it('custom fallback reset button restores children', () => {
    let throwFlag = true;
    function ConditionalThrower() {
      if (throwFlag) {
        throw new Error('Conditional error');
      }
      return <div data-testid="child">Back to normal</div>;
    }

    const customFallback = ({
      resetErrorBoundary,
    }: {
      error: Error;
      resetErrorBoundary: () => void;
    }) => (
      <button data-testid="reset-btn" onClick={resetErrorBoundary}>
        Reset
      </button>
    );

    render(
      <ErrorBoundary fallback={customFallback}>
        <ConditionalThrower />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId('reset-btn')).toBeTruthy();

    // Stop throwing before resetting
    throwFlag = false;
    fireEvent.click(screen.getByTestId('reset-btn'));

    expect(screen.getByTestId('child')).toBeTruthy();
    expect(screen.getByText('Back to normal')).toBeTruthy();
  });
});
