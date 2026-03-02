import { useCallback } from 'react';
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
  const handleClick = useCallback(
    (category: string | null) => {
      onCategoryChange(selectedCategory === category ? null : category);
    },
    [selectedCategory, onCategoryChange],
  );

  if (categories.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
      <Button
        variant={selectedCategory === null ? 'default' : 'outline'}
        size="sm"
        className="rounded-full text-xs h-7"
        onClick={() => handleClick(null)}
        aria-pressed={selectedCategory === null}
      >
        All
      </Button>
      {categories.map((category) => (
        <Button
          key={category}
          variant={selectedCategory === category ? 'default' : 'outline'}
          size="sm"
          className="rounded-full text-xs h-7"
          onClick={() => handleClick(category)}
          aria-pressed={selectedCategory === category}
        >
          {category}
        </Button>
      ))}
    </div>
  );
}
