import {
  CheckCircle2,
  Shield,
  Activity,
  Zap,
  BarChart3,
  Database,
  Link,
  TestTube2,
  MoreHorizontal,
  AlertTriangle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// ---------------------------------------------------------------------------
// Workflow graph data
// ---------------------------------------------------------------------------

export interface WorkflowGraphData {
  nodes: { id: string; [key: string]: unknown }[];
  edges?: { source: string; target: string; [key: string]: unknown }[];
}

export function hasGraphNodes(graph: unknown): graph is WorkflowGraphData {
  return (
    typeof graph === 'object' &&
    graph !== null &&
    'nodes' in graph &&
    Array.isArray((graph as WorkflowGraphData).nodes) &&
    (graph as WorkflowGraphData).nodes.length > 0
  );
}

// ---------------------------------------------------------------------------
// Category styling
// ---------------------------------------------------------------------------

export interface CategoryStyle {
  icon: LucideIcon;
  badge: string;
  gradient: string;
  accent: string;
}

export const CATEGORY_STYLES: Record<string, CategoryStyle> = {
  security: {
    icon: Shield,
    badge:
      'bg-red-100 text-red-700 border-red-200/60 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800/40',
    gradient: 'from-red-500/8 via-orange-500/5 to-transparent',
    accent: 'text-red-600 dark:text-red-400',
  },
  monitoring: {
    icon: Activity,
    badge:
      'bg-blue-100 text-blue-700 border-blue-200/60 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800/40',
    gradient: 'from-blue-500/8 via-cyan-500/5 to-transparent',
    accent: 'text-blue-600 dark:text-blue-400',
  },
  compliance: {
    icon: CheckCircle2,
    badge:
      'bg-emerald-100 text-emerald-700 border-emerald-200/60 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800/40',
    gradient: 'from-emerald-500/8 via-green-500/5 to-transparent',
    accent: 'text-emerald-600 dark:text-emerald-400',
  },
  'incident response': {
    icon: AlertTriangle,
    badge:
      'bg-amber-100 text-amber-700 border-amber-200/60 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800/40',
    gradient: 'from-amber-500/8 via-yellow-500/5 to-transparent',
    accent: 'text-amber-600 dark:text-amber-400',
  },
  'data processing': {
    icon: Database,
    badge:
      'bg-purple-100 text-purple-700 border-purple-200/60 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800/40',
    gradient: 'from-purple-500/8 via-violet-500/5 to-transparent',
    accent: 'text-purple-600 dark:text-purple-400',
  },
  integration: {
    icon: Link,
    badge:
      'bg-teal-100 text-teal-700 border-teal-200/60 dark:bg-teal-900/30 dark:text-teal-300 dark:border-teal-800/40',
    gradient: 'from-teal-500/8 via-cyan-500/5 to-transparent',
    accent: 'text-teal-600 dark:text-teal-400',
  },
  automation: {
    icon: Zap,
    badge:
      'bg-indigo-100 text-indigo-700 border-indigo-200/60 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800/40',
    gradient: 'from-indigo-500/8 via-blue-500/5 to-transparent',
    accent: 'text-indigo-600 dark:text-indigo-400',
  },
  reporting: {
    icon: BarChart3,
    badge:
      'bg-emerald-100 text-emerald-700 border-emerald-200/60 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800/40',
    gradient: 'from-emerald-500/8 via-teal-500/5 to-transparent',
    accent: 'text-emerald-600 dark:text-emerald-400',
  },
  testing: {
    icon: TestTube2,
    badge:
      'bg-pink-100 text-pink-700 border-pink-200/60 dark:bg-pink-900/30 dark:text-pink-300 dark:border-pink-800/40',
    gradient: 'from-pink-500/8 via-rose-500/5 to-transparent',
    accent: 'text-pink-600 dark:text-pink-400',
  },
  other: {
    icon: MoreHorizontal,
    badge:
      'bg-slate-100 text-slate-700 border-slate-200/60 dark:bg-slate-800/50 dark:text-slate-300 dark:border-slate-700/40',
    gradient: 'from-slate-500/8 via-gray-500/5 to-transparent',
    accent: 'text-slate-600 dark:text-slate-400',
  },
};

const DEFAULT_CATEGORY_STYLE: CategoryStyle = CATEGORY_STYLES.other;

export function getCategoryStyle(category?: string | null): CategoryStyle {
  if (!category) return DEFAULT_CATEGORY_STYLE;
  return CATEGORY_STYLES[category.toLowerCase()] || DEFAULT_CATEGORY_STYLE;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function toTitleCase(str: string): string {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}
