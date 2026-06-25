import * as React from 'react';
import { cn } from '@/lib/utils';

function Sidebar({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <aside
      ref={ref}
      className={cn(
        'flex flex-col border-r border-border/80 bg-app-chrome overflow-hidden',
        // Ensure smooth transition for width changes
        'will-change-[width,transform]',
        className,
      )}
      {...props}
    />
  );
}

function SidebarHeader({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div
      ref={ref}
      className={cn('border-b px-2 min-h-10 flex items-center', className)}
      {...props}
    />
  );
}

function SidebarFooter({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> }) {
  return <div ref={ref} className={cn('border-t p-2 mt-auto', className)} {...props} />;
}

function SidebarContent({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div
      ref={ref}
      className={cn(
        'flex-1 overflow-y-auto overflow-x-hidden py-2',
        // Custom scrollbar styling
        'scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent',
        className,
      )}
      {...props}
    />
  );
}

function getSidebarItemClassName(isActive?: boolean, className?: string) {
  return cn(
    'flex w-full items-center gap-2.5 px-2.5 py-2 md:py-1.5 text-left rounded-lg text-[13px] font-medium',
    'transition-colors duration-150',
    'hover:bg-accent hover:text-accent-foreground',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    'min-h-[44px] md:min-h-0',
    isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
    className,
  );
}

function SidebarItem({
  className,
  isActive,
  ref,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  isActive?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      className={getSidebarItemClassName(isActive, className)}
      {...props}
    />
  );
}

export {
  Sidebar,
  SidebarHeader,
  SidebarFooter,
  SidebarContent,
  SidebarItem,
  getSidebarItemClassName,
};
