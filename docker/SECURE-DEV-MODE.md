# Secure Development Mode

This document describes the secure development environment setup with OpenSearch Security enabled for multi-tenant isolation.

## Overview

The `just dev` command auto-detects the auth mode from your backend environment:

- If `CLERK_SECRET_KEY` is set in `backend/.env` → **secure mode** (Clerk auth + OpenSearch Security)
- Otherwise → **local auth mode** (faster startup, no multi-tenant isolation)

Secure mode provides:

- **TLS encryption** for all OpenSearch communication
- **Multi-tenant isolation** — each organization's data is isolated
- **Authentication required** — no anonymous access
- **Same security model as production** — test security features locally

## Quick Start

```bash
# Auto-detects auth mode from backend/.env
just dev

# To enable secure mode, set CLERK_SECRET_KEY in backend/.env, then restart:
just dev stop && just dev
```

## Architecture

### Docker Compose Files

| File                            | Purpose                                               |
| ------------------------------- | ----------------------------------------------------- |
| `docker-compose.infra.yml`      | Base infrastructure (Postgres, Redis, Temporal, etc.) |
| `docker-compose.dev-secure.yml` | Security overlay for development                      |
| `docker-compose.prod.yml`       | Production security configuration                     |

### Security Configuration Files

Located in `docker/opensearch-security/`:

| File                 | Purpose                                            |
| -------------------- | -------------------------------------------------- |
| `config.yml`         | Authentication/authorization backends (proxy auth) |
| `internal_users.yml` | System users (admin, kibanaserver, worker)         |
| `roles.yml`          | Role definitions with index permissions            |
| `roles_mapping.yml`  | User-to-role mappings                              |
| `action_groups.yml`  | Permission groups for roles                        |
| `tenants.yml`        | Tenant definitions                                 |
| `audit.yml`          | Audit logging configuration                        |

### TLS Certificates

Certificates are auto-generated on first run and stored in `docker/certs/`:

- `root-ca.pem` / `root-ca-key.pem` - Certificate Authority
- `admin.pem` / `admin-key.pem` - Admin certificate for securityadmin tool
- `node.pem` / `node-key.pem` - OpenSearch node certificate

## Default Credentials

For development convenience, default passwords are set:

| User           | Password | Purpose                          |
| -------------- | -------- | -------------------------------- |
| `admin`        | `admin`  | Platform administrator           |
| `kibanaserver` | `admin`  | Dashboards backend communication |
| `worker`       | `admin`  | Worker service for indexing      |

**Important**: Change these in production via environment variables:

- `OPENSEARCH_ADMIN_PASSWORD`
- `OPENSEARCH_DASHBOARDS_PASSWORD`

## Multi-Tenant Isolation

### How It Works

1. **Index Pattern**: Each organization's data is stored in indices prefixed with their org ID:
   - `security-findings-{org_id}-*`

2. **Tenant Isolation**: OpenSearch Dashboards uses tenants to isolate saved objects (dashboards, visualizations)

3. **Role-Based Access**: Dynamic roles are created per customer restricting access to their indices only

### Dynamic Provisioning

When a new customer is onboarded, the backend creates:

1. A tenant for their organization
2. A role with permissions scoped to their indices
3. User-to-role mappings

## Troubleshooting

### Check Container Health

```bash
just dev status
docker logs sentris-opensearch
docker logs sentris-opensearch-dashboards
```

### Reset Security Configuration

```bash
# Clean everything and restart
just dev clean && just dev

# Or manually run securityadmin
docker exec sentris-opensearch /usr/share/opensearch/plugins/opensearch-security/tools/securityadmin.sh \
  -cd /usr/share/opensearch/config/opensearch-security \
  -icl -nhnv \
  -cacert /usr/share/opensearch/config/certs/root-ca.pem \
  -cert /usr/share/opensearch/config/certs/admin.pem \
  -key /usr/share/opensearch/config/certs/admin-key.pem
```

### Regenerate Certificates

```bash
rm -rf docker/certs
just generate-certs
just dev clean && just dev
```

## Changes from Previous Setup

1. **`just dev`** auto-detects auth mode from `CLERK_SECRET_KEY` in `backend/.env`
2. Certificates are auto-generated if missing when running in secure mode
3. Environment variable `OPENSEARCH_SECURITY_ENABLED=true` is set for backend/worker in secure mode
