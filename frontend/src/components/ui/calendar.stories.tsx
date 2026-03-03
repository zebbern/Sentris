import type { Meta, StoryObj } from '@storybook/react-vite';
import { Calendar } from './calendar';

const meta = {
  title: 'UI/Calendar',
  component: Calendar,
  tags: ['autodocs'],
} satisfies Meta<typeof Calendar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    mode: 'single',
    className: 'rounded-md border',
  },
};

export const WithSelectedDate: Story = {
  args: {
    mode: 'single',
    selected: new Date(2026, 2, 15),
    className: 'rounded-md border',
  },
};

export const MultipleMonths: Story = {
  args: {
    mode: 'single',
    numberOfMonths: 2,
    className: 'rounded-md border',
  },
};
