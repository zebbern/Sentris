import { Module } from '@nestjs/common';

// Register worker components so the registry is populated before controllers run
import '@sentris/studio-worker/components';

import { ComponentsController } from './components.controller';

@Module({
  controllers: [ComponentsController],
  exports: [],
})
export class ComponentsModule {}
