/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_USER_ID?: string;
  readonly VITE_DEFAULT_ORG?: string;
  readonly VITE_DEFAULT_ORG_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  readonly __SENTRIS_RUNTIME_CONFIG__?: Record<string, unknown>;
}
