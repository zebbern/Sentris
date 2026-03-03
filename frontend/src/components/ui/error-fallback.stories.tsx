import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { MemoryRouter } from 'react-router-dom';
import { ErrorFallback } from './error-fallback';

const meta = {
  title: 'UI/ErrorFallback',
  component: ErrorFallback,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof ErrorFallback>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    error: new Error('An unexpected error occurred while processing your request.'),
    resetErrorBoundary: fn(),
  },
};

export const LongErrorMessage: Story = {
  args: {
    error: new Error(
      'TypeError: Cannot read properties of undefined (reading "map") at ComponentRenderer.render (bundle.js:1234:56)',
    ),
    resetErrorBoundary: fn(),
  },
};

export const ShortError: Story = {
  args: {
    error: new Error('Network Error'),
    resetErrorBoundary: fn(),
  },
};
