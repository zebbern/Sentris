import { describe, expect, it } from 'bun:test';
import { materializeFileBundle } from '../bundle-files';

describe('scanner bundle materialization', () => {
  it('expands FILE marker bundles into scanner-safe filenames with original extensions', () => {
    const files = materializeFileBundle(
      [
        '# FILE: src/server.js',
        'app.get("/search", (req, res) => res.send(req.query.q));',
        '# FILE: infra/main.tf',
        'resource "aws_s3_bucket" "public" {}',
      ].join('\n'),
      'target-code.txt',
    );

    expect(Object.keys(files)).toEqual(['001-src__server.js', '002-infra__main.tf']);
    expect(files['001-src__server.js']).toContain('req.query.q');
    expect(files['002-infra__main.tf']).toContain('aws_s3_bucket');
  });

  it('falls back to a single default file when content is not a FILE marker bundle', () => {
    expect(materializeFileBundle('console.log("plain");', 'target-code.txt')).toEqual({
      'target-code.txt': 'console.log("plain");',
    });
  });

  it('sanitizes unsafe or hidden path segments while preserving useful extensions', () => {
    const files = materializeFileBundle(
      ['# FILE: .github/workflows/build.yml', 'name: build'].join('\n'),
      'target-code.txt',
    );

    expect(Object.keys(files)).toEqual(['001-github__workflows__build.yml']);
    expect(files['001-github__workflows__build.yml']).toContain('name: build');
  });
});
