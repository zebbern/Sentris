import { Module } from '@nestjs/common';
import { NodeIORepository } from './node-io.repository';
import { NodeIOService } from './node-io.service';
import { NodeIOIngestService } from './node-io-ingest.service';
import { DatabaseModule } from '../database/database.module';
import { StorageModule } from '../storage/storage.module';
import { ingestConfig, type IngestConfig } from '../config';

const cfg = ingestConfig() as IngestConfig;
const ingestServicesEnabled = cfg.enableIngestServices && !cfg.skipIngestServices;

const ingestServices = ingestServicesEnabled ? [NodeIOIngestService] : [];

@Module({
  imports: [DatabaseModule, StorageModule],
  providers: [NodeIORepository, NodeIOService, ...ingestServices],
  exports: [NodeIOService, NodeIORepository],
})
export class NodeIOModule {}
