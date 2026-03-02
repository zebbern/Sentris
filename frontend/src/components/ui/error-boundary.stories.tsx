import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Button } from './button';
import { ErrorBoundary } from './error-boundary';

const meta = {
  title: 'UI/ErrorBoundary',
  component: ErrorBoundary,
  tags: ['autodocs'],
} satisfies Meta<typeof ErrorBoundary>;

export default meta;
type Story = StoryObj<typeof meta>;

function BuggyComponent() {
  const [shouldThrow, setShouldThrow] = useState(false);

  if (shouldThrow) {
    throw new Error('This is a simulated error for testing the ErrorBoundary component.');
  }

  return (
    <div className="p-4 border rounded-md">
      <p className="text-sm mb-2">This component will throw an error when you click the button.</p>
      <Button variant="destructive" onClick={() => setShouldThrow(true)}>
        Trigger Error
      </Button>
    </div>
  );
}

export const Default: Story = {
  args: {
    children: <BuggyComponent />,
  },
};

function AlwaysThrows(): never {
  throw new Error('Something went wrong while rendering this component.');
}

export const WithError: Story = {
  args: {
    children: <AlwaysThrows />,
  },
};

export const CustomFallback: Story = {
  args: {
    children: <AlwaysThrows />,
    fallback: ({ error, resetErrorBoundary }) => (
      <div className="p-6 text-center space-y-3 border rounded-md bg-muted/50">
        <h3 className="font-semibold text-destructive">Custom Error UI</h3>
        <p className="text-sm text-muted-foreground">{error.message}</p>
        <Button size="sm" onClick={resetErrorBoundary}>
          Reset
        </Button>
      </div>
    ),
  },
};
