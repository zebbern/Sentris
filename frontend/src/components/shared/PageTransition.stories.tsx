import type { Meta, StoryObj } from '@storybook/react';
import { PageTransition } from './PageTransition';

const meta = {
  title: 'Shared/PageTransition',
  component: PageTransition,
  tags: ['autodocs'],
} satisfies Meta<typeof PageTransition>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: (
      <div className="p-6 border rounded-md">
        <h2 className="text-lg font-semibold">Animated Content</h2>
        <p className="text-sm text-muted-foreground mt-2">
          This content fades and slides in when the page loads.
        </p>
      </div>
    ),
  },
};

export const WithCard: Story = {
  args: {
    children: (
      <div className="space-y-4">
        <div className="p-4 border rounded-md bg-card">
          <h3 className="font-semibold">Card 1</h3>
          <p className="text-sm text-muted-foreground">First card content.</p>
        </div>
        <div className="p-4 border rounded-md bg-card">
          <h3 className="font-semibold">Card 2</h3>
          <p className="text-sm text-muted-foreground">Second card content.</p>
        </div>
      </div>
    ),
  },
};
