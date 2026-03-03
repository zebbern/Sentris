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
        'flex flex-col border-r bg-background overflow-hidden',
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
      className={cn(
        'border-b p-3 md:p-4 min-h-[56px] md:min-h-[60px] flex items-center',
        className,
      )}
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
      className={cn(
        'flex w-full items-center gap-3 px-3 py-2.5 md:py-2 text-left rounded-lg text-sm font-medium',
        'transition-colors duration-150',
        'hover:bg-accent hover:text-accent-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        // Touch-friendly sizing on mobile
        'min-h-[44px] md:min-h-0',
        isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

export { Sidebar, SidebarHeader, SidebarFooter, SidebarContent, SidebarItem };
