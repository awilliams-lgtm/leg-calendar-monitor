# Legislative calendar monitor

Compares official 50-state and U.S. Congress calendars with [State Affairs](https://www.stateaffairs.com/) so you can see what is posted officially, what SA has listed, and where they diverge.

## What counts as official

Only events that appear on a public legislative or capitol calendar are stored as official. State Affairs also lists member fundraisers, executive boards, and advocacy events. Those stay on the SA side until the official site posts them. The scrapers do not invent dates.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. Use Settings to connect State Affairs (Cloudflare Access login) and refresh official calendars.

## Deploy on Vercel

1. Import this GitHub repo into [Vercel](https://vercel.com/new).
2. Add a [Neon](https://vercel.com/storage/neon) Postgres database. Vercel will set `DATABASE_URL`.
3. Set environment variables:
   - `CRON_SECRET` — Vercel Cron sends this automatically if you set the same value in the project.
   - `ADMIN_PASSWORD` — locks Settings.
   - `SA_COOKIE` or `SA_BEARER_TOKEN` — optional fallback. Prefer one Settings login; cron reuses that session.
   - `OPENSTATES_API_KEY` — optional fallback for thin official feeds.
4. Deploy. Cron hits `/api/cron/tick` every hour from 7am to 5pm Eastern and scrapes official calendars in batches.

Without Neon the site still builds, but Vercel’s filesystem will not keep the calendar cache between requests.

## Scripts

- `npm run sa:login` — save a State Affairs browser session locally (needed if Cloudflare Access expires).
- `npm run sa:keep` — reuse that login and push it to the hosted site.
- `npm run sa:keep:install` — schedule `sa:keep` on this Windows PC every 30 minutes.
- `npm run sa:pull` — pull SA meetings into `data/sa-meetings-cache.json` (gitignored).

To keep the hosted site connected without copying Cookie headers: put `ADMIN_PASSWORD` in `.env.local`, run `npm run sa:login` once, then `npm run sa:keep:install`.
