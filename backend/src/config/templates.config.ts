import { registerAs } from '@nestjs/config';

export interface TemplatesConfig {
  github: {
    token: string | undefined;
    repo: string;
    branch: string;
  };
}

export const templatesConfig = registerAs<TemplatesConfig>('templates', () => ({
  github: {
    token: process.env.GITHUB_TEMPLATE_TOKEN,
    repo: process.env.GITHUB_TEMPLATE_REPO ?? 'zebbern/sentris-templates',
    branch: process.env.GITHUB_TEMPLATE_BRANCH ?? 'main',
  },
}));
