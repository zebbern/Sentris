# Triage: Round 11 — Test Infrastructure Coverage

## EXECUTION_PLAN

### Items

1. **Backend common/ infrastructure tests**: AllExceptionsFilter, LoggingInterceptor, KafkaTopicResolver, postgres-error, crypto-utils. Place tests in `backend/src/common/__tests__/`.
2. **Worker Kafka adapter tests**: kafka-agent-trace.adapter, kafka-log.adapter, kafka-nodeio.adapter, kafka-trace.adapter. Place tests in `worker/src/adapters/__tests__/`. Mock KafkaJS producer.
3. **Frontend store tests**: notificationStore, workflowStore, workflowUiStore. Place tests in `frontend/src/store/__tests__/`.
4. **Negative auth tests**: Extend secrets.service.spec.ts and webhooks.service.spec.ts with null auth, null org, wrong org, non-existent IDs.

### Execution Phases

- **Phase 1** (parallel, 3 agents): tester(backend-common) + tester(worker-kafka) + tester(frontend-stores)
- **Phase 2**: tester(negative-auth)
- **Phase 3** (parallel): code-reviewer + security-reviewer

### Agent Assignments

| Agent                  | Scope                                           | Skills           |
| ---------------------- | ----------------------------------------------- | ---------------- |
| tester-backend-common  | Backend common/ unit tests                      | testing-patterns |
| tester-worker-kafka    | Worker Kafka adapter unit tests                 | testing-patterns |
| tester-frontend-stores | Frontend Zustand store unit tests               | testing-patterns |
| tester-negative-auth   | Negative auth path tests for secrets + webhooks | testing-patterns |
| code-reviewer          | Review all new test files for quality           | —                |
| security-reviewer      | Review test coverage for security implications  | —                |
