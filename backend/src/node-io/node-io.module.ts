import { Module } from '@nestjs/common';
import { NodeIORepository } from './node-io.repository';
import { NodeIOService } from './node-io.service';
import { NodeIOIngestService } from './node-io-ingest.service';
import { DatabaseModule } from '../database/database.module';
import { StorageModule } from '../storage/storage.module';
import { KafkaIngestRuntimeModule } from '../common/kafka-ingest-runtime.module';

@Module({
  imports: [DatabaseModule, StorageModule, KafkaIngestRuntimeModule],
  providers: [NodeIORepository, NodeIOService, NodeIOIngestService],
  exports: [NodeIOService, NodeIORepository],
})
export class NodeIOModule {}
