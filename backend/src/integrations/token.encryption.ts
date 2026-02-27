import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SecretEncryption, SecretEncryptionMaterial, parseMasterKey } from '@shipsec/shared';
import type { IntegrationsEnvConfig, SecretsConfig } from '../config';

const DEFAULT_DEV_KEY = 'fedcba9876543210fedcba9876543210';

/**
 * Encryption helper used for storing OAuth credentials at rest.
 *
 * Mirrors the behaviour of the secrets encryption service but avoids logging decrypted payloads.
 */
@Injectable()
export class TokenEncryptionService {
  private readonly logger = new Logger(TokenEncryptionService.name);
  private readonly encryptor: SecretEncryption;

  constructor(private readonly configService: ConfigService) {
    const integrations = this.configService.get<IntegrationsEnvConfig>('integrations')!;
    const secrets = this.configService.get<SecretsConfig>('secrets')!;
    const rawKey = integrations.masterKey ?? secrets.masterKey ?? DEFAULT_DEV_KEY;

    if (!integrations.masterKey && !secrets.masterKey) {
      this.logger.warn(
        'INTEGRATION_STORE_MASTER_KEY is not configured. Falling back to insecure development key.',
      );
    }

    const masterKey = parseMasterKey(rawKey);
    this.encryptor = new SecretEncryption(masterKey, 'integrations');
  }

  async encrypt(value: string): Promise<SecretEncryptionMaterial> {
    return this.encryptor.encrypt(value);
  }

  async decrypt(material: SecretEncryptionMaterial): Promise<string> {
    return this.encryptor.decrypt(material);
  }

  get keyId(): string {
    return this.encryptor.keyIdentifier;
  }
}
