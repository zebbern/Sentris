import { useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';

interface RegistryCategoryFilterProps {
  categories: string[];
  selectedCategory: string | null;
  onCategoryChange: (category: string | null) => void;
}

export function RegistryCategoryFilter({
  categories,
  selectedCategory,
  onCategoryChange,
}: RegistryCategoryFilterProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback(
    (category: string | null) => {
      onCategoryChange(selectedCategory === category ? null : category);
    },
    [selectedCategory, onCategoryChange],
  );

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) return;

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
    const currentIndex = buttons.indexOf(e.target as HTMLButtonElement);
    if (currentIndex === -1) return;

    let nextIndex: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % buttons.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      nextIndex = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      nextIndex = buttons.length - 1;
    }

    if (nextIndex !== null) {
      buttons[nextIndex].focus();
    }
  }, []);

  if (categories.length === 0) return null;

  // Determine which index should be focusable: the selected category, or first item
  const allItems: (string | null)[] = [null, ...categories];
  const selectedIndex = allItems.findIndex((item) => item === selectedCategory);
  const focusableIndex = selectedIndex >= 0 ? selectedIndex : 0;

  return (
    <div
      ref={containerRef}
      className="flex flex-wrap gap-2"
      role="toolbar"
      aria-label="Filter by category"
      onKeyDown={handleKeyDown}
    >
      <Button
        variant={selectedCategory === null ? 'default' : 'outline'}
        size="sm"
        className="rounded-full text-xs h-7"
        onClick={() => handleClick(null)}
        aria-pressed={selectedCategory === null}
        tabIndex={focusableIndex === 0 ? 0 : -1}
      >
        All
      </Button>
      {categories.map((category, i) => (
        <Button
          key={category}
          variant={selectedCategory === category ? 'default' : 'outline'}
          size="sm"
          className="rounded-full text-xs h-7"
          onClick={() => handleClick(category)}
          aria-pressed={selectedCategory === category}
          tabIndex={focusableIndex === i + 1 ? 0 : -1}
        >
          {category}
        </Button>
      ))}
    </div>
  );
}
