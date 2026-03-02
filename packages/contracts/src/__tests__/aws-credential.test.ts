import { describe, it, expect } from 'bun:test';
import { getPortMeta } from '@sentris/component-sdk';

import {
  awsCredentialContractName,
  awsCredentialSchema,
} from '../index';

describe('awsCredentialSchema', () => {
  const schema = awsCredentialSchema();

  it('parses valid input with all fields', () => {
    const input = {
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      sessionToken: 'FwoGZXIvYXdzEBY...',
      region: 'us-east-1',
    };
    const result = schema.parse(input);
    expect(result).toEqual(input);
  });

  it('parses valid input with only required fields', () => {
    const input = {
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    };
    const result = schema.parse(input);
    expect(result.accessKeyId).toBe(input.accessKeyId);
    expect(result.secretAccessKey).toBe(input.secretAccessKey);
  });

  it('rejects missing accessKeyId', () => {
    expect(() => schema.parse({ secretAccessKey: 'secret' })).toThrow();
  });

  it('rejects missing secretAccessKey', () => {
    expect(() => schema.parse({ accessKeyId: 'AKIA...' })).toThrow();
  });

  it('rejects empty object', () => {
    expect(() => schema.parse({})).toThrow();
  });

  it('has correct port metadata', () => {
    const meta = getPortMeta(schema);
    expect(meta).toBeDefined();
    expect(meta?.schemaName).toBe(awsCredentialContractName);
    expect(meta?.isCredential).toBe(true);
  });
});

describe('awsCredentialContractName', () => {
  it('equals core.credential.aws', () => {
    expect(awsCredentialContractName).toBe('core.credential.aws');
  });
});
