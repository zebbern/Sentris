# ADR Part 3: Data Flow Diagrams

Continuation of the MCP State Externalization ADR.

---

## MCP Gateway Request Flow (with sticky sessions)

```mermaid
sequenceDiagram
    participant Agent as AI Agent
    participant LB as Nginx (sticky)
    participant B1 as Backend-1
    participant B2 as Backend-2
    participant Redis as Redis
    participant Temporal as Temporal

    Agent->>LB: POST /mcp/gateway (init, JWT with runId)
    Note over LB: No affinity cookie, round-robin
    LB->>B1: Forward to Backend-1
    B1->>B1: Create McpServer + Transport
    B1->>Redis: Register session metadata
    B1-->>Agent: 200 + Set-Cookie mcp_affinity

    Agent->>LB: GET /mcp/gateway (SSE, cookie)
    Note over LB: hash(cookie) routes to B1
    LB->>B1: Forward (sticky)
    B1-->>Agent: SSE stream opened

    Agent->>LB: POST /mcp/gateway (tool call, cookie)
    LB->>B1: Forward (sticky)
    B1->>Temporal: Signal executeToolCall
    B1-->>Agent: Tool result

    Agent->>LB: SSE close
    B1->>Redis: Deregister session
    B1->>B1: cleanupRun()
```

## Instance Failure Recovery Flow

```mermaid
sequenceDiagram
    participant Agent as AI Agent
    participant LB as Nginx
    participant B1 as Backend-1 (dead)
    participant B2 as Backend-2
    participant Redis as Redis
    participant Health as Health Monitor

    Note over B1: Instance crashes
    Agent->>LB: POST /mcp/gateway (cookie routes to B1)
    LB->>B1: Connection refused
    LB-->>Agent: 502 Bad Gateway

    Health->>Redis: Detect stale heartbeat for B1
    Health->>Redis: purgeInstance(B1) — clean orphans

    Note over Agent: AI agent retries
    Agent->>LB: POST /mcp/gateway (init, no cookie)
    LB->>B2: Round-robin to Backend-2
    B2->>B2: Create fresh McpServer
    B2->>Redis: Register new session
    B2-->>Agent: 200 + new affinity cookie
```

## Component Topology (Production)

```mermaid
graph TB
    subgraph Clients
        A1[AI Agent 1]
        A2[AI Agent 2]
        S1[Studio MCP Client]
    end

    subgraph Load Balancer
        LB[Nginx<br/>consistent hash on mcp_affinity]
    end

    subgraph Backend Pool
        B1[Backend-1<br/>In-memory Maps<br/>Sessions: A1]
        B2[Backend-2<br/>In-memory Maps<br/>Sessions: A2, S1]
    end

    subgraph Shared Infra
        Redis[(Redis<br/>Session Registry<br/>Tool Registry<br/>Terminal Streams)]
        PG[(PostgreSQL)]
        T[Temporal]
    end

    A1 --> LB
    A2 --> LB
    S1 --> LB
    LB -->|sticky| B1
    LB -->|sticky| B2
    B1 --> Redis
    B2 --> Redis
    B1 --> PG
    B2 --> PG
    B1 --> T
    B2 --> T
```

## Session Lifecycle State Machine

```mermaid
stateDiagram-v2
    [*] --> Initializing: POST init request
    Initializing --> Active: Transport created, server connected
    Active --> Active: POST tool calls
    Active --> Active: GET SSE reconnect
    Active --> Draining: Instance shutdown signal
    Active --> Terminated: DELETE or SSE close
    Active --> Orphaned: Instance crash
    Draining --> Terminated: All requests drained
    Orphaned --> Cleaned: Health monitor purges
    Terminated --> [*]: Maps cleaned, Redis deregistered
    Cleaned --> [*]: Redis entry removed
```
