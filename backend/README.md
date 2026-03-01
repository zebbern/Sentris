# Sentris Flow Backend

NestJS REST API server for workflow management, orchestration, and real-time execution monitoring.

## Prerequisites

- Bun latest (see root `README.md` for install instructions)
- Infrastructure services running (`just dev` from repo root)

## Development Commands

```bash
# Install workspace dependencies (run once from repo root)
bun install

# Start the API server with hot reload
bun dev

# Type-check and lint before committing
bun run typecheck
bun run lint

# Run API tests (NestJS testing utilities)
bun run test
```

## Architecture Overview

### Core Technologies

- **NestJS** with TypeScript for API framework
- **Bun runtime** for fast JavaScript execution
- **PostgreSQL** with Drizzle ORM for data persistence
- **Temporal.io** for workflow orchestration
- **Clerk** for authentication and user management
- **MinIO** for object storage
- **Redis** for caching and session management
- **Kafka/Redpanda** for event streaming
- **Loki** for log aggregation

### Key Services

#### Workflows Module

- **Workflow CRUD**: Create, read, update, delete workflows
- **Graph Compilation**: Convert ReactFlow graphs to executable DSL
- **Temporal Integration**: Workflow scheduling and management
- **Validation**: Component registry validation and type checking

#### Storage Module

- **File Management**: Upload, download, and metadata management
- **Artifact Storage**: Component outputs and execution results
- **Terminal Archival**: Convert Redis streams to Asciinema cast files
- **MinIO Integration**: S3-compatible object storage

#### Secrets Module

- **Encrypted Storage**: AES-256-GCM encryption for sensitive data
- **Version Control**: Multiple secret versions with rollback
- **Access Control**: Role-based secret access and audit logging

#### Integrations Module

- **OAuth Provider**: Multi-provider OAuth orchestration
- **Token Vault**: Encrypted storage of access tokens
- **Connection Management**: OAuth lifecycle and refresh handling

#### Logging & Events Module

- **Log Ingestion**: Multi-transport log processing (Kafka, Loki, PostgreSQL)
- **Event Management**: Trace event storage and timeline generation
- **Real-time APIs**: SSE endpoints for live updates
- **Terminal Streaming**: Redis Stream-based terminal output delivery

## Environment Configuration

### Required Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/sentris

# Authentication
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_WEBHOOK_SECRET=whsec_...

# Temporal
TEMPORAL_ADDRESS=localhost:7233
TEMPORAL_NAMESPACE=sentris-flow
TEMPORAL_TASK_QUEUE=sentris-workflows

# Object Storage
MINIO_ENDPOINT=localhost:9000
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin

# Event Streaming / Kafka (Redpanda)
LOG_KAFKA_BROKERS=localhost:9092
REDIS_URL=redis://localhost:6379

# Log Aggregation
LOKI_URL=http://localhost:3100

# Security
# Must be exactly 32 characters (raw string, NOT hex-encoded).
# Generate with: openssl rand -base64 24 | head -c 32
SECRET_STORE_MASTER_KEY=your-32-character-secret-key!!!!
INTEGRATION_STORE_MASTER_KEY=your-32-character-integ-key!!!!!
```

## API Endpoints

### Workflows

- `GET /api/v1/workflows` - List workflows
- `POST /api/v1/workflows` - Create workflow
- `GET /api/v1/workflows/{id}` - Get workflow details
- `PUT /api/v1/workflows/{id}` - Update workflow
- `DELETE /api/v1/workflows/{id}` - Delete workflow
- `POST /api/v1/workflows/{id}/runs` - Execute workflow
- `GET /api/v1/workflows/{id}/versions` - List workflow version history
- `GET /api/v1/workflows/{id}/versions/{versionId}` - Get specific workflow version

### Execution Monitoring

- `GET /api/v1/runs/{runId}/events` - Get execution trace events
- `GET /api/v1/runs/{runId}/terminal` - Get terminal output chunks
- `GET /api/v1/runs/{runId}/logs` - Query execution logs
- `GET /api/v1/runs/{runId}/stream` - SSE endpoint for live updates

### File & Artifact Management

- `POST /api/v1/files/upload` - Upload file
- `GET /api/v1/files/{id}/download` - Download file
- `GET /api/v1/files/{id}/metadata` - Get file metadata

### Secrets & Integrations

- `GET /api/v1/secrets` - List secrets
- `POST /api/v1/secrets` - Create secret
- `GET /api/v1/integrations/providers` - List OAuth providers
- `POST /api/v1/integrations/{provider}/start` - Start OAuth flow

### Security & Validation

- **Rate limiting**: `@nestjs/throttler` with Redis storage is applied globally. Per-controller overrides: secrets (30 req/min), API keys (20 req/min), inbound webhooks (60 req/min).
- **Zod validation pipes**: Controllers use `ZodValidationPipe` from `nestjs-zod` with `createZodDto` pattern for request body and query parameter validation.
- **Timing-safe auth**: Internal service token comparison uses `crypto.timingSafeEqual` in `auth.guard.ts` to prevent timing side-channel attacks.

## Project Structure

```
src/
├── agent-trace/        # Agent execution trace capture
├── agents/             # AI agent orchestration
├── analytics/          # Usage analytics and metrics
├── api-keys/           # API key management
├── audit/              # Audit event logging
├── auth/               # Clerk authentication integration
├── common/             # Shared utilities and helpers
├── components/         # Component registry API
├── config/             # Application configuration
├── database/           # Database schemas and migrations
├── dsl/                # Workflow DSL compiler
├── events/             # Event processing service
├── human-inputs/       # Human-in-the-loop input handling
├── integrations/       # OAuth provider orchestration
├── logging/            # Log ingestion and processing
├── mcp/                # Model Context Protocol core
├── mcp-groups/         # MCP server group management
├── mcp-servers/        # MCP server registry and lifecycle
├── node-io/            # Workflow node I/O handling
├── schedules/          # Scheduled workflow execution
├── secrets/            # Encrypted secrets storage
├── storage/            # File and artifact management
├── studio-mcp/         # Studio MCP server integration
├── templates/          # Workflow template library
├── temporal/           # Temporal client wrapper
├── terminal/           # Terminal streaming and PTY management
├── testing/            # Test utilities and fixtures
├── trace/              # Event management and timeline
├── webhooks/           # Webhook delivery and management
└── workflows/          # Workflow CRUD and compilation
```

## Development Workflow

1. **Infrastructure**: Start required services with `just dev`
2. **Database**: Run migrations with `bun run db:migrate`
3. **Development**: Start API server with `bun dev`
4. **Testing**: Run test suite with `bun run test`
5. **Validation**: Check types with `bun run typecheck`

## Where To Read More

- **[Architecture Overview](../docs/architecture.mdx)** - Complete system design and data flows
- **[Component Development](../docs/development/component-development.mdx)** - Building security components
- **[Getting Started](../docs/quickstart.mdx)** - Development setup and configuration
