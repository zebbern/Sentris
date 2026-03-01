export interface PublishTemplateModalProps {
  workflowId: string;
  workflowName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export const DEFAULT_GITHUB_TEMPLATE_REPO =
  import.meta.env.VITE_GITHUB_TEMPLATE_REPO || 'zebbern/sentris-templates';
export const DEFAULT_GITHUB_BRANCH = import.meta.env.VITE_GITHUB_TEMPLATE_BRANCH || 'main';

export const TEMPLATE_CATEGORIES = [
  'Security',
  'Monitoring',
  'Compliance',
  'Incident Response',
  'Data Processing',
  'Integration',
  'Automation',
  'Reporting',
  'Testing',
  'Other',
];

export const COMMON_TAGS = [
  'security',
  'monitoring',
  'automation',
  'integration',
  'api',
  'notification',
  'compliance',
  'scanning',
  'analysis',
  'reporting',
  'incident',
  'response',
  'forensics',
  'enrichment',
  'detection',
];

export interface WorkflowResponse {
  id: string;
  name: string;
  description?: string;
  manifest: Record<string, unknown>;
  graph: Record<string, unknown>;
}

export interface TemplateMetadata {
  name: string;
  description?: string;
  category: string;
  tags: string[];
  author: string;
  version: string;
}

export interface TemplateJson {
  _metadata: TemplateMetadata;
  graph: Record<string, unknown>;
  requiredSecrets: { name: string; type: string; description?: string }[];
}

export type PublishStep = 'configure' | 'review' | 'publish' | 'done';

export const PUBLISH_STEPS: { key: PublishStep; label: string }[] = [
  { key: 'configure', label: 'Configure' },
  { key: 'review', label: 'Review' },
  { key: 'publish', label: 'Publish' },
  { key: 'done', label: 'Done' },
];
