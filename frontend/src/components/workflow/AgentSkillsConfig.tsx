import { useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useAgentSkills } from '@/hooks/queries/useAgentSkillQueries';

interface AgentSkillsConfigProps {
  value: string[];
  onChange: (skillIds: string[]) => void;
  disabled?: boolean;
}

export function AgentSkillsConfig({ value, onChange, disabled = false }: AgentSkillsConfigProps) {
  const { data: skills = [], isLoading, error } = useAgentSkills(true);
  const [selected, setSelected] = useState<Set<string>>(new Set(value));

  useEffect(() => {
    setSelected(new Set(value));
  }, [value]);

  useEffect(() => {
    const next = Array.from(selected).sort();
    const current = [...value].sort();
    if (JSON.stringify(next) !== JSON.stringify(current)) {
      onChange(next);
    }
  }, [selected, onChange, value]);

  const toggleSkill = (skillId: string) => {
    if (disabled) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(skillId)) next.delete(skillId);
      else next.add(skillId);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading agent skills...
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-destructive">{error.message}</p>;
  }

  if (skills.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No skills available.{' '}
        <Link to="/agent-skills" className="text-primary hover:underline">
          Create skills in the Agent Skills page
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {skills.map((skill) => {
        const checked = selected.has(skill.id);
        return (
          <label
            key={skill.id}
            className={cn(
              'flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors',
              checked ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-muted/40',
              disabled && 'opacity-60 cursor-not-allowed',
            )}
          >
            <Checkbox
              checked={checked}
              disabled={disabled}
              onCheckedChange={() => toggleSkill(skill.id)}
              className="mt-0.5"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="font-medium text-sm">{skill.name}</span>
                <Badge variant="secondary" className="text-xs">
                  {skill.slug}
                </Badge>
              </div>
              {skill.description ? (
                <p className="text-xs text-muted-foreground mt-1">{skill.description}</p>
              ) : null}
            </div>
          </label>
        );
      })}
    </div>
  );
}
