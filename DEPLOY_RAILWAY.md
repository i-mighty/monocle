# Monocle AI Router - Railway Deployment

## Quick Deploy Steps

1. **Push to GitHub**
   ```bash
   git add -A
   git commit -m "Prepare for Railway deployment"
   git push origin main
   ```

2. **Connect Railway**
   - Go to [railway.app](https://railway.app)
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your monocle repository
   - Railway will detect the `railway.json` config which points to `agent-backend/Dockerfile`
   - **Important:** Railway does NOT use `docker-compose.yml`. It deploys individual services.
     The docker-compose file is for local development only.

3. **Add PostgreSQL**
   - In Railway dashboard, click "+ New" → "Database" → "PostgreSQL"
   - Railway auto-injects `DATABASE_URL` into your service
   - **Do NOT set DATABASE_URL manually** — Railway's injected value includes the correct internal hostname
   - Run the schema: connect to the Railway Postgres via their CLI or dashboard and execute `agent-backend/src/db/schema.sql`

4. **Set Environment Variables**
   In the backend service settings, add:
   ```
   ADMIN_API_KEY=<generate with: openssl rand -hex 32>
   OPENAI_API_KEY=<your key>
   ANTHROPIC_API_KEY=<your key>
   SOLANA_RPC_URL=https://api.devnet.solana.com
   SOLANA_PAYER_SECRET=<your wallet keypair JSON array>
   JWT_SECRET=<generate with: openssl rand -hex 32>
   NODE_ENV=production
   ```

5. **Generate Domain**
   - Click backend service → Settings → Generate Domain
   - You'll get: `https://monocle-backend-production-xxxx.up.railway.app`

6. **Update Dashboard**
   - Set `NEXT_PUBLIC_BACKEND_URL` to your new backend URL
   - Redeploy dashboard service

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Auto-set by Railway Postgres |
| `ADMIN_API_KEY` | Yes | For admin endpoints |
| `OPENAI_API_KEY` | Yes | LLM router (primary) |
| `ANTHROPIC_API_KEY` | No | LLM router (fallback) |
| `SOLANA_RPC_URL` | Yes | `https://api.devnet.solana.com` for testing |
| `SOLANA_PAYER_SECRET` | Yes | Platform wallet keypair as JSON array |
| `JWT_SECRET` | Yes | Session signing key |
| `NODE_ENV` | Yes | Set to `production` |

## Post-Deploy Checklist

- [ ] Backend `/health` returns 200
- [ ] Dashboard loads at frontend URL
- [ ] Can register a test agent via API
- [ ] Agent verification scheduler is running (check logs)

## Generate Secrets

```bash
# Admin API key
openssl rand -hex 32

# JWT secret  
openssl rand -hex 32

# Solana devnet wallet (for testing)
solana-keygen new --outfile payer.json --no-bip39-passphrase
cat payer.json  # Copy this array for SOLANA_PAYER_SECRET
```
