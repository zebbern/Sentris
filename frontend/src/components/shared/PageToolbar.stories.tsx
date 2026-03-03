import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageToolbar } from './PageToolbar';

const meta = {
  title: 'Shared/PageToolbar',
  component: PageToolbar,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
  },
} satisfies Meta<typeof PageToolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithTitle: Story = {
  args: {
    title: 'Dashboard',
  },
};

export const WithTitleAndActions: Story = {
  args: {
    title: 'Pipelines',
    actions: (
      <div className="flex gap-2">
        <Button variant="outline" size="sm">
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" />
          New Pipeline
        </Button>
      </div>
    ),
  },
};

export const WithSearch: Story = {
  args: {
    title: 'Users',
    searchValue: '',
    onSearchChange: fn(),
    searchPlaceholder: 'Search users...',
    actions: (
      <Button size="sm">
        <Plus className="mr-2 h-4 w-4" />
        Add User
      </Button>
    ),
  },
};

export const WithSearchLabel: Story = {
  args: {
    title: 'Logs',
    searchValue: '',
    onSearchChange: fn(),
    searchPlaceholder: 'Filter logs...',
    searchLabel: 'Search Logs',
  },
};

export const WithFilters: Story = {
  args: {
    title: 'Findings',
    searchValue: '',
    onSearchChange: fn(),
    searchPlaceholder: 'Search findings...',
    actions: (
      <Button size="sm">
        <Plus className="mr-2 h-4 w-4" />
        New Finding
      </Button>
    ),
    filters: (
      <div className="flex gap-2">
        <Badge variant="secondary">Critical: 3</Badge>
        <Badge variant="secondary">High: 12</Badge>
        <Badge variant="outline">All: 42</Badge>
      </div>
    ),
  },
};

export const WithHelpUrl: Story = {
  args: {
    title: 'Settings',
    helpUrl: 'https://docs.example.com/settings',
  },
};

export const SearchOnly: Story = {
  args: {
    searchValue: '',
    onSearchChange: fn(),
    searchPlaceholder: 'Search everything...',
    actions: (
      <Button variant="outline" size="sm">
        <RefreshCw className="mr-2 h-4 w-4" />
        Refresh
      </Button>
    ),
  },
};
