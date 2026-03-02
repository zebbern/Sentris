import { describe, it, expect } from 'bun:test';
import { getPortMeta } from '@sentris/component-sdk';

import {
  secretMetadataContractName,
  secretMetadataSchema,
  fileContractName,
  fileContractSchema,
  destinationWriterContractName,
  destinationWriterSchema,
} from '../index';

describe('secretMetadataSchema', () => {
  const schema = secretMetadataSchema();

  it('parses valid input with raw format', () => {
    const input = { secretId: 'sec-123', version: 1, format: 'raw' };
    expect(schema.parse(input)).toMatchObject(input);
  });

  it('parses valid input with json format', () => {
    const input = { secretId: 'sec-456', version: 2, format: 'json' };
    expect(schema.parse(input)).toMatchObject(input);
  });

  it('rejects missing secretId', () => {
    expect(() => schema.parse({ version: 1, format: 'raw' })).toThrow();
  });

  it('rejects missing version', () => {
    expect(() => schema.parse({ secretId: 's', format: 'raw' })).toThrow();
  });

  it('rejects missing format', () => {
    expect(() => schema.parse({ secretId: 's', version: 1 })).toThrow();
  });

  it('rejects invalid format value', () => {
    expect(() =>
      schema.parse({ secretId: 's', version: 1, format: 'xml' }),
    ).toThrow();
  });

  it('has correct port metadata', () => {
    const meta = getPortMeta(schema);
    expect(meta).toBeDefined();
    expect(meta?.schemaName).toBe(secretMetadataContractName);
  });
});

describe('secretMetadataContractName', () => {
  it('equals core.secret-fetch.metadata.v1', () => {
    expect(secretMetadataContractName).toBe('core.secret-fetch.metadata.v1');
  });
});

describe('fileContractSchema', () => {
  const schema = fileContractSchema();

  it('parses valid input with all fields', () => {
    const input = {
      id: 'file-1',
      name: 'report.pdf',
      mimeType: 'application/pdf',
      size: 1024,
      content: 'base64content...',
    };
    expect(schema.parse(input)).toMatchObject(input);
  });

  it('rejects missing id', () => {
    expect(() =>
      schema.parse({ name: 'f', mimeType: 'text/plain', size: 10, content: 'c' }),
    ).toThrow();
  });

  it('rejects missing name', () => {
    expect(() =>
      schema.parse({ id: 'f', mimeType: 'text/plain', size: 10, content: 'c' }),
    ).toThrow();
  });

  it('rejects missing mimeType', () => {
    expect(() =>
      schema.parse({ id: 'f', name: 'f', size: 10, content: 'c' }),
    ).toThrow();
  });

  it('rejects missing size', () => {
    expect(() =>
      schema.parse({ id: 'f', name: 'f', mimeType: 'text/plain', content: 'c' }),
    ).toThrow();
  });

  it('rejects missing content', () => {
    expect(() =>
      schema.parse({ id: 'f', name: 'f', mimeType: 'text/plain', size: 10 }),
    ).toThrow();
  });

  it('has correct port metadata', () => {
    const meta = getPortMeta(schema);
    expect(meta).toBeDefined();
    expect(meta?.schemaName).toBe(fileContractName);
  });
});

describe('fileContractName', () => {
  it('equals sentris.file.v1', () => {
    expect(fileContractName).toBe('sentris.file.v1');
  });
});

describe('destinationWriterSchema', () => {
  const schema = destinationWriterSchema();

  it('parses valid input with adapterId only', () => {
    const result = schema.parse({ adapterId: 'slack' });
    expect(result.adapterId).toBe('slack');
  });

  it('parses valid input with all optional fields', () => {
    const input = {
      adapterId: 'email',
      config: { host: 'smtp.example.com', port: 587 },
      metadata: { label: 'Email Dest', description: 'Send email alerts' },
    };
    const result = schema.parse(input);
    expect(result.adapterId).toBe('email');
    expect(result.config).toEqual({ host: 'smtp.example.com', port: 587 });
    expect(result.metadata).toEqual({
      label: 'Email Dest',
      description: 'Send email alerts',
    });
  });

  it('applies default empty config when omitted', () => {
    const result = schema.parse({ adapterId: 'webhook' });
    expect(result.config).toEqual({});
  });

  it('rejects missing adapterId', () => {
    expect(() => schema.parse({})).toThrow();
  });

  it('has correct port metadata', () => {
    const meta = getPortMeta(schema);
    expect(meta).toBeDefined();
    expect(meta?.schemaName).toBe(destinationWriterContractName);
  });
});

describe('destinationWriterContractName', () => {
  it('equals destination.writer', () => {
    expect(destinationWriterContractName).toBe('destination.writer');
  });
});
