import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { ConfirmDialog } from './confirm-dialog';

const meta = {
  title: 'UI/ConfirmDialog',
  component: ConfirmDialog,
  tags: ['autodocs'],
} satisfies Meta<typeof ConfirmDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    open: true,
    title: 'Confirm Action',
    description: 'Are you sure you want to proceed with this action?',
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    destructive: false,
    onConfirm: fn(),
    onCancel: fn(),
  },
};

export const Destructive: Story = {
  args: {
    open: true,
    title: 'Delete Item',
    description: 'This action cannot be undone. The item will be permanently deleted.',
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
    destructive: true,
    onConfirm: fn(),
    onCancel: fn(),
  },
};

export const CustomLabels: Story = {
  args: {
    open: true,
    title: 'Discard Changes',
    description: 'You have unsaved changes. Do you want to discard them?',
    confirmLabel: 'Discard',
    cancelLabel: 'Keep Editing',
    destructive: true,
    onConfirm: fn(),
    onCancel: fn(),
  },
};
