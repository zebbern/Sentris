import { describe, expect, it } from 'bun:test';
import { officialTemplateRepoUrl } from '../officialRepo';

describe('officialTemplateRepoUrl', () => {
  it('prefers the API url field', () => {
    expect(
      officialTemplateRepoUrl({
        owner: 'acme',
        repo: 'templates',
        branch: 'main',
        url: 'https://github.com/acme/templates',
      }),
    ).toBe('https://github.com/acme/templates');
  });

  it('builds a url from owner/repo when url is missing', () => {
    expect(
      officialTemplateRepoUrl({
        owner: 'acme',
        repo: 'templates',
        branch: 'main',
        url: '',
      }),
    ).toBe('https://github.com/acme/templates');
  });

  it('falls back to the default official template repo', () => {
    expect(officialTemplateRepoUrl(null)).toBe('https://github.com/zebbern/sentris-templates');
    expect(officialTemplateRepoUrl(undefined)).toBe('https://github.com/zebbern/sentris-templates');
  });
});
