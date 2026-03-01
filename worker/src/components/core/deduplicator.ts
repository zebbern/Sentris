import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@sentris/component-sdk';

const inputSchema = inputs({
  items: port(z.array(z.record(z.string(), z.unknown())), {
    label: 'Items',
    description: 'Array of objects to deduplicate.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
});

const statsSchema = z.object({
  total: z.number(),
  unique: z.number(),
  duplicatesRemoved: z.number(),
});

const outputSchema = outputs({
  unique: port(z.array(z.record(z.string(), z.unknown())), {
    label: 'Unique Items',
    description: 'Deduplicated array (first occurrence wins).',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  duplicates: port(z.array(z.record(z.string(), z.unknown())), {
    label: 'Duplicates',
    description: 'Items that were removed as duplicates.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  stats: port(statsSchema, {
    label: 'Stats',
    description: 'Deduplication statistics.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
});

const parameterSchema = parameters({
  keys: param(z.array(z.string()).default([]), {
    label: 'Dedup Keys',
    editor: 'variable-list',
    description:
      'Fields to use for deduplication (e.g., ["hostname", "port"]). Empty = use entire object.',
  }),
  caseSensitive: param(z.boolean().default(true), {
    label: 'Case Sensitive',
    editor: 'boolean',
    description: 'Whether string comparisons are case-sensitive.',
  }),
});

/**
 * Build a deduplication key for an item based on the configured key fields.
 */
function buildDedupKey(
  item: Record<string, unknown>,
  keys: string[],
  caseSensitive: boolean,
): string {
  let raw: string;

  if (keys.length === 0) {
    // No keys specified — use the full object serialized
    raw = JSON.stringify(item);
  } else {
    // Concatenate values of the specified fields
    raw = keys
      .map((key) => {
        const value = item[key];
        if (value === undefined || value === null) return '';
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
      })
      .join('\x00'); // null byte separator to avoid key collisions
  }

  return caseSensitive ? raw : raw.toLowerCase();
}

const definition = defineComponent({
  id: 'sentris.deduplicator.run',
  label: 'Deduplicator',
  category: 'transform',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Removes duplicate items from arrays based on configurable key fields. First occurrence is kept; subsequent duplicates are separated into a dedicated output.',
  ui: {
    slug: 'deduplicator',
    version: '1.0.0',
    type: 'process',
    category: 'transform',
    description: 'Remove duplicate items from arrays based on configurable keys.',
    icon: 'Filter',
    author: {
      name: 'SentrisAI',
      type: 'sentris',
    },
    isLatest: true,
    deprecated: false,
    examples: [
      'Deduplicate subdomains discovered by multiple scanners before further enumeration.',
      'Remove duplicate findings across sequential Nuclei scans using template ID and host.',
    ],
  },
  async execute({ inputs, params }, context) {
    const { items } = inputs;
    const { keys, caseSensitive } = params;

    const seen = new Set<string>();
    const unique: Record<string, unknown>[] = [];
    const duplicates: Record<string, unknown>[] = [];

    for (const item of items) {
      const key = buildDedupKey(item, keys, caseSensitive);

      if (seen.has(key)) {
        duplicates.push(item);
      } else {
        seen.add(key);
        unique.push(item);
      }
    }

    const stats = {
      total: items.length,
      unique: unique.length,
      duplicatesRemoved: duplicates.length,
    };

    context.logger.info(
      `[Deduplicator] ${stats.total} items → ${stats.unique} unique, ${stats.duplicatesRemoved} duplicates removed` +
        (keys.length > 0 ? ` (keys: ${keys.join(', ')})` : ' (full object comparison)'),
    );

    context.emitProgress({
      message: `Deduplicated: ${stats.unique} unique from ${stats.total} total`,
      level: 'info',
      data: stats,
    });

    return { unique, duplicates, stats };
  },
});

componentRegistry.register(definition);

export default definition;
