/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_USER_ID?: string;
  readonly VITE_DEFAULT_ORG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
