import { describe, it, beforeEach, afterEach, expect, mock } from 'bun:test';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';

// --- Mock useNavigate ---
const mockNavigate = mock();

mock.module('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  MemoryRouter: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// --- Mock useDocumentTitle (no-op) ---
mock.module('@/hooks/useDocumentTitle', () => ({
  useDocumentTitle: () => {},
}));

import { MemoryRouter } from 'react-router-dom';
import { NotFound } from '../NotFound';

const renderNotFound = () =>
  render(
    <MemoryRouter>
      <NotFound />
    </MemoryRouter>,
  );

describe('NotFound', () => {
  beforeEach(() => {
    cleanup();
    mockNavigate.mockClear();
  });

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
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('renders "Go Back" button', () => {
    renderNotFound();
    expect(screen.getByText('Go Back')).toBeTruthy();
  });

  it('calls navigate(-1) when "Go Back" is clicked', () => {
    renderNotFound();
    fireEvent.click(screen.getByText('Go Back'));
    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });
});
