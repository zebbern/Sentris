import type { Meta, StoryObj } from '@storybook/react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

const meta = {
  title: 'UI/Tabs',
  component: Tabs,
  tags: ['autodocs'],
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Tabs defaultValue="account" className="w-[400px]">
      <TabsList>
        <TabsTrigger value="account">Account</TabsTrigger>
        <TabsTrigger value="password">Password</TabsTrigger>
      </TabsList>
      <TabsContent value="account">
        <p className="text-sm text-muted-foreground">Make changes to your account settings here.</p>
      </TabsContent>
      <TabsContent value="password">
        <p className="text-sm text-muted-foreground">Change your password here.</p>
      </TabsContent>
    </Tabs>
  ),
};

export const ThreeTabs: Story = {
  render: () => (
    <Tabs defaultValue="overview" className="w-[500px]">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="analytics">Analytics</TabsTrigger>
        <TabsTrigger value="reports">Reports</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">
        <div className="rounded-md border p-4">
          <h3 className="font-semibold">Overview</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Your project overview and summary statistics.
          </p>
        </div>
      </TabsContent>
      <TabsContent value="analytics">
        <div className="rounded-md border p-4">
          <h3 className="font-semibold">Analytics</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Detailed analytics and performance metrics.
          </p>
        </div>
      </TabsContent>
      <TabsContent value="reports">
        <div className="rounded-md border p-4">
          <h3 className="font-semibold">Reports</h3>
          <p className="text-sm text-muted-foreground mt-1">Generated reports and data exports.</p>
        </div>
      </TabsContent>
    </Tabs>
  ),
};

export const DisabledTab: Story = {
  render: () => (
    <Tabs defaultValue="active" className="w-[400px]">
      <TabsList>
        <TabsTrigger value="active">Active</TabsTrigger>
        <TabsTrigger value="disabled" disabled>
          Disabled
        </TabsTrigger>
        <TabsTrigger value="other">Other</TabsTrigger>
      </TabsList>
      <TabsContent value="active">
        <p className="text-sm text-muted-foreground">Active tab content.</p>
      </TabsContent>
      <TabsContent value="other">
        <p className="text-sm text-muted-foreground">Other tab content.</p>
      </TabsContent>
    </Tabs>
  ),
};
