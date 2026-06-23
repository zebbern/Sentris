import { Module } from '@nestjs/common';

import { SecretsModule } from '../secrets/secrets.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  imports: [SecretsModule],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
