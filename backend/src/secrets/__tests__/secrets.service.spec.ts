import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import { SecretsService } from '../secrets.service';
import type { SecretsRepository, SecretSummary, SecretValueRecord } from '../secrets.repository';
import type { SecretsEncryptionService } from '../secrets.encryption';
import type { AuthContext } from '../../auth/types';
import { DEFAULT_ORGANIZATION_ID } from '../../auth/constants';

const sampleSummary: SecretSummary = {
  id: 'secret-1',
  name: 'database-password',
  description: 'Primary database credentials',
  tags: ['prod'],
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-02T00:00:00.000Z'),
  activeVersion: {
    id: 'version-1',
    version: 1,
    createdAt: new Date('2024-01-02T00:00:00.000Z'),
    createdBy: 'alice@example.com',
  },
};

const authContext: AuthContext = {
  userId: 'tester',
  organizationId: DEFAULT_ORGANIZATION_ID,
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

describe('SecretsService', () => {
  let repository: {
    listSecrets: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    findByName: ReturnType<typeof vi.fn>;
    createSecret: ReturnType<typeof vi.fn>;
    rotateSecret: ReturnType<typeof vi.fn>;
    findValueBySecretId: ReturnType<typeof vi.fn>;
    updateSecret: ReturnType<typeof vi.fn>;
    deleteSecret: ReturnType<typeof vi.fn>;
  };
  let encryption: {
    encrypt: ReturnType<typeof vi.fn>;
    decrypt: ReturnType<typeof vi.fn>;
  };
  let auditLogService: {
    record: ReturnType<typeof vi.fn>;
  };
  let service: SecretsService;

  beforeEach(() => {
    repository = {
      listSecrets: vi.fn(),
      findById: vi.fn(),
      findByName: vi.fn(),
      createSecret: vi.fn(),
      rotateSecret: vi.fn(),
      findValueBySecretId: vi.fn(),
      updateSecret: vi.fn(),
      deleteSecret: vi.fn(),
    };

    encryption = {
      encrypt: vi.fn(),
      decrypt: vi.fn(),
    };

    auditLogService = {
      record: vi.fn(),
    };

    service = new SecretsService(
      repository as unknown as SecretsRepository,
      encryption as unknown as SecretsEncryptionService,
      auditLogService as any,
    );
  });

  it('lists secrets via the repository', async () => {
    repository.listSecrets.mockResolvedValue([sampleSummary]);

    const result = await service.listSecrets(authContext);

    expect(result).toEqual([sampleSummary]);
    expect(repository.listSecrets).toHaveBeenCalledWith({
      organizationId: DEFAULT_ORGANIZATION_ID,
    });
  });

  it('returns a single secret via the repository', async () => {
    repository.findById.mockResolvedValue(sampleSummary);

    const result = await service.getSecret(authContext, 'secret-1');

    expect(result).toBe(sampleSummary);
    expect(repository.findById).toHaveBeenCalledWith('secret-1', {
      organizationId: DEFAULT_ORGANIZATION_ID,
    });
  });

  it('encrypts and stores a new secret with optional metadata', async () => {
    encryption.encrypt.mockResolvedValue({
      ciphertext: 'ciphertext',
      iv: 'iv',
      authTag: 'tag',
      keyId: 'master-key',
    });
    repository.createSecret.mockResolvedValue(sampleSummary);

    const result = await service.createSecret(authContext, {
      name: 'database-password',
      description: 'Primary database credentials',
      tags: ['prod'],
      value: 'super-secret-value',
      createdBy: 'alice@example.com',
    });

    expect(result).toBe(sampleSummary);
    expect(encryption.encrypt).toHaveBeenCalledWith('super-secret-value');
    expect(repository.createSecret).toHaveBeenCalledWith(
      {
        name: 'database-password',
        description: 'Primary database credentials',
        tags: ['prod'],
        organizationId: DEFAULT_ORGANIZATION_ID,
      },
      {
        encryptedValue: 'ciphertext',
        iv: 'iv',
        authTag: 'tag',
        encryptionKeyId: 'master-key',
        createdBy: 'alice@example.com',
        organizationId: DEFAULT_ORGANIZATION_ID,
      },
    );
  });

  it('fills optional fields with nulls when creating a secret', async () => {
    encryption.encrypt.mockResolvedValue({
      ciphertext: 'ciphertext',
      iv: 'iv',
      authTag: 'tag',
      keyId: 'master-key',
    });
    repository.createSecret.mockResolvedValue(sampleSummary);

    await service.createSecret(authContext, { name: 'api-key', value: 'value' });

    expect(repository.createSecret).toHaveBeenCalledWith(
      {
        name: 'api-key',
        description: null,
        tags: null,
        organizationId: DEFAULT_ORGANIZATION_ID,
      },
      expect.objectContaining({
        createdBy: null,
        organizationId: DEFAULT_ORGANIZATION_ID,
      }),
    );
  });

  it('rotates a secret using encrypted material', async () => {
    encryption.encrypt.mockResolvedValue({
      ciphertext: 'newcipher',
      iv: 'newiv',
      authTag: 'newtag',
      keyId: 'master-key',
    });
    repository.rotateSecret.mockResolvedValue(sampleSummary);

    const result = await service.rotateSecret(authContext, 'secret-1', {
      value: 'another-secret',
      createdBy: 'bob@example.com',
    });

    expect(result).toBe(sampleSummary);
    expect(encryption.encrypt).toHaveBeenCalledWith('another-secret');
    expect(repository.rotateSecret).toHaveBeenCalledWith(
      'secret-1',
      {
        encryptedValue: 'newcipher',
        iv: 'newiv',
        authTag: 'newtag',
        encryptionKeyId: 'master-key',
        createdBy: 'bob@example.com',
        organizationId: DEFAULT_ORGANIZATION_ID,
      },
      { organizationId: DEFAULT_ORGANIZATION_ID },
    );
  });

  it('defaults rotate metadata when not provided', async () => {
    encryption.encrypt.mockResolvedValue({
      ciphertext: 'cipher',
      iv: 'iv',
      authTag: 'tag',
      keyId: 'master-key',
    });
    repository.rotateSecret.mockResolvedValue(sampleSummary);

    await service.rotateSecret(authContext, 'secret-1', { value: 'value' });

    expect(repository.rotateSecret).toHaveBeenCalledWith(
      'secret-1',
      {
        encryptedValue: 'cipher',
        iv: 'iv',
        authTag: 'tag',
        encryptionKeyId: 'master-key',
        createdBy: null,
        organizationId: DEFAULT_ORGANIZATION_ID,
      },
      { organizationId: DEFAULT_ORGANIZATION_ID },
    );
  });

  it('decrypts secret values returned from the repository', async () => {
    const record: SecretValueRecord = {
      secretId: 'secret-1',
      version: 2,
      encryptedValue: 'encrypted',
      iv: 'iv',
      authTag: 'tag',
      encryptionKeyId: 'master-key',
    };
    repository.findValueBySecretId.mockResolvedValue(record);
    encryption.decrypt.mockResolvedValue('decrypted-value');

    const result = await service.getSecretValue(authContext, 'secret-1');

    expect(repository.findValueBySecretId).toHaveBeenCalledWith('secret-1', undefined, {
      organizationId: DEFAULT_ORGANIZATION_ID,
    });
    expect(encryption.decrypt).toHaveBeenCalledWith({
      ciphertext: 'encrypted',
      iv: 'iv',
      authTag: 'tag',
      keyId: 'master-key',
    });
    expect(result).toEqual({
      secretId: 'secret-1',
      version: 2,
      value: 'decrypted-value',
    });
  });

  it('requests a specific version when provided', async () => {
    repository.findByName.mockResolvedValue(sampleSummary);
    repository.findValueBySecretId.mockResolvedValue({
      secretId: 'secret-1',
      version: 2,
      encryptedValue: 'encrypted',
      iv: 'iv',
      authTag: 'tag',
      encryptionKeyId: 'master-key',
    });
    encryption.decrypt.mockResolvedValue('value');

    const result = await service.getSecretValueByName(authContext, 'database-password', 2);

    expect(repository.findByName).toHaveBeenCalledWith('database-password', {
      organizationId: DEFAULT_ORGANIZATION_ID,
    });
    expect(repository.findValueBySecretId).toHaveBeenCalledWith('secret-1', 2, {
      organizationId: DEFAULT_ORGANIZATION_ID,
    });
    expect(result.value).toBe('value');
  });

  it('normalizes and forwards update payload to the repository', async () => {
    repository.findById.mockResolvedValue(sampleSummary);
    repository.updateSecret.mockResolvedValue(sampleSummary);

    const result = await service.updateSecret(authContext, 'secret-1', {
      name: '  db-password  ',
      description: 'Primary DB password',
      tags: ['  prod  ', '  critical '],
    });

    expect(repository.updateSecret).toHaveBeenCalledWith(
      'secret-1',
      {
        name: 'db-password',
        description: 'Primary DB password',
        tags: ['prod', 'critical'],
      },
      { organizationId: DEFAULT_ORGANIZATION_ID },
    );
    expect(result).toBe(sampleSummary);
  });

  it('allows clearing optional metadata when updating', async () => {
    repository.findById.mockResolvedValue(sampleSummary);
    repository.updateSecret.mockResolvedValue(sampleSummary);

    await service.updateSecret(authContext, 'secret-1', {
      name: 'database-password',
      description: null,
      tags: [],
    });

    expect(repository.updateSecret).toHaveBeenCalledWith(
      'secret-1',
      {
        name: 'database-password',
        description: null,
        tags: null,
      },
      { organizationId: DEFAULT_ORGANIZATION_ID },
    );
  });

  it('returns the existing secret when no updates are provided', async () => {
    repository.findById.mockResolvedValue(sampleSummary);

    const updated = await service.updateSecret(authContext, 'secret-1', {});

    expect(updated).toBe(sampleSummary);
    expect(repository.findById).toHaveBeenCalledWith('secret-1', {
      organizationId: DEFAULT_ORGANIZATION_ID,
    });
  });

  it('deletes a secret via the repository', async () => {
    await service.deleteSecret(authContext, 'secret-1');
    expect(repository.deleteSecret).toHaveBeenCalledWith('secret-1', {
      organizationId: DEFAULT_ORGANIZATION_ID,
    });
  });

  describe('negative auth paths', () => {
    const nullOrgAuth: AuthContext = {
      userId: 'tester',
      organizationId: null,
      roles: ['ADMIN'],
      isAuthenticated: true,
      provider: 'test',
    };

    const emptyOrgAuth: AuthContext = {
      userId: 'tester',
      organizationId: '' as unknown as string,
      roles: ['ADMIN'],
      isAuthenticated: true,
      provider: 'test',
    };

    describe('null auth context', () => {
      it('listSecrets throws ForbiddenException', async () => {
        await expect(service.listSecrets(null)).rejects.toThrow(ForbiddenException);
      });

      it('getSecret throws ForbiddenException', async () => {
        await expect(service.getSecret(null, 'secret-1')).rejects.toThrow(ForbiddenException);
      });

      it('createSecret throws ForbiddenException', async () => {
        await expect(service.createSecret(null, { name: 'test', value: 'val' })).rejects.toThrow(
          ForbiddenException,
        );
      });

      it('rotateSecret throws ForbiddenException', async () => {
        await expect(service.rotateSecret(null, 'secret-1', { value: 'new-val' })).rejects.toThrow(
          ForbiddenException,
        );
      });

      it('getSecretValue throws ForbiddenException', async () => {
        await expect(service.getSecretValue(null, 'secret-1')).rejects.toThrow(ForbiddenException);
      });

      it('updateSecret throws ForbiddenException', async () => {
        await expect(service.updateSecret(null, 'secret-1', { name: 'renamed' })).rejects.toThrow(
          ForbiddenException,
        );
      });

      it('deleteSecret throws ForbiddenException', async () => {
        await expect(service.deleteSecret(null, 'secret-1')).rejects.toThrow(ForbiddenException);
      });

      it('getSecretByName throws ForbiddenException', async () => {
        await expect(service.getSecretByName(null, 'some-name')).rejects.toThrow(
          ForbiddenException,
        );
      });

      it('getSecretValueByName throws ForbiddenException', async () => {
        await expect(service.getSecretValueByName(null, 'some-name')).rejects.toThrow(
          ForbiddenException,
        );
      });
    });

    describe('auth with null organizationId', () => {
      it('listSecrets throws ForbiddenException', async () => {
        await expect(service.listSecrets(nullOrgAuth)).rejects.toThrow(ForbiddenException);
      });

      it('getSecret throws ForbiddenException', async () => {
        await expect(service.getSecret(nullOrgAuth, 'secret-1')).rejects.toThrow(
          ForbiddenException,
        );
      });

      it('createSecret throws ForbiddenException', async () => {
        await expect(
          service.createSecret(nullOrgAuth, { name: 'test', value: 'val' }),
        ).rejects.toThrow(ForbiddenException);
      });

      it('deleteSecret throws ForbiddenException', async () => {
        await expect(service.deleteSecret(nullOrgAuth, 'secret-1')).rejects.toThrow(
          ForbiddenException,
        );
      });

      it('rotateSecret throws ForbiddenException', async () => {
        await expect(
          service.rotateSecret(nullOrgAuth, 'secret-1', { value: 'new-val' }),
        ).rejects.toThrow(ForbiddenException);
      });

      it('getSecretValue throws ForbiddenException', async () => {
        await expect(service.getSecretValue(nullOrgAuth, 'secret-1')).rejects.toThrow(
          ForbiddenException,
        );
      });

      it('updateSecret throws ForbiddenException', async () => {
        await expect(
          service.updateSecret(nullOrgAuth, 'secret-1', { name: 'updated' }),
        ).rejects.toThrow(ForbiddenException);
      });

      it('getSecretByName throws ForbiddenException', async () => {
        await expect(service.getSecretByName(nullOrgAuth, 'my-secret')).rejects.toThrow(
          ForbiddenException,
        );
      });

      it('getSecretValueByName throws ForbiddenException', async () => {
        await expect(service.getSecretValueByName(nullOrgAuth, 'my-secret')).rejects.toThrow(
          ForbiddenException,
        );
      });
    });

    describe('auth with empty string organizationId', () => {
      it('listSecrets throws ForbiddenException', async () => {
        await expect(service.listSecrets(emptyOrgAuth)).rejects.toThrow(ForbiddenException);
      });

      it('getSecret throws ForbiddenException', async () => {
        await expect(service.getSecret(emptyOrgAuth, 'secret-1')).rejects.toThrow(
          ForbiddenException,
        );
      });

      it('createSecret throws ForbiddenException', async () => {
        await expect(
          service.createSecret(emptyOrgAuth, { name: 'test', value: 'val' }),
        ).rejects.toThrow(ForbiddenException);
      });

      it('deleteSecret throws ForbiddenException', async () => {
        await expect(service.deleteSecret(emptyOrgAuth, 'secret-1')).rejects.toThrow(
          ForbiddenException,
        );
      });

      it('rotateSecret throws ForbiddenException', async () => {
        await expect(
          service.rotateSecret(emptyOrgAuth, 'secret-1', { value: 'new-val' }),
        ).rejects.toThrow(ForbiddenException);
      });

      it('getSecretValue throws ForbiddenException', async () => {
        await expect(service.getSecretValue(emptyOrgAuth, 'secret-1')).rejects.toThrow(
          ForbiddenException,
        );
      });

      it('updateSecret throws ForbiddenException', async () => {
        await expect(
          service.updateSecret(emptyOrgAuth, 'secret-1', { name: 'updated' }),
        ).rejects.toThrow(ForbiddenException);
      });

      it('getSecretByName throws ForbiddenException', async () => {
        await expect(service.getSecretByName(emptyOrgAuth, 'my-secret')).rejects.toThrow(
          ForbiddenException,
        );
      });

      it('getSecretValueByName throws ForbiddenException', async () => {
        await expect(service.getSecretValueByName(emptyOrgAuth, 'my-secret')).rejects.toThrow(
          ForbiddenException,
        );
      });
    });

    describe('non-existent resource IDs', () => {
      it('getSecret propagates repository error for non-existent ID', async () => {
        repository.findById.mockRejectedValue(new Error('Not found'));

        await expect(service.getSecret(authContext, 'non-existent')).rejects.toThrow('Not found');
      });

      it('getSecretValue propagates repository error for non-existent ID', async () => {
        repository.findValueBySecretId.mockRejectedValue(new Error('Not found'));

        await expect(service.getSecretValue(authContext, 'non-existent')).rejects.toThrow(
          'Not found',
        );
      });
    });

    describe('no repository calls when auth fails', () => {
      it('does not call repository when auth is null', async () => {
        await expect(service.listSecrets(null)).rejects.toThrow(ForbiddenException);
        expect(repository.listSecrets).not.toHaveBeenCalled();
      });

      it('does not call encryption when auth is null', async () => {
        await expect(service.createSecret(null, { name: 'test', value: 'val' })).rejects.toThrow(
          ForbiddenException,
        );
        expect(encryption.encrypt).not.toHaveBeenCalled();
      });
    });
  });
});
