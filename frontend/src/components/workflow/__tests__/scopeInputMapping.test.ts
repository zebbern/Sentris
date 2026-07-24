import { describe, it, expect } from 'bun:test';
import { mergeScopeValues } from '../scopeInputMapping';

const scope = {
  domains: ['example.com', 'app.example.com'],
  repos: ['github.com/example/app'],
  ipRanges: ['10.0.0.0/24'],
  runtimeValues: {},
};

describe('mergeScopeValues', () => {
  it('fills an array domains input with the whole domains bucket', () => {
    const out = mergeScopeValues({}, scope, [{ id: 'domains', type: 'array' }]);
    expect(out.domains).toEqual(['example.com', 'app.example.com']);
  });

  it('fills a singular text domain input with the first domain', () => {
    const out = mergeScopeValues({}, scope, [{ id: 'domain', type: 'text' }]);
    expect(out.domain).toBe('example.com');
  });

  it('maps repos to a repositoryUrl input (first element for text)', () => {
    const out = mergeScopeValues({}, scope, [{ id: 'repositoryUrl', type: 'text' }]);
    expect(out.repositoryUrl).toBe('github.com/example/app');
  });

  it('maps ipRanges to an ipRanges array input', () => {
    const out = mergeScopeValues({}, scope, [{ id: 'ipRanges', type: 'array' }]);
    expect(out.ipRanges).toEqual(['10.0.0.0/24']);
  });

  it('does NOT fill an unrelated input (packageSpecs)', () => {
    const out = mergeScopeValues({ packageSpecs: ['left'] }, scope, [
      { id: 'packageSpecs', type: 'array' },
    ]);
    expect(out.packageSpecs).toEqual(['left']); // unchanged default
  });

  it('preserves defaults for inputs the scope does not cover', () => {
    const out = mergeScopeValues({ authorizationNotes: 'keep' }, scope, [
      { id: 'domains', type: 'array' },
      { id: 'authorizationNotes', type: 'text' },
    ]);
    expect(out.authorizationNotes).toBe('keep');
    expect(out.domains).toEqual(['example.com', 'app.example.com']);
  });

  it('lets explicit runtimeValues override the auto-map by exact id', () => {
    const s = { ...scope, runtimeValues: { domains: ['override.com'] } };
    const out = mergeScopeValues({}, s, [{ id: 'domains', type: 'array' }]);
    expect(out.domains).toEqual(['override.com']);
  });

  it('ignores runtimeValues keys that are not declared runtime inputs', () => {
    const s = { ...scope, runtimeValues: { notAnInput: 'x' } };
    const out = mergeScopeValues({}, s, [{ id: 'domains', type: 'array' }]);
    expect(out.notAnInput).toBeUndefined();
  });

  it('skips empty buckets (no domains → does not set the input)', () => {
    const s = { domains: [], repos: [], ipRanges: [], runtimeValues: {} };
    const out = mergeScopeValues({}, s, [{ id: 'domains', type: 'array' }]);
    expect('domains' in out).toBe(false);
  });

  it("normalizes 'string' type to text (first element)", () => {
    const out = mergeScopeValues({}, scope, [{ id: 'target', type: 'string' }]);
    expect(out.target).toBe('example.com');
  });
});
