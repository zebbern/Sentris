import type { Meta, StoryObj } from '@storybook/react-vite';
import { FileText, Inbox, Search } from 'lucide-react';
import { Button } from './button';
import { EmptyState } from './EmptyState';

const meta = {
  title: 'UI/EmptyState',
  component: EmptyState,
  tags: ['autodocs'],
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    icon: Inbox,
    title: 'No items yet',
    description: 'Get started by creating your first item.',
  },
};

export const WithAction: Story = {
  args: {
    icon: FileText,
    title: 'No documents',
    description: 'Create your first document to get started.',
    action: <Button>Create Document</Button>,
  },
};

export const SearchNoResults: Story = {
  args: {
    icon: Search,
    title: 'No results found',
    description: 'Try adjusting your search query or filters.',
    action: <Button variant="outline">Clear Filters</Button>,
  },
};

export const TitleOnly: Story = {
  args: {
    title: 'Nothing here',
  },
};

export const NoIcon: Story = {
  args: {
    title: 'Empty collection',
    description: 'This collection has no items. Add some to see them here.',
    action: <Button size="sm">Add Item</Button>,
  },
};
