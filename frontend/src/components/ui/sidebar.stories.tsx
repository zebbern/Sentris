import type { Meta, StoryObj } from '@storybook/react';
import { Home, Settings, Users, FileText, BarChart } from 'lucide-react';
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarItem } from './sidebar';

const meta = {
  title: 'UI/Sidebar',
  component: Sidebar,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="flex h-[500px]">
      <Sidebar className="w-64">
        <SidebarHeader>
          <span className="text-lg font-bold">My App</span>
        </SidebarHeader>
        <SidebarContent>
          <div className="flex flex-col gap-1 p-2">
            <SidebarItem isActive>
              <Home className="h-4 w-4" />
              Dashboard
            </SidebarItem>
            <SidebarItem>
              <Users className="h-4 w-4" />
              Users
            </SidebarItem>
            <SidebarItem>
              <FileText className="h-4 w-4" />
              Documents
            </SidebarItem>
            <SidebarItem>
              <BarChart className="h-4 w-4" />
              Analytics
            </SidebarItem>
            <SidebarItem>
              <Settings className="h-4 w-4" />
              Settings
            </SidebarItem>
          </div>
        </SidebarContent>
        <SidebarFooter>
          <span className="text-xs text-muted-foreground">v1.0.0</span>
        </SidebarFooter>
      </Sidebar>
      <div className="flex-1 p-6 bg-muted/30">
        <p className="text-muted-foreground">Main content area</p>
      </div>
    </div>
  ),
};

export const Collapsed: Story = {
  render: () => (
    <div className="flex h-[400px]">
      <Sidebar className="w-16">
        <SidebarHeader className="justify-center">
          <Home className="h-5 w-5" />
        </SidebarHeader>
        <SidebarContent>
          <div className="flex flex-col gap-1 p-2 items-center">
            <SidebarItem isActive className="justify-center">
              <Home className="h-4 w-4" />
            </SidebarItem>
            <SidebarItem className="justify-center">
              <Users className="h-4 w-4" />
            </SidebarItem>
            <SidebarItem className="justify-center">
              <Settings className="h-4 w-4" />
            </SidebarItem>
          </div>
        </SidebarContent>
      </Sidebar>
      <div className="flex-1 p-6 bg-muted/30">
        <p className="text-muted-foreground">Main content area</p>
      </div>
    </div>
  ),
};
