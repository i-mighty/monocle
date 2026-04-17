# Deploying Monocle to Railway

This guide walks you through deploying the full Monocle stack (Backend API, Dashboard, PostgreSQL) to [Railway](https://railway.app).

## Prerequisites

- A [Railway account](https://railway.app) (free tier available)
- This repo pushed to GitHub

---

## Step 1: Create a New Railway Project

1. Go to [railway.app/new](https://railway.app/new)
2. Click **"Deploy from GitHub Repo"**
3. Select the **monocle** repository

---

## Step 2: Add PostgreSQL

1. In your Railway project, click **"+ New"** → **"Database"** → **"PostgreSQL"**
2. Railway provisions a managed PostgreSQL instance automatically
3. Copy the `DATABASE_URL` from the PostgreSQL service's **Variables** tab — you'll need it for the backend

---

## Step 3: Deploy the Backend API

1. In your Railway project, click **"+ New"** → **"GitHub Repo"** → select **monocle**
2. In the service settings:
   - Set **Root Directory** to `agent-backend`
   - Railway will auto-detect the `railway.toml` and Dockerfile
3. Go to the **Variables** tab and add:

| Variable | Value | Required |
|----------|-------|----------|
| `PORT` | `3001` | Yes |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference the Railway PG service) | Yes |
| `NODE_ENV` | `production` | Yes |
| `JWT_SECRET` | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | Yes |
| `AGENTPAY_API_KEY` | Your chosen API key | Yes |
| `LOG_ENCRYPTION_KEY` | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` | Recommended |
| `SOLANA_RPC` | `https://api.devnet.solana.com` (or mainnet RPC) | Yes |
| `SOLANA_PAYER_SECRET` | Your Solana keypair JSON array | Yes |
| `SOLANA_NETWORK` | `devnet` or `mainnet` | Yes |
| `OPENAI_API_KEY` | Your OpenAI key | Optional |
| `ANTHROPIC_API_KEY` | Your Anthropic key | Optional |
| `GOOGLE_API_KEY` | Your Google AI key | Optional |
| `X402_PAY_TO` | Your USDC receiving wallet address | Optional |
| `X402_FACILITATOR_URL` | `https://facilitator.x402.org` | Optional |
| `X402_CHAT_PRICE` | `0.001` | Optional |

4. Go to **Settings** → **Networking** → click **"Generate Domain"** to get a public URL
5. Note the backend URL (e.g., `https://monocle-backend-production.up.railway.app`)

---

## Step 4: Initialize the Database

After the backend deploys, run the schema migration:

1. Go to **PostgreSQL service** → **Data** tab → **Query**
2. Copy and paste the contents of `agent-backend/src/db/schema.sql`
3. Execute the query

Alternatively, use the Railway CLI:
```bash
railway run --service backend npm run db:push
```

---

## Step 5: Deploy the Dashboard

1. In your Railway project, click **"+ New"** → **"GitHub Repo"** → select **monocle** again
2. In the service settings:
   - Set **Root Directory** to `agent-dashboard`
   - Railway will auto-detect the `railway.toml` and Dockerfile
3. Go to the **Variables** tab and add:

| Variable | Value | Required |
|----------|-------|----------|
| `NEXT_PUBLIC_BACKEND_URL` | The backend URL from Step 3 (e.g., `https://monocle-backend-production.up.railway.app`) | Yes |

4. Go to **Settings** → **Networking** → click **"Generate Domain"** for the dashboard URL

---

## Step 6: Verify Deployment

1. Check backend health: `https://<backend-url>/health`
2. Open the dashboard URL in your browser
3. Check the API docs: `https://<backend-url>/v1`

---

## Environment Variable Reference

Use `${{ServiceName.VARIABLE}}` syntax in Railway to reference variables across services. For example, `${{Postgres.DATABASE_URL}}` auto-links the database URL.

---

## Redeployments

Railway auto-deploys on every push to `main`. To trigger a manual redeploy, click **"Redeploy"** on any service in the Railway dashboard.

---

## Railway CLI (Optional)

Install the Railway CLI for local development connected to Railway services:

```bash
npm install -g @railway/cli
railway login
railway link
railway run npm run dev  # Runs locally with Railway env vars
```
