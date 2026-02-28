import { useState } from 'react';
import { cn } from '@/lib/utils';
import { getGroupIcon, getGroupLogoUrl } from './utils';

interface GroupLogoProps {
  slug: string;
  name: string;
  className?: string;
}

export function GroupLogo({ slug, name, className }: GroupLogoProps) {
  const logoUrl = getGroupLogoUrl(slug);
  const FallbackIcon = getGroupIcon(slug, name);

  const [showFallback, setShowFallback] = useState(!logoUrl);

  if (showFallback) {
    return <FallbackIcon className={className} aria-hidden="true" />;
  }

  return (
    <img
      src={logoUrl ?? undefined}
      alt={`${name} logo`}
      width={20}
      height={20}
      className={cn('h-5 w-5 object-contain', className)}
      onError={(event) => {
        event.currentTarget.style.display = 'none';
        setShowFallback(true);
      }}
    />
  );
}
