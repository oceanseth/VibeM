# VibeM

**Vibe coding with a focus on VMs.**

Define KPIs in a web UI. The outside agent spawns containerized "VMs," each running a headless-browser GPT-4o agent that drives Tasklet, Mulerun, or any other site to push that KPI toward its target. Eval cron checks how the VMs are doing and surfaces results back to the dashboard. No login — localhost only — clone, set an OpenAI key, run.

> *"The vibe vibe coding dream"* — one chat box, many agents working for you.

---

## Architecture

```
        ┌───────────────────────────────────────────────┐
        │  apps/web (Vite + React + Tailwind)           │   mobile-ready
        │  - Dashboard: KPIs + running VMs              │   via Capacitor
        │  - Agent chat panel (talks to orchestrator)   │   (npm run cap:add:ios)
        └────────────┬──────────────────────────────────┘
                     │ /api/* + SSE /stream
                     ▼
        ┌───────────────────────────────────────────────┐
        │  apps/orchestrator (Express + SQLite)         │
        │  - Outside agent (OpenAI GPT-4o, tool-use)    │
        │    tools: create_kpi, spawn_vm, list_vms,     │
        │           kill_vm, schedule_eval              │
        │  - Eval cron (node-cron, gpt-4o-mini scorer)  │
        │  - Docker lifecycle (dockerode)               │
        │  - Event bus → SSE to web                     │
        └────────────┬──────────────────────────────────┘
                     │ Docker socket
                     ▼
        ┌───────────────────────────────────────────────┐
        │  packages/agent-runtime (one container per VM)│
        │  - Playwright headless Chromium               │
        │  - GPT-4o tool-use loop                       │
        │    tools: goto, click, type, read,            │
        │           screenshot, report_kpi, done        │
        │  - Reports back via HTTP to orchestrator      │
        └───────────────────────────────────────────────┘
```

**Data:** single SQLite file at `data/vibem.sqlite` with tables for `kpis`, `vms`, `evals`, `chat_turns`, `vm_events`. Zero infra.

**Streaming:** orchestrator publishes domain events to an in-process bus; the `/stream` SSE endpoint forwards them to the dashboard. Each VM container streams its logs and structured events back via `POST /api/vms/:id/event`.

---

## Quick start

```bash
# 1. Get an OpenAI key, then:
cp .env.example .env
# put your key in .env (NEVER commit it)

# 2. Install
npm install

# 3. Build the inside-VM agent image (one-time; rebuild when you change packages/agent-runtime)
npm run build:agent

# 4. Run orchestrator + web together
npm run dev
# → web on http://localhost:5173
# → orchestrator on http://localhost:8787
```

Open the web UI, click **Agent**, and try:

> Create a KPI called "Inbound leads" with target 50/week. Spawn a Tasklet VM whose mission is to find 10 lead-gen websites and capture contact forms.

The agent will call tools (`create_kpi`, `spawn_vm`) and you'll see VMs appear on the Dashboard tab.

### Mobile (Capacitor)

```bash
cd apps/web
npm run build
npx cap add ios       # or: npx cap add android
npx cap sync
npx cap open ios
```

When wrapped, set the orchestrator URL in `capacitor.config.ts` to your laptop's LAN IP so the phone hits the orchestrator over Wi-Fi.

---

## Scaling efficiently

**Today (localhost, one host):**
- All VMs are containers on your laptop's Docker. `MAX_VMS` (default 8) caps concurrency — Playwright + Chromium needs ~500 MB per container.
- SQLite handles the data. WAL mode is on; reads and writes don't block each other.
- The agent loops are persisted as `chat_turns` and `vm_events` rows, so a process restart doesn't lose state.

**Next step (single beefier host or one VPS):**
- Move container caps higher (`MAX_VMS=32`+) once you have RAM to back it. Remember Chromium dominates.
- Add Redis if you want a queue (BullMQ) instead of fire-and-forget container spawning, so bursty admin requests don't oversubscribe.
- Switch SQLite → Postgres only when you start running multi-process orchestrators.

**Later (many hosts):**
- Orchestrator becomes a controller. Containers run on a separate Docker Swarm or k3s cluster — replace the `dockerode` calls in `apps/orchestrator/src/docker.ts` with the cluster API.
- Replace SSE with a real pubsub (Redis pub/sub or NATS) so dashboards behind a load balancer all see the same events.
- Track per-KPI token spend in `vm_events` and enforce hard daily caps via `MAX_TOKENS_PER_VM` × number of VMs.

**Cost levers worth tuning early:**
- Inside-VM agent uses `gpt-4o`. For cheaper reconnaissance, add a `gpt-4o-mini` "planner" step that drafts a script before the expensive loop runs.
- The inside-VM agent prefers `read` (text snapshot) over `screenshot` (binary). Keep that bias — screenshots blow up context.
- Eval cron uses `gpt-4o-mini` already. Scoring rarely benefits from a bigger model.

---

## Suggested Claude Code skills to install

None of the listed skills directly cover Playwright/Docker orchestration, but a few will help while iterating on this codebase:

| Skill | Why |
| --- | --- |
| `find-skills` | Search for skills covering Playwright, OpenAI, Docker, or eval frameworks if you want more specialized tooling later. |
| `simplify` | Run after a feature lands to dedupe and tighten the agent loops as they grow. |
| `claude-api` | Useful if you decide the **outside** orchestrator agent should use Claude (better tool-call reliability for long planning) while the inside-VM agents stay on OpenAI. |
| `fewer-permission-prompts` | Allowlist common Bash patterns (`docker ps`, `npm run dev`, etc.) so iteration isn't interrupted. |

A custom skill worth writing for this project: a **vibem-vm** skill that knows the orchestrator API surface and can spawn/inspect/kill VMs from a slash command.

---

## Repo layout

```
apps/
  web/             # Vite + React frontend (mobile-ready via Capacitor)
  orchestrator/    # Express + SQLite + OpenAI tool-use + node-cron + dockerode
packages/
  agent-runtime/   # Image: Playwright + GPT-4o loop. Spawned per VM by orchestrator.
docker-compose.yml # Convenience: orchestrator + web together
.env.example       # Required: OPENAI_API_KEY
```

---

## Security notes (read me)

- `.env` is gitignored. Never commit your OpenAI key. A leaked hackathon key is still a leaked key — rotate after the event.
- The orchestrator mounts `/var/run/docker.sock` to spawn containers. That's effectively root on the host. Run this on your laptop, not a shared server, and don't expose port `8787` to the internet.
- Inside-VM containers have `AutoRemove: true`, 1 GiB memory, 1 vCPU caps. Easy to bump if a workload needs more.
- There is no auth on the orchestrator (by design — localhost-only). If you ever expose it, put it behind a reverse proxy with auth before doing anything else.
