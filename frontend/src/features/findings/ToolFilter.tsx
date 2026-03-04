import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useComponents } from '@/hooks/queries/useComponentQueries';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolFilterProps {
  value: string | undefined;
  onChange: (componentId: string | undefined) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ToolFilter({ value, onChange }: ToolFilterProps) {
  const { data: componentIndex } = useComponents();

  const handleChange = (val: string) => {
    onChange(val === 'all' ? undefined : val);
  };

  const components = componentIndex
    ? Object.values(componentIndex.byId).sort((a, b) => a.slug.localeCompare(b.slug))
    : [];

  return (
    <Select value={value ?? 'all'} onValueChange={handleChange}>
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder="Tool" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All tools</SelectItem>
        {components.map((comp) => (
          <SelectItem key={comp.id} value={comp.id}>
            {comp.slug}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
