import type { Meta, StoryObj } from '@storybook/react-vite';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './accordion';

const meta = {
  title: 'UI/Accordion',
  component: Accordion,
  tags: ['autodocs'],
  args: {
    type: 'single' as const,
  },
} satisfies Meta<typeof Accordion>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Accordion type="single" collapsible className="w-full max-w-md">
      <AccordionItem value="item-1">
        <AccordionTrigger>Is it accessible?</AccordionTrigger>
        <AccordionContent>Yes. It adheres to the WAI-ARIA design pattern.</AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-2">
        <AccordionTrigger>Is it styled?</AccordionTrigger>
        <AccordionContent>
          Yes. It comes with default styles that match the other components.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-3">
        <AccordionTrigger>Is it animated?</AccordionTrigger>
        <AccordionContent>
          Yes. It&apos;s animated by default, but you can disable it if you prefer.
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};

export const Multiple: Story = {
  render: () => (
    <Accordion type="multiple" className="w-full max-w-md">
      <AccordionItem value="item-1">
        <AccordionTrigger>Section One</AccordionTrigger>
        <AccordionContent>Content for section one.</AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-2">
        <AccordionTrigger>Section Two</AccordionTrigger>
        <AccordionContent>Content for section two.</AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-3">
        <AccordionTrigger>Section Three</AccordionTrigger>
        <AccordionContent>Content for section three.</AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};

export const DefaultOpen: Story = {
  render: () => (
    <Accordion type="single" defaultValue="item-1" className="w-full max-w-md">
      <AccordionItem value="item-1">
        <AccordionTrigger>Opens by default</AccordionTrigger>
        <AccordionContent>
          This section is expanded by default when the accordion renders.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-2">
        <AccordionTrigger>Collapsed by default</AccordionTrigger>
        <AccordionContent>This section starts collapsed.</AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};
