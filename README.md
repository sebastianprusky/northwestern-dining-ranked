# Rank Your Meal Exchanges

A mobile-first, no-login Northwestern campus dining ranking experience. Students make a fast first pass, resolve exact within-bucket order through head-to-head choices, optionally add their go-to order, and export a shareable image.

**Live site:** https://rank-your-meal-exchanges.vercel.app

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Without backend environment variables, the full ranking and sharing flow works and the campus leaderboard is clearly marked as preview data.

## Enable the live leaderboard

1. Create a Supabase project.
2. Run [`supabase/schema.sql`](./supabase/schema.sql) in the Supabase SQL editor.
3. Copy `.env.example` to `.env.local` and add the project URL and service-role key.
4. Restart the development server.

The service-role key is only read inside Next.js route handlers and is never shipped to the browser. Students never create an account. On the canonical production site, a long-lived first-party cookie identifies an anonymous browser installation. Its value is hashed server-side and used to update one visitor row and replace that visitor's previous ranking. Localhost and Vercel preview deployments never write visitor or ranking analytics. Different browsers, devices, private windows, and cleared cookies still count separately, while a short IP-based throttle discourages rapid spam without storing the IP address.

`GET /api/leaderboard` includes two production-only totals: `uniqueVisitorCount` for browsers that opened the site and `completionCount` for browsers that completed a ranking. Legacy development/test rows are excluded from both metrics.

## Deploy

Deploy to Vercel and add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as production environment variables.
