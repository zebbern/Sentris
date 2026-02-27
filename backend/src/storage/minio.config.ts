import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';
import type { MinioEnvConfig } from '../config';

@Injectable()
export class MinioConfig {
  private readonly logger = new Logger(MinioConfig.name);
  private client: Client;
  private readonly bucketName = 'shipsec-files';

  constructor(private readonly configService: ConfigService) {
    const minioCfg = this.configService.get<MinioEnvConfig>('minio')!;
    const endpointEnv = minioCfg.endpoint;
    const portEnv = minioCfg.port;
    const useSSLEnv = minioCfg.useSsl;

    const { endPoint, port, useSSL } = this.normalizeEndpoint(endpointEnv, portEnv, useSSLEnv);
    const accessKey = minioCfg.rootUser;
    const secretKey = minioCfg.rootPassword;

    this.client = new Client({
      endPoint,
      port,
      useSSL,
      accessKey,
      secretKey,
    });

    this.ensureBucket();
  }

  getClient(): Client {
    return this.client;
  }

  getBucketName(): string {
    return this.bucketName;
  }

  private async ensureBucket() {
    try {
      const exists = await this.client.bucketExists(this.bucketName);
      if (!exists) {
        await this.client.makeBucket(this.bucketName, 'us-east-1');
        this.logger.log(`Created MinIO bucket: ${this.bucketName}`);
      }
    } catch (error) {
      this.logger.error(`Failed to ensure MinIO bucket exists:`, error);
    }
  }

  private normalizeEndpoint(endpointEnv: string, portEnv?: string, useSSLEnv?: string) {
    let endPoint = endpointEnv;
    let port = this.parsePort(portEnv) ?? 9000;
    let useSSL = useSSLEnv === 'true';

    if (endpointEnv.includes('://')) {
      const url = new URL(endpointEnv);
      endPoint = url.hostname;
      port = this.parsePort(url.port) ?? port ?? (url.protocol === 'https:' ? 443 : 80);
      if (useSSLEnv === undefined) {
        useSSL = url.protocol === 'https:';
      }
    } else if (endpointEnv.includes(':')) {
      const [host, maybePort] = endpointEnv.split(':');
      endPoint = host;
      port = this.parsePort(maybePort) ?? port;
    }

    return { endPoint, port, useSSL };
  }

  private parsePort(value?: string) {
    if (!value) {
      return undefined;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
}
