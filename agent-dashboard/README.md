# Xandeum pNode Analytics Dashboard

Lightweight Next.js dashboard that pulls pNode gossip data via pRPC and shows a searchable, sortable table plus a detail view. Defaults to a sample dataset if the pRPC endpoint is unreachable so the UI stays previewable.

## Quick start

```bash
npm install
npm run dev
```

Visit http://localhost:3000.

## Configure pRPC endpoint

Create `.env.local` with your pRPC gossip endpoint (should return the Pod/PodResponse list shown in the Xandeum docs):

```
PRPC_ENDPOINT=https://prpc.xandeum.network/pods
```

If the endpoint fails or returns no pods, the UI falls back to sample data and shows a banner message.

## Features

- Fetch pNodes via `/api/pnodes` proxy (avoids CORS), normalize the Pod response, and display in a table
- Search across identity, gossip, region, version
- Sort by node, version, region, last seen
- Filter by online/offline (derived from `lastSeen`)
- Auto-refresh every 15s plus manual refresh button
- Detail panel with raw JSON for debugging

## Deploying to Vercel

1. Push this folder to GitHub.
2. In Vercel, create a new project from the repo.
3. Set `PRPC_ENDPOINT` in project environment variables.
4. Deploy (defaults work with `npm run build` / Next.js 14).

## Notes

- The pRPC response is normalized in `lib/prpc.ts`; adjust mapping if your endpoint uses different keys.
- Styling is minimal (custom CSS in `styles/globals.css`) and uses the dark theme to match the Xandeum look.

