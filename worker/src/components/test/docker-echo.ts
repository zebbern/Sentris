/**
 * Test component that uses Docker runner with a simple echo command
 * Used to verify Docker runner implementation
 */
import { z } from 'zod';
import {
  componentRegistry,
  ContainerError,
  defineComponent,
  inputs,
  outputs,
  port,
  runComponentWithRunner,
} from '@sentris/component-sdk';

const inputSchema = inputs({
  message: port(z.string(), {
    label: 'Message',
    description: 'Message to echo via the Docker container.',
  }),
});

const outputSchema = outputs({
  message: port(z.string(), {
    label: 'Message',
    description: 'Echoed message from the container.',
  }),
});

const dockerRunner = {
  kind: 'docker' as const,
  image: 'alpine:3.20',
  command: ['sh', '-c', 'cat'],
  timeoutSeconds: 10,
};

const definition = defineComponent({
  id: 'test.docker.echo',
  label: 'Docker Echo Test',
  category: 'transform',
  runner: dockerRunner,
  inputs: inputSchema,
  outputs: outputSchema,
  docs: 'Test component that echoes input using Docker (alpine)',
  async execute({ inputs: parsedInputs }, context) {
    return runComponentWithRunner(
      dockerRunner,
      async () => {
        throw new ContainerError('Docker echo cannot execute inline', {
          details: { reason: 'inline_fallback_not_supported' },
        });
      },
      parsedInputs,
      context,
    );
  },
});

if (!componentRegistry.has(definition.id)) {
  componentRegistry.register(definition);
}

export default definition;
