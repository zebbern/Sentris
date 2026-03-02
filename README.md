<p align="center">
  <img src="https://img.shields.io/github/v/release/zebbern/Sentris?color=blue&label=version" alt="Version">
  <a href="https://github.com/zebbern/Sentris/tree/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-green" alt="License"></a>
  <a href="https://discord.gg/fmMA4BtNXC"><img src="https://img.shields.io/discord/1175402031123447818?color=5865F2&label=discord&logo=discord&logoColor=white" alt="Discord"></a>
</p>

# Sentris Flow

**Open-Source Security Workflow Orchestration Platform.**

> Sentris is currently in active development. We are optimizing the platform for stable production use and high-performance security operations.

Sentris Flow provides a visual DSL and runtime for building, executing, and monitoring automated security workflows. It decouples security logic from infrastructure management, providing a durable and isolated environment for running security tooling at scale.

---

### Core Pillars

- **Durable, resumable workflows** powered by Temporal.io for stateful execution across failures.
- **Isolated security runtimes** using ephemeral containers with per-run volume management.
- **Unified telemetry streams** delivering terminal output, events, and logs via a low-latency SSE pipeline.
- **Visual no-code builder** that compiles complex security graphs into an executable DSL.

---

## Deployment Options

### 1. Sentris Self-Host with Docker (Recommended)

The easiest way to run Sentris Flow on your own infrastructure:

#### Clone & Start

For teams requiring data residency and air-gapped security orchestrations. This setup runs the full stack (Frontend, Backend, Worker, and Infrastructure).

**Prerequisites:**

- **[docker](https://www.docker.com/)** - For running the application and security components
- **[just](https://github.com/casey/just)** - Command runner for simplified workflows
- **curl** and **jq** - For fetching release information

```bash
# Clone and start the latest stable release
git clone https://github.com/zebbern/Sentris.git
cd Sentris
just prod start-latest
```

Access the studio at `http://localhost`.

---

## Development Quickstart

Get the dev environment running in 3 steps:

**Prerequisites:** [Docker Desktop](https://www.docker.com/), [Bun](https://bun.sh/), [Node.js](https://nodejs.org/) (v20+)

```bash
git clone https://github.com/zebbern/Sentris.git
cd Sentris
bun run setup   # Install deps + create .env files
bun run dev     # Start Docker infra + all apps
```

Once running:

| Service     | URL                     |
| ----------- | ----------------------- |
| Frontend    | <http://localhost:5173> |
| Backend API | <http://localhost:3211> |
| Temporal UI | <http://localhost:8081> |

```bash
bun run dev:stop   # Stop everything (PM2 + Docker)
bun run dev:fe     # Frontend-only dev (no Docker needed)
pm2 logs           # View application logs
pm2 status         # Check process status
```

> **Advanced:** `just dev` remains available for multi-instance development, Clerk auth auto-detection, and TLS certificate generation. See the [Multi-Instance Guide](docs/MULTI-INSTANCE-DEV.mdx) for details.

---

## Capabilities

### Integrated Tooling

25 security components wrapping industry-standard open-source tools:

- **Discovery & Recon**: `Subfinder`, `Amass`, `DNSX`, `Naabu`, `HTTPx`, `Katana`, `theHarvester`, `ShuffleDNS`
- **Vulnerability Scanning**: `Nuclei`, `Trivy`, `Semgrep`, `Checkov`, `TestSSL`
- **Secret Detection**: `TruffleHog`
- **Threat Intelligence**: `AbuseIPDB`, `VirusTotal`, `YARA`
- **Web Security**: `Ffuf`, `Wafw00f`, `Prowler`, `Supabase Scanner`
- **Notifications**: `Notify` (Slack, Discord, Telegram, Email)
- **Utility**: `JSON Transform`, `Logic Scripts`, `HTTP Requests`

### Template Library

- **35 ready-to-use workflow templates** covering vulnerability scanning, cloud compliance, incident response, OSINT, AI triage, IaC security, IT automation, and more.
- **One-click deployment**: Browse, preview, and create workflows from templates instantly.
- **Community publishing**: Share your workflows as templates via GitHub PR with automatic secret sanitization.

### Advanced Orchestration

- **Human-in-the-Loop**: Pause workflows for approvals, form inputs, or manual validation before continuing.
- **AI-Driven Analysis**: Leverage LLM nodes and MCP providers for intelligent results interpretation.
- **Native Scheduling**: Integrated CRON support for recurring security posture and compliance monitoring.
- **API First**: Trigger and monitor any workflow execution via a comprehensive REST API.

### MCP Integration

- **MCP Library**: Centralized MCP server management with multi-server selection and automatic tool registration
- **Built-in MCP Servers**: AWS CloudTrail, CloudWatch, and Filesystem support out-of-the-box
- **Seamless Tool Discovery**: AI Agents automatically discover and use MCP tools via standardized contracts

---

## 🏛️ Architecture Overview

Sentris Flow is designed for enterprise-grade durability and horizontal scalability.

- **Management Plane (Backend)**: NestJS service handling DSL compilation, secret management (AES-256-GCM), and identity.
- **Orchestration Plane (Temporal)**: Manages workflow state, concurrency, and persistent wait states.
- **Execution Plane (Worker)**: Stateless agents that pull tasks from Temporal and execute tool-bound activities in isolated runtimes.
- **Monitoring (SSE/Loki)**: Real-time telemetry pipeline for deterministic execution visibility.

Learn more about our design decisions and system components in the **[Architecture Deep-dive](/docs/architecture.mdx)**.

- **[Documentation](https://github.com/zebbern/Sentris/tree/main/docs)** — Full guides on component development and deployment.

---

## Multi-Instance Development

Run multiple isolated dev instances on one machine for parallel feature work:

```bash
# Instance 0 (default)
just dev

# Switch active workspace instance
just instance use 1
just dev

# Manage per-instance env files
just instance-env init 1
```

Each instance gets its own frontend port, backend port, database, and Temporal namespace while sharing a single Docker infra stack. See [Multi-Instance Development Guide](docs/MULTI-INSTANCE-DEV.mdx) for full details.

---

## Contributing

We welcome contributions to the management plane, worker logic, or new security components.
See [CONTRIBUTING.md](CONTRIBUTING.md) for architectural guidelines and setup instructions.
