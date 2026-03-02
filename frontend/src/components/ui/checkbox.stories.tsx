import type { Meta, StoryObj } from '@storybook/react';
import { Checkbox } from './checkbox';
import { Label } from './label';

const meta = {
  title: 'UI/Checkbox',
  component: Checkbox,
  tags: ['autodocs'],
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Checked: Story = {
  args: {
    defaultChecked: true,
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
  },
};

export const DisabledChecked: Story = {
  args: {
    disabled: true,
    defaultChecked: true,
  },
};

export const WithLabel: Story = {
  render: () => (
    <div className="flex items-center space-x-2">
      <Checkbox id="terms" />
      <Label htmlFor="terms">Accept terms and conditions</Label>
    </div>
  ),
};

export const MultipleCheckboxes: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex items-center space-x-2">
        <Checkbox id="email-notifications" defaultChecked />
        <Label htmlFor="email-notifications">Email notifications</Label>
      </div>
      <div className="flex items-center space-x-2">
        <Checkbox id="sms-notifications" />
        <Label htmlFor="sms-notifications">SMS notifications</Label>
      </div>
      <div className="flex items-center space-x-2">
        <Checkbox id="push-notifications" disabled />
        <Label htmlFor="push-notifications">Push notifications (coming soon)</Label>
      </div>
    </div>
  ),
};
