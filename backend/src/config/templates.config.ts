import { registerAs } from '@nestjs/config';

export const DEFAULT_COMMUNITY_TEMPLATES_INDEX_URL =
  'https://raw.githubusercontent.com/zebbern/Sentris/main/community/template/index.json';

export interface TemplatesConfig {
  github: {
    token: string | undefined;
    repo: string;
    branch: string;
  };
  community: {
    indexUrl: string;
  };
}

export const templatesConfig = registerAs<TemplatesConfig>('templates', () => ({
  github: {
    token: process.env.GITHUB_TEMPLATE_TOKEN,
    repo: process.env.GITHUB_TEMPLATE_REPO ?? 'zebbern/sentris-templates',
    branch: process.env.GITHUB_TEMPLATE_BRANCH ?? 'main',
  },
  community: {
    indexUrl: process.env.COMMUNITY_TEMPLATES_INDEX_URL ?? DEFAULT_COMMUNITY_TEMPLATES_INDEX_URL,
  },
}));
