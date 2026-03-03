import type { Meta, StoryObj } from '@storybook/react-vite';
import { Slider } from './slider';

const meta = {
  title: 'UI/Slider',
  component: Slider,
  tags: ['autodocs'],
} satisfies Meta<typeof Slider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    defaultValue: [50],
    max: 100,
    step: 1,
    className: 'w-[300px]',
  },
};

export const WithRange: Story = {
  args: {
    defaultValue: [25, 75],
    max: 100,
    step: 1,
    className: 'w-[300px]',
  },
};

export const SmallStep: Story = {
  args: {
    defaultValue: [0.5],
    max: 1,
    step: 0.1,
    className: 'w-[300px]',
  },
};

export const Disabled: Story = {
  args: {
    defaultValue: [50],
    max: 100,
    step: 1,
    disabled: true,
    className: 'w-[300px]',
  },
};
