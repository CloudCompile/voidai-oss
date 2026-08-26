# Vercel Deployment Guide

A step-by-step guide to deploy VoidAI on Vercel with Supabase.

---

## Prerequisites

- A [Vercel](https://vercel.com) account (free tier works)
- A [Supabase](https://supabase.com) account (free tier works)
- Provider API keys for whichever AI services you plan to use

---

## 1. Create a Supabase project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and click **New project**.
2. Choose a project name, database password, and region close to your Vercel deployment region.
3. Wait for the project to finish provisioning.

---

## 2. Run the database migration

Once your Supabase project is ready:

1. In the Supabase dashboard, go to the **SQL Editor** (left sidebar).
2. Click **New query**.
3. Paste the entire contents of `supabase/migrations/0001_voidai.sql`:
   ```sql
   create extension if not exists pgcrypto;

   create table if not exists public.users (
     id text primary key,
     name text not null,
     api_key_hashes text[] not null default '{}',
     plan text not null default 'daily',
     plan_expires_at bigint not null default 0,
     enabled boolean not null default true,
     credits numeric not null default 0,
     credits_last_reset bigint not null default 0,
     permissions text[] not null default '{}',
     ip_whitelist text[] not null default '{}',
     rate_limit integer not null default 100,
     max_concurrent_requests integer not null default 1,
     usage jsonb not null default '{}'::jsonb,
     created_at timestamptz not null default now(),
     updated_at timestamptz not null default now()
   );

   create unique index if not exists users_api_key_hashes_idx
     on public.users using gin (api_key_hashes);
   create index if not exists users_plan_idx on public.users (plan);
   create index if not exists users_enabled_idx on public.users (enabled);

   create table if not exists public.providers (
     id text primary key,
     name text not null unique,
     display_name text not null,
     configuration jsonb not null default '{}'::jsonb,
     metrics jsonb not null default '{}'::jsonb,
     costs jsonb not null default '{}'::jsonb,
     security jsonb not null default '{}'::jsonb,
     created_at timestamptz not null default now(),
     updated_at timestamptz not null default now()
   );
   create index if not exists providers_active_idx
     on public.providers ((coalesce((configuration->>'isActive')::boolean, false)));

   create table if not exists public.sub_providers (
     id text primary key,
     provider_id text not null references public.providers(id) on delete cascade,
     name text not null unique,
     configuration jsonb not null default '{}'::jsonb,
     metrics jsonb not null default '{}'::jsonb,
     limits jsonb not null default '{}'::jsonb,
     created_at timestamptz not null default now(),
     updated_at timestamptz not null default now()
   );
   create index if not exists sub_providers_provider_idx on public.sub_providers (provider_id);

   create table if not exists public.api_requests (
     id text primary key,
     user_id text references public.users(id) on delete set null,
     endpoint text not null,
     method text not null,
     model text,
     provider_id text references public.providers(id) on delete set null,
     sub_provider_id text references public.sub_providers(id) on delete set null,
     ip_address text not null default '',
     user_agent text not null default '',
     tokens_used integer not null default 0,
     credits_used numeric not null default 0,
     latency integer not null default 0,
     request_size integer not null default 0,
     response_size integer not null default 0,
     status text not null default 'pending',
     status_code integer not null default 0,
     error_message text,
     retry_count integer not null default 0,
     created_at timestamptz not null default now(),
     completed_at timestamptz,
     updated_at timestamptz not null default now()
   );
   create index if not exists api_requests_user_idx on public.api_requests (user_id);
   create index if not exists api_requests_created_idx on public.api_requests (created_at desc);
   create index if not exists api_requests_status_idx on public.api_requests (status);

   alter table public.users enable row level security;
   alter table public.providers enable row level security;
   alter table public.sub_providers enable row level security;
   alter table public.api_requests enable row level security;
   ```
4. Click **Run** and confirm all tables are created.

---

## 3. Get your Supabase credentials

From the Supabase dashboard:

1. Go to **Project Settings** (gear icon) → **API**.
2. Copy these two values:

| Variable | Where to find it |
|---|---|
| `SUPABASE_URL` | **Project URL** (looks like `https://xxxx.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Service role key** (under `service_role` / anon keys) |

> **Important:** The service-role key bypasses Row Level Security. Never expose it as `NEXT_PUBLIC_*` or return it to clients.

---

## 4. Connect your repository to Vercel

1. Go to [vercel.com/new](https://vercel.com/new).
2. Import your GitHub repository.
3. Vercel auto-detects the framework. No framework preset is needed — leave it as **Other**.
4. Click **Deploy** (the first deploy will fail until you add env vars — that's expected).

---

## 5. Add environment variables

In the Vercel dashboard, go to your project → **Settings** → **Environment Variables**.

Add the following:

### Required

| Key | Value | Notes |
|---|---|---|
| `SUPABASE_URL` | `https://xxxx.supabase.co` | From step 3 |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | From step 3 — server-side only |
| `NODE_ENV` | `production` | |

### Provider API keys (add whichever you use)

| Key | Provider |
|---|---|
| `OPENAI_API_KEY` | OpenAI |
| `ANTHROPIC_API_KEY` | Anthropic / Claude |
| `GOOGLE_API_KEY` | Google Gemini |
| `MISTRAL_API_KEY` | Mistral |
| `DEEPSEEK_API_KEY` | DeepSeek |
| `PERPLEXITY_API_KEY` | Perplexity |
| `XAI_API_KEY` | xAI / Grok |
| `OPENROUTER_API_KEY` | OpenRouter |

> Only add the keys for providers you actually plan to use. The app will still work with just one.

### Custom OpenAI-compatible providers

If you use self-hosted or third-party APIs that speak the OpenAI format (LM Studio, Ollama, vLLM, LiteLLM, LocalAI, text-generation-webui, your own proxy, etc.), configure them with `CUSTOM_PROVIDER_*` env vars.

For each provider, set these env vars:

| Key | Required | Description |
|---|---|---|
| `CUSTOM_PROVIDER_<NAME>_BASE_URL` | Yes | API base URL (e.g. `http://localhost:1234/v1`) |
| `CUSTOM_PROVIDER_<NAME>_API_KEY` | No | API key (defaults to `no-key` if not needed) |
| `CUSTOM_PROVIDER_<NAME>_MODELS` | No | Comma-separated model IDs (e.g. `llama-3,mistral-7b`) |
| `CUSTOM_PROVIDER_<NAME>_CAPABILITIES` | No | Comma-separated: `chat`, `audio`, `embeddings`, `images`, `moderation` (default: `chat`) |
| `CUSTOM_PROVIDER_<NAME>_TIMEOUT` | No | Request timeout in ms (default: `60000`) |

**Examples:**

Local LM Studio instance:
```
CUSTOM_PROVIDER_LMSTUDIO_BASE_URL=http://localhost:1234/v1
CUSTOM_PROVIDER_LMSTUDIO_API_KEY=no-key
CUSTOM_PROVIDER_LMSTUDIO_MODELS=llama-3,mistral-7b,codellama
CUSTOM_PROVIDER_LMSTUDIO_CAPABILITIES=chat
```

Remote vLLM deployment:
```
CUSTOM_PROVIDER_VLLM_BASE_URL=https://my-vllm.example.com/v1
CUSTOM_PROVIDER_VLLM_API_KEY=sk-xxx
CUSTOM_PROVIDER_VLLM_MODELS=meta-llama/Llama-3-70B
CUSTOM_PROVIDER_VLLM_CAPABILITIES=chat,embeddings
```

LiteLLM proxy (multi-model):
```
CUSTOM_PROVIDER_LITELLM_BASE_URL=https://litellm.mycompany.com/v1
CUSTOM_PROVIDER_LITELLM_API_KEY=sk-litellm-key
CUSTOM_PROVIDER_LITELLM_MODELS=gpt-4o,claude-3-sonnet,command-r-plus
CUSTOM_PROVIDER_LITELLM_CAPABILITIES=chat,audio,embeddings
CUSTOM_PROVIDER_LITELLM_TIMEOUT=120000
```

> `<NAME>` can be any uppercase identifier (e.g. `LMSTUDIO`, `VLLM`, `MYPROXY`). It becomes the provider ID used in the database and API routing.

### Optional

| Key | Default | Purpose |
|---|---|---|
| `MASTER_ENCRYPTION_KEY` | (built-in default) | Encrypts sub-provider API keys at rest. Set a random string for production. |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info`, or `debug` |
| `ENABLE_METRICS` | `false` | Enable Prometheus-style metrics collection |

After adding all variables, click **Save**.

---

## 6. Redeploy

1. Go to the **Deployments** tab in Vercel.
2. Click **Redeploy** on the latest deployment (or push a new commit to trigger one).
3. Wait for the build to complete.

---

## 7. Verify

Once deployed:

1. Visit `https://your-project.vercel.app/health` — you should see:
   ```json
   { "status": "healthy", "version": "1.0.0" }
   ```

2. Visit `https://your-project.vercel.app/` — you should see:
   ```json
   { "message": "VoidAI API Server", "status": "operational" }
   ```

3. Test an API call:
   ```bash
   curl https://your-project.vercel.app/v1/models
   ```

---

## 8. Set up Vercel Cron (optional)

The project includes a cron job (`api/cron.ts`) that resets user credits every hour. Vercel automatically enables cron jobs on the **Hobby** (free) tier and above.

To verify it's active:

1. Go to your Vercel project → **Settings** → **Cron Jobs**.
2. You should see `/api/cron` scheduled to run every hour (`0 * * * *`).

If you don't see it, make sure `vercel.json` in your repo root contains:
```json
{
  "crons": [
    {
      "path": "/api/cron",
      "schedule": "0 * * * *"
    }
  ]
}
```

---

## 9. Create your first API user

After deployment, create a user via the admin API:

```bash
curl -X POST https://your-project.vercel.app/admin/users \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-app",
    "plan": "free",
    "credits": 10000,
    "permissions": ["*"],
    "rateLimit": 1000,
    "maxConcurrentRequests": 5
  }'
```

The response includes an `apiKey` — use this for all subsequent API calls:

```bash
curl https://your-project.vercel.app/v1/chat/completions \
  -H "Authorization: Bearer sk-your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

---

## Troubleshooting

### Blank 500 error on first request
- Check Vercel function logs: **Deployments** → click deployment → **Functions** tab → `api/index.ts` → **Logs**.
- Most likely cause: missing or incorrect `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`.

### `SUPABASE_URL` errors
- Make sure the URL starts with `https://` and ends with `.supabase.co`.

### Function timeout
- The main handler has a 300-second timeout (set in `vercel.json`). If AI provider calls take longer, increase `maxDuration` or reduce `OPENAI_API_KEY` model sizes.

### Cron not running
- Vercel cron jobs only work on deployed branches (not preview deployments). Make sure you're on the production branch.

---

## Project structure

```
api/
  index.ts          # Vercel catch-all API handler → Elysia
  cron.ts           # Hourly credit reset cron job

app/
  bootstrap.ts      # App initialization (no MongoDB)
  server.ts         # Elysia server with routes
  main.ts           # Standalone entrypoint (Docker/local use)
  infrastructure/
    supabase/
      client.ts     # Supabase admin client
    repositories/
      supabase-*.ts # Supabase repository implementations

supabase/
  migrations/
    0001_voidai.sql  # Database schema

vercel.json          # Vercel config (functions, crons, rewrites)
```

---

## What changed from Docker

| Before (Docker) | After (Vercel) |
|---|---|
| MongoDB | Supabase PostgreSQL |
| Redis (rate limiting) | In-memory (personal use) |
| `node-cron` (credit reset) | Vercel Cron (`/api/cron`) |
| Persistent Bun process | Stateless serverless functions |
| Docker Compose | Vercel deployment |
| Prometheus + Grafana | Optional — use Vercel Analytics or external monitoring |
