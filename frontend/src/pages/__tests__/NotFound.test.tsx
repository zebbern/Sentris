import { describe, it, beforeEach, afterEach, expect, mock } from 'bun:test';
import { fireEvent, screen, cleanup } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { renderWithProviders } from '@/test/render-with-providers';

// --- Mock useDocumentTitle (no-op) ---
mock.module('@/hooks/useDocumentTitle', () => ({
  useDocumentTitle: () => {},
}));

import { NotFound } from '../NotFound';

/** Renders current pathname so tests can assert on real navigation. */
function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location-display">{location.pathname}</div>;
}

const renderNotFound = (initialEntries: string[] = ['/not-found']) =>
  renderWithProviders(
    <>
      <NotFound />
      <LocationDisplay />
    </>,
    { initialEntries },
  );

describe('NotFound', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it('renders without crashing', () => {
    const { container } = renderNotFound();
    expect(container).toBeTruthy();
  });

  it('displays "404" text', () => {
    renderNotFound();
    expect(screen.getByText('404')).toBeTruthy();
  });

  it('displays "Page Not Found" heading', () => {
    renderNotFound();
    expect(screen.getByText('Page Not Found')).toBeTruthy();
  });

  it('displays description text', () => {
    renderNotFound();
    expect(
      screen.getByText(/the page you('|')re looking for doesn('|')t exist or has been moved/i),
    ).toBeTruthy();
  });

  it('renders "Go to Homepage" button', () => {
    renderNotFound();
    expect(screen.getByText('Go to Homepage')).toBeTruthy();
  });

  it('navigates to "/" when "Go to Homepage" is clicked', () => {
    renderNotFound();
    fireEvent.click(screen.getByText('Go to Homepage'));
    expect(screen.getByTestId('location-display').textContent).toBe('/');
  });

  it('renders "Go Back" button', () => {
    renderNotFound();
    expect(screen.getByText('Go Back')).toBeTruthy();
  });

  it('calls navigate(-1) when "Go Back" is clicked', () => {
    renderNotFound(['/previous', '/not-found']);
    fireEvent.click(screen.getByText('Go Back'));
    expect(screen.getByTestId('location-display').textContent).toBe('/previous');
  });
});
