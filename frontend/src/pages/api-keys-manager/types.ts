import type { CreateApiKeyInput } from '@/schemas/apiKey';

export const API_KEY_NAME_MAX_LENGTH = 64;

export const INITIAL_FORM: CreateApiKeyInput = {
  name: '',
  description: '',
  expiresAt: undefined,
  permissions: {
    workflows: {
      run: true,
      list: false,
      read: false,
    },
    runs: {
      read: true,
      cancel: false,
    },
    audit: {
      read: false,
    },
  },
};
