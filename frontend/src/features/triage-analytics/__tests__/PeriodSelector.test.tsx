import { describe, it, beforeEach, afterEach, expect, mock } from 'bun:test';
import { screen, cleanup } from '@testing-library/react';
import { createSelectMock } from '@/test/mocks/radix-select';
import { renderWithProviders } from '@/test/render-with-providers';

// --- Mock Radix Select ---
mock.module('@/components/ui/select', createSelectMock);

// Import after mocks
import { PeriodSelector } from '@/features/triage-analytics/PeriodSelector';

// --- Tests ---
describe('PeriodSelector', () => {
  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders period label', () => {
    const onChange = mock();
    renderWithProviders(<PeriodSelector value="30d" onChange={onChange} />);

    expect(screen.getByText('Period')).toBeInTheDocument();
  });

  it('renders all period options', () => {
    const onChange = mock();
    renderWithProviders(<PeriodSelector value="30d" onChange={onChange} />);

    expect(screen.getByText('Last 7 days')).toBeInTheDocument();
    expect(screen.getByText('Last 30 days')).toBeInTheDocument();
    expect(screen.getByText('Last 90 days')).toBeInTheDocument();
  });

  it('renders aria-label for accessibility', () => {
    const onChange = mock();
    renderWithProviders(<PeriodSelector value="7d" onChange={onChange} />);

    expect(screen.getByLabelText('Select time period')).toBeInTheDocument();
  });

  it('renders with correct value options available', () => {
    const onChange = mock();
    renderWithProviders(<PeriodSelector value="90d" onChange={onChange} />);

    // Options should be present as option elements via the mock
    const options = screen.getAllByRole('option');
    expect(options.length).toBe(3);
  });
});
