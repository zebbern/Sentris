CREATE TABLE IF NOT EXISTS "secrets" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" varchar(191) NOT NULL UNIQUE,
    "description" text,
    "tags" jsonb,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "secret_versions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "secret_id" uuid NOT NULL REFERENCES "secrets"("id") ON DELETE CASCADE,
    "version" integer NOT NULL,
    "encrypted_value" text NOT NULL,
    "iv" text NOT NULL,
    "auth_tag" text NOT NULL,
    "encryption_key_id" varchar(128) NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "created_by" varchar(191),
    "is_active" boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS "secret_versions_secret_id_version_idx"
    ON "secret_versions" ("secret_id", "version");

CREATE INDEX IF NOT EXISTS "secret_versions_secret_id_idx"
    ON "secret_versions" ("secret_id");
