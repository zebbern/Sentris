import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { ScopesController } from './scopes.controller';
import { ScopesRepository } from './scopes.repository';
import { ScopesService } from './scopes.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ScopesController],
  providers: [ScopesService, ScopesRepository],
  exports: [ScopesService],
})
export class ScopesModule {}
