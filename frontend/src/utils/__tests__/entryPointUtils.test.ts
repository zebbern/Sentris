import { describe, expect, it } from 'bun:test';

import {
  ENTRY_COMPONENT_ID,
  ENTRY_COMPONENT_SLUG,
  ENTRY_POINT_COMPONENT_IDS,
  isEntryPointComponentRef,
  isEntryPointNode,
} from '../entryPointUtils';

describe('entry point constants', () => {
  it('ENTRY_COMPONENT_ID has the expected value', () => {
    expect(ENTRY_COMPONENT_ID).toBe('core.workflow.entrypoint');
  });

  it('ENTRY_COMPONENT_SLUG has the expected value', () => {
    expect(ENTRY_COMPONENT_SLUG).toBe('entry-point');
  });

  it('ENTRY_POINT_COMPONENT_IDS contains both identifiers', () => {
    expect(ENTRY_POINT_COMPONENT_IDS).toContain(ENTRY_COMPONENT_ID);
    expect(ENTRY_POINT_COMPONENT_IDS).toContain(ENTRY_COMPONENT_SLUG);
    expect(ENTRY_POINT_COMPONENT_IDS).toHaveLength(2);
  });
});

describe('isEntryPointComponentRef', () => {
  it('returns true for ENTRY_COMPONENT_ID', () => {
    expect(isEntryPointComponentRef(ENTRY_COMPONENT_ID)).toBe(true);
  });

  it('returns true for ENTRY_COMPONENT_SLUG', () => {
    expect(isEntryPointComponentRef(ENTRY_COMPONENT_SLUG)).toBe(true);
  });

  it('returns false for a non-matching ref', () => {
    expect(isEntryPointComponentRef('some.other.component')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isEntryPointComponentRef(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isEntryPointComponentRef(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isEntryPointComponentRef('')).toBe(false);
  });
});

describe('isEntryPointNode', () => {
  it('returns true for node with componentId matching entry point', () => {
    expect(isEntryPointNode({ data: { componentId: ENTRY_COMPONENT_ID } })).toBe(true);
  });

  it('returns true for node with componentSlug matching entry point', () => {
    expect(isEntryPointNode({ data: { componentSlug: ENTRY_COMPONENT_SLUG } })).toBe(true);
  });

  it('returns false for node with non-matching componentId', () => {
    expect(isEntryPointNode({ data: { componentId: 'other.component' } })).toBe(false);
  });

  it('returns false for node with no data', () => {
    expect(isEntryPointNode({ data: undefined })).toBe(false);
  });

  it('returns false for null node', () => {
    expect(isEntryPointNode(null)).toBe(false);
  });

  it('returns false for undefined node', () => {
    expect(isEntryPointNode(undefined)).toBe(false);
  });

  it('returns false for node with empty data', () => {
    expect(isEntryPointNode({ data: {} })).toBe(false);
  });

  it('prefers componentId over componentSlug', () => {
    expect(
      isEntryPointNode({
        data: {
          componentId: ENTRY_COMPONENT_ID,
          componentSlug: 'other-slug',
        },
      }),
    ).toBe(true);
  });
});
