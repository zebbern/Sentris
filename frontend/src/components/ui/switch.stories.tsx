import type { Meta, StoryObj } from '@storybook/react';
import { Switch } from './switch';
import { Label } from './label';

const meta = {
  title: 'UI/Switch',
  component: Switch,
  tags: ['autodocs'],
} satisfies Meta<typeof Switch>;

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
      <Switch id="airplane-mode" />
      <Label htmlFor="airplane-mode">Airplane Mode</Label>
    </div>
  ),
};

export const MultipleSettings: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between w-64">
        <Label htmlFor="wifi">Wi-Fi</Label>
        <Switch id="wifi" defaultChecked />
      </div>
      <div className="flex items-center justify-between w-64">
        <Label htmlFor="bluetooth">Bluetooth</Label>
        <Switch id="bluetooth" />
      </div>
      <div className="flex items-center justify-between w-64">
        <Label htmlFor="vpn">VPN</Label>
        <Switch id="vpn" disabled />
      </div>
    </div>
  ),
};
