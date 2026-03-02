import { describe, it, expect } from 'bun:test';
import {
  categoryLabels,
  categoryOrder,
  MAX_RESULTS_PER_CATEGORY,
  type CommandCategory,
} from '../command-palette-types';

// ---------------------------------------------------------------------------
// categoryLabels
// ---------------------------------------------------------------------------

describe('categoryLabels', () => {
  const ALL_CATEGORIES: CommandCategory[] = [
    'navigation',
    'workflows',
    'actions',
    'settings',
    'components',
    'templates',
    'schedules',
    'secrets',
    'api-keys',
    'webhooks',
  ];

  it('has a label for every CommandCategory value', () => {
    for (const cat of ALL_CATEGORIES) {
      expect(categoryLabels[cat]).toBeDefined();
      expect(typeof categoryLabels[cat]).toBe('string');
      expect(categoryLabels[cat].length).toBeGreaterThan(0);
    }
  });

  it('has no extra keys beyond CommandCategory', () => {
    const labelKeys = Object.keys(categoryLabels);
    expect(labelKeys.sort()).toEqual(ALL_CATEGORIES.sort());
  });
});

// ---------------------------------------------------------------------------
// categoryOrder
// ---------------------------------------------------------------------------

describe('categoryOrder', () => {
  it('includes every CommandCategory exactly once', () => {
    const allCategories: CommandCategory[] = [
      'navigation',
      'workflows',
      'actions',
      'settings',
      'components',
      'templates',
      'schedules',
      'secrets',
      'api-keys',
      'webhooks',
    ];

    expect(categoryOrder).toHaveLength(allCategories.length);

    for (const cat of allCategories) {
      expect(categoryOrder).toContain(cat);
    }
  });

  it('has no duplicate entries', () => {
    const unique = new Set(categoryOrder);
    expect(unique.size).toBe(categoryOrder.length);
  });
});

// ---------------------------------------------------------------------------
// MAX_RESULTS_PER_CATEGORY
// ---------------------------------------------------------------------------

describe('MAX_RESULTS_PER_CATEGORY', () => {
  it('is a positive number', () => {
    expect(MAX_RESULTS_PER_CATEGORY).toBeGreaterThan(0);
  });

  it('equals 5', () => {
    expect(MAX_RESULTS_PER_CATEGORY).toBe(5);
  });
});
