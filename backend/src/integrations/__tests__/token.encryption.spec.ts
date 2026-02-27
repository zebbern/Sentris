import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { Logger } from '@nestjs/common';

import { TokenEncryptionService } from '../token.encryption';
import type { ConfigService } from '@nestjs/config';

function createMockConfigService(): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'integrations') {
        return { masterKey: process.env.INTEGRATION_STORE_MASTER_KEY };
      }
      if (key === 'secrets') {
        return { masterKey: process.env.SECRET_STORE_MASTER_KEY };
      }
      return undefined;
    },
  } as unknown as ConfigService;
}

const CUSTOM_KEY = 'abcdef1234567890abcdef1234567890'; // 32 hex chars

describe('TokenEncryptionService', () => {
  let savedIntegrationKey: string | undefined;
  let savedSecretKey: string | undefined;

  beforeEach(() => {
    savedIntegrationKey = process.env.INTEGRATION_STORE_MASTER_KEY;
    savedSecretKey = process.env.SECRET_STORE_MASTER_KEY;
    delete process.env.INTEGRATION_STORE_MASTER_KEY;
    delete process.env.SECRET_STORE_MASTER_KEY;
  });

  afterEach(() => {
    // Restore original env state
    if (savedIntegrationKey !== undefined) {
      process.env.INTEGRATION_STORE_MASTER_KEY = savedIntegrationKey;
    } else {
      delete process.env.INTEGRATION_STORE_MASTER_KEY;
    }
    if (savedSecretKey !== undefined) {
      process.env.SECRET_STORE_MASTER_KEY = savedSecretKey;
    } else {
      delete process.env.SECRET_STORE_MASTER_KEY;
    }
  });

  describe('encrypt/decrypt round-trip', () => {
    it('encrypts and decrypts back to the original plaintext using the dev key', async () => {
      const service = new TokenEncryptionService(createMockConfigService());
      const plaintext = 'oauth-token-abc123';

      const material = await service.encrypt(plaintext);

      // Verify SecretEncryptionMaterial shape
      expect(material).toHaveProperty('ciphertext');
      expect(material).toHaveProperty('iv');
      expect(material).toHaveProperty('authTag');
      expect(material).toHaveProperty('keyId');
      expect(typeof material.ciphertext).toBe('string');

      const decrypted = await service.decrypt(material);
      expect(decrypted).toBe(plaintext);
    });

    it('encrypts and decrypts with a custom INTEGRATION_STORE_MASTER_KEY', async () => {
      process.env.INTEGRATION_STORE_MASTER_KEY = CUSTOM_KEY;

      const service = new TokenEncryptionService(createMockConfigService());
      const plaintext = 'refresh-token-xyz789';

      const material = await service.encrypt(plaintext);
      const decrypted = await service.decrypt(material);

      expect(decrypted).toBe(plaintext);

      // Ciphertext from a custom key should differ from the dev key
      // (different key → different ciphertext, even for the same plaintext — but
      //  randomized IV guarantees different output regardless; we just verify both paths work)
      const devService = new TokenEncryptionService(createMockConfigService());
      delete process.env.INTEGRATION_STORE_MASTER_KEY;
      const devMaterial = await devService.encrypt(plaintext);

      expect(material.ciphertext).not.toBe(devMaterial.ciphertext);
    });
  });

  describe('dev key fallback', () => {
    it('logs a warning when falling back to the insecure dev key', () => {
      const loggerWarnSpy = spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

      const _service = new TokenEncryptionService(createMockConfigService());

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('insecure development key'),
      );

      loggerWarnSpy.mockRestore();
    });

    it('does not warn when SECRET_STORE_MASTER_KEY is set as fallback', () => {
      process.env.SECRET_STORE_MASTER_KEY = CUSTOM_KEY;

      const loggerWarnSpy = spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

      const _service = new TokenEncryptionService(createMockConfigService());

      expect(loggerWarnSpy).not.toHaveBeenCalled();
      loggerWarnSpy.mockRestore();
    });
  });

  describe('keyId', () => {
    it('returns a non-empty string identifier', () => {
      const service = new TokenEncryptionService(createMockConfigService());
      const id = service.keyId;

      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });
  });
});
