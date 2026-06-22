# Worker Integration Tests

## Overview

The worker integration tests (`worker-integration.test.ts`) test the complete Temporal workflow execution path with real services.

## What These Tests Cover

**Level 4: Worker Integration**

- ✅ Start a Temporal worker programmatically
- ✅ Execute workflows end-to-end through Temporal
- ✅ Verify service injection (storage, trace) into components
- ✅ Test multi-step workflows with dependencies
- ✅ Test error handling and failure scenarios

## Prerequisites

Before running integration tests, ensure the following services are running:

1. **Temporal Server** (localhost:7233)
2. **PostgreSQL** (localhost:5433)
3. **MinIO** (localhost:9000)

Start all services:

```bash
docker-compose up -d
```

## Running the Tests

### Run All Tests (Including Integration)

```bash
cd worker
bun test
```

### Run Only Integration Tests

```bash
cd worker
bun test src/__tests__/worker-integration.test.ts
```

### Run Without Integration Tests

If you want to skip integration tests (e.g., CI without Temporal):

```bash
cd worker
bun test --exclude src/__tests__/worker-integration.test.ts
```

## Test Structure

### 1. Workflow Execution Tests

- **Simple workflow**: Single trigger component execution
- **Service injection**: File loader with real MinIO + PostgreSQL
- **Error handling**: Non-existent file, graceful failures
- **Multi-step workflows**: Dependencies and execution order

### 2. Connection Tests

- Temporal server reachability
- Database connectivity
- MinIO bucket access

## Environment Variables

Tests default to the active local instance from `SENTRIS_INSTANCE` or `.sentris-instance`.
Use script-specific overrides only when intentionally targeting a different database or Temporal
namespace.

```env
SENTRIS_INSTANCE=0
WORKER_INTEGRATION_DATABASE_URL=postgresql://sentris:sentris@localhost:5433/custom_db
WORKER_INTEGRATION_TEMPORAL_NAMESPACE=custom-namespace
WORKER_INTEGRATION_TEMPORAL_TASK_QUEUE=custom-task-queue
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
TEMPORAL_ADDRESS=localhost:7233
```

## Test Isolation

- Each test uses a unique `taskQueue` to avoid conflicts
- Tests use random UUIDs for workflow IDs and run IDs
- File cleanup is performed after each test
- Worker shuts down cleanly in `afterAll`

## Timeout Settings

Integration tests have extended timeouts:

- Setup: 30 seconds
- Individual tests: 60 seconds

This accounts for:

- Worker startup time (~2 seconds)
- Workflow execution time
- Service communication latency

## Troubleshooting

### Tests Timeout

- Check if Temporal is running: `docker ps | grep temporal`
- Check worker logs for connection errors
- Verify network connectivity to services

### Database Connection Errors

- Ensure PostgreSQL is running on port 5433
- Check the active instance with `just instance show`
- Use `WORKER_INTEGRATION_DATABASE_URL` only when intentionally overriding the active instance
- Verify database schema is up to date

### MinIO Upload/Download Failures

- Ensure MinIO is running on port 9000
- Check bucket creation permissions
- Verify MinIO credentials

### Worker Not Polling Tasks

- Check Temporal namespace exists for the active instance, for example `sentris-dev-0`
- Verify task queue name matches
- Check worker logs for initialization errors

## Next Steps

After Level 4, proceed to:

- **Level 5:** Backend integration tests (REST API → Temporal)
- **Level 6:** End-to-end tests (Full stack with frontend)
