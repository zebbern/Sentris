export interface RemovedOfficialSeedTemplate {
  name: string;
  path: string;
}

export const REMOVED_OFFICIAL_SEED_TEMPLATES: RemovedOfficialSeedTemplate[] = [
  {
    name: 'GitHub Dependency CVE Hunt → Discord',
    path: 'templates/github-dependency-cve-hunt-discord-report.json',
  },
  {
    name: 'Public Repo Full Code Security → Discord',
    path: 'templates/public-repo-full-code-security-discord-report.json',
  },
  {
    name: 'Security Scan Discord Report',
    path: 'templates/security-scan-discord-report.json',
  },
];
