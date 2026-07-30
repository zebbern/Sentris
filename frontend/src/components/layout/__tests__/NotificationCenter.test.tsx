import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { useNotificationStore } from '@/store/notificationStore';
import { renderWithProviders } from '@/test/render-with-providers';
import { NotificationPanelContent } from '../NotificationCenter';

function CurrentLocation() {
  const location = useLocation();
  return <div data-testid="current-location">{`${location.pathname}${location.search}`}</div>;
}

afterEach(() => {
  cleanup();
  useNotificationStore.setState({ notifications: [] });
});

describe('NotificationPanelContent', () => {
  it('renders row and item actions as sibling buttons while the row opens its run', () => {
    useNotificationStore.setState({
      notifications: [
        {
          id: 'notification-1',
          title: 'Workflow finished',
          variant: 'success',
          timestamp: '2026-07-30T10:00:00.000Z',
          read: false,
          runId: 'run-1',
        },
      ],
    });

    renderWithProviders(
      <Routes>
        <Route path="/" element={<NotificationPanelContent />} />
        <Route path="/workflows" element={<CurrentLocation />} />
      </Routes>,
    );

    const rowButton = screen.getByRole('button', { name: /Workflow finished/ });
    const markReadButton = screen.getByRole('button', { name: 'Mark as read' });
    const dismissButton = screen.getByRole('button', { name: 'Dismiss notification' });

    expect(rowButton.contains(markReadButton)).toBe(false);
    expect(rowButton.contains(dismissButton)).toBe(false);

    fireEvent.click(rowButton);

    expect(screen.getByTestId('current-location')).toHaveTextContent('/workflows?runId=run-1');
  });
});
