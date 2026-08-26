# Vercel + Supabase Migration

This repository has been migrated from a Dockerized Bun/Elysia + MongoDB/Redis architecture to a Vercel-compatible serverless deployment backed by Supabase PostgreSQL.

## What changed

- **Repositories**: All 4 MongoDB repositories replaced with Supabase implementations:
  - `SupabaseUserRepository`
  - `SupabaseProviderRepository`
  - `SupabaseSubProviderRepository`
  - `SupabaseApiRequestRepository`
- **Database**: MongoDB replaced with Supabase PostgreSQL (see `supabase/migrations/0001_voidai.sql`)
- **Rate limiting**: Falls back to in-memory when Redis is unavailable (Vercel has no Redis by default)
- **Cron jobs**: `node-cron` removed; credit resets run via Vercel Cron (`api/cron.ts`)
- **Bootstrap**: MongoDB connection removed; Supabase is used directly via `app/infrastructure/supabase/client.ts`
- **Dependencies**: `mongodb` and `node-cron` removed from `package.json`

## Deployment steps

1. Create a Supabase project
2. Run `supabase/migrations/0001_voidai.sql` in the Supabase SQL editor
3. Add environment variables in Vercel:
   - `SUPABASE_URL` — your Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY` — the service-role key (server-side only, never expose as NEXT_PUBLIC_*)
   - `OPENAI_API_KEY` — for AI provider adapters
   - Provider-specific API keys as needed
4. Deploy to Vercel

## Architecture

```
Vercel
  /api        → catch-all Elysia handler (all API routes)
  /api/cron   → daily credit reset cron job (Hobby plan: once/day, Pro: hourly)

Supabase
  PostgreSQL  → users, providers, sub_providers, api_requests
  Auth        → optional (dashboard auth)
```

## Custom providers

Any OpenAI-compatible endpoint can be added via env vars:

```
CUSTOM_PROVIDER_<NAME>_BASE_URL=https://your-api.com/v1
CUSTOM_PROVIDER_<NAME>_API_KEY=your-key
CUSTOM_PROVIDER_<NAME>_MODELS=model-1,model-2
CUSTOM_PROVIDER_<NAME>_CAPABILITIES=chat,audio,embeddings,images,moderation
```

See `vercel_setup.md` for full details and examples.

## Environment variables

Server-only:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- Provider API keys used by configured adapters
- `CUSTOM_PROVIDER_*` for custom OpenAI-compatible endpoints

The service-role key must never be exposed via `NEXT_PUBLIC_*` variables.

## Preserving Docker deployment

The original `app/main.ts` entrypoint and `docker-compose.yml` are preserved for local/Docker development. The Inversify container now binds Supabase repositories, so Docker deployments also need `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` environment variables instead of `MONGODB_URI`.
