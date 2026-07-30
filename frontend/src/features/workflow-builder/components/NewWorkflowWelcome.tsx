import { ArrowRight, Blocks, Sparkles, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface NewWorkflowWelcomeProps {
  onDismiss: () => void;
}

export function NewWorkflowWelcome({ onDismiss }: NewWorkflowWelcomeProps) {
  return (
    <Card
      className="absolute left-1/2 top-1/2 z-30 w-[calc(100%_-_2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 border-primary/20 bg-background/95 shadow-2xl backdrop-blur"
      aria-labelledby="new-workflow-welcome-title"
    >
      <button
        type="button"
        onClick={onDismiss}
        className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Dismiss welcome"
      >
        <X className="h-4 w-4" />
      </button>

      <CardHeader className="pb-4 pr-12">
        <Badge variant="secondary" className="mb-2 w-fit gap-1">
          <Sparkles className="h-3 w-3" />
          Recommended
        </Badge>
        <CardTitle id="new-workflow-welcome-title" className="text-xl">
          Start your first useful workflow
        </CardTitle>
        <CardDescription>
          Run a proven template quickly, or keep the blank canvas and build exactly what you need.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-3 sm:grid-cols-2">
        <Button
          asChild
          className="h-auto justify-between gap-3 whitespace-normal px-4 py-3 text-left"
        >
          <Link to="/templates?setup=none">
            <span>
              <span className="block">Start with a proven template</span>
              <span className="mt-0.5 block text-xs font-normal opacity-80">
                Browse workflows that need little or no setup
              </span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0" />
          </Link>
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={onDismiss}
          className="h-auto justify-start gap-3 whitespace-normal px-4 py-3 text-left"
        >
          <Blocks className="h-4 w-4 shrink-0" />
          <span>
            <span className="block">Build from scratch</span>
            <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
              Continue with the empty workflow builder
            </span>
          </span>
        </Button>
      </CardContent>
    </Card>
  );
}
