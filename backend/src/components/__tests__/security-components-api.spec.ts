import { beforeAll, describe, expect, it } from 'bun:test';
import '@sentris/worker/components';
import { componentRegistry } from '@sentris/component-sdk';
import {
  SECURITY_COMPONENT_IDS,
  PARAMETER_FIELD_RENDERABLE_TYPES,
} from '@sentris/worker/components/security/security-component-manifest';
import { categorizeComponent, getCategoryConfig } from '../utils/categorization';

const FRONTEND_PARAMETER_TYPES = [...PARAMETER_FIELD_RENDERABLE_TYPES, 'file'] as const;

function serializeComponent(entry: ReturnType<typeof componentRegistry.listMetadata>[number]) {
  const component = entry.definition;
  const metadata = component.ui ?? {
    slug: component.id,
    version: '1.0.0',
    type: 'process',
    category: 'transform',
  };
  const category = categorizeComponent(component);
  const categoryConfig = getCategoryConfig(category);

  return {
    id: component.id,
    slug: metadata.slug ?? component.id,
    name: component.label,
    category,
    categoryConfig,
    runner: component.runner,
    inputs: entry.inputs ?? [],
    outputs: entry.outputs ?? [],
    parameters: entry.parameters ?? [],
  };
}

describe('security components API payload', () => {
  beforeAll(() => {
    for (const componentId of SECURITY_COMPONENT_IDS) {
      if (!componentRegistry.has(componentId)) {
        throw new Error(`Missing security component registration: ${componentId}`);
      }
    }
  });

  it('serializes every security palette component with metadata fields', () => {
    const metadata = componentRegistry.listMetadata();
    const payloads = SECURITY_COMPONENT_IDS.map((componentId) => {
      const entry = metadata.find((item) => item.definition.id === componentId);
      if (!entry) {
        throw new Error(`Missing metadata for ${componentId}`);
      }
      return serializeComponent(entry);
    });

    for (const payload of payloads) {
      expect(payload.name.trim().length).toBeGreaterThan(0);
      expect(payload.inputs.length + payload.parameters.length).toBeGreaterThan(0);
      expect(payload.outputs.length).toBeGreaterThan(0);
      expect(payload.runner?.kind).toBeDefined();

      for (const parameter of payload.parameters) {
        expect(parameter.id.trim().length).toBeGreaterThan(0);
        expect(parameter.label.trim().length).toBeGreaterThan(0);
        expect(FRONTEND_PARAMETER_TYPES).toContain(parameter.type);
      }
    }
  });

  it('maps security and mcp runners consistently with the registry', () => {
    const metadata = componentRegistry.listMetadata();
    for (const componentId of SECURITY_COMPONENT_IDS) {
      const entry = metadata.find((item) => item.definition.id === componentId);
      expect(entry).toBeDefined();
      const payload = serializeComponent(entry!);
      expect(payload.runner).toEqual(entry!.definition.runner);
      if (payload.runner?.kind === 'docker') {
        expect((payload.runner as { image?: string }).image?.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
