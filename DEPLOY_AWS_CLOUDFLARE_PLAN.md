# AWS EC2 Backend + Cloudflare Frontend Deployment Plan

## 1. What is already working

The current repo already has the two main runtime components:

- Backend API: Express + TypeScript in [agent-backend](agent-backend)
- Frontend dashboard: Next.js in [agent-dashboard](agent-dashboard)
- Local orchestration: [docker-compose.yml](docker-compose.yml)

Verified today:
- Backend build: `npm run build` completed successfully in [agent-backend](agent-backend)
- Frontend build: `npm run build` completed successfully in [agent-dashboard](agent-dashboard)

## 2. Target architecture

- AWS EC2: host the backend API and run it behind Nginx + HTTPS
- AWS RDS PostgreSQL: production database (recommended over local Postgres)
- Cloudflare Pages: host the Next.js frontend
- Cloudflare DNS / SSL: public frontend domain
- Backend URL exposed to the frontend via `NEXT_PUBLIC_BACKEND_URL`

## 3. Recommended production topology

```text
Browser
  -> Cloudflare Pages (frontend)
       -> API calls to https://api.yourdomain.com
            -> EC2 Nginx -> Express backend
                 -> RDS PostgreSQL
                 -> Solana RPC
```

## 4. AWS EC2 backend setup

### 4.1 EC2 instance
- AMI: Ubuntu 22.04 LTS
- Instance type: t3.medium or t3.large
- Storage: 20–30 GB gp3
- Security group:
  - 22/tcp from your admin IP
  - 80/tcp from 0.0.0.0/0
  - 443/tcp from 0.0.0.0/0
  - 3001/tcp from Cloudflare IPs only (or leave internal if behind Nginx)

### 4.2 Install OS dependencies
```bash
sudo apt update
sudo apt install -y nginx git curl build-essential python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### 4.3 Clone and install backend
```bash
cd /opt
sudo git clone https://github.com/<org>/<repo>.git monocle
cd /opt/monocle/app/agent-backend
npm ci
npm run build
```

### 4.4 Create production env file
Use the values from [agent-backend/env.sample](agent-backend/env.sample) and add:
```env
PORT=3001
NODE_ENV=production
DATABASE_URL=postgres://USER:PASS@HOST:5432/DBNAME
AGENTPAY_API_KEY=<strong-random-key>
JWT_SECRET=<strong-random-key>
SOLANA_RPC=https://api.devnet.solana.com
SOLANA_PAYER_SECRET=<wallet-keypair-json-array>
CORS_ORIGINS=https://app.yourdomain.com
```

### 4.5 Run backend as a systemd service
Create `/etc/systemd/system/agentpay-backend.service`:
```ini
[Unit]
Description=AgentPay Backend
After=network.target

[Service]
WorkingDirectory=/opt/monocle/app/agent-backend
EnvironmentFile=/opt/monocle/app/agent-backend/.env
ExecStart=/usr/bin/npm start
Restart=always
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl daemon-reload
sudo systemctl enable agentpay-backend
sudo systemctl start agentpay-backend
sudo systemctl status agentpay-backend
```

### 4.6 Nginx reverse proxy
Create `/etc/nginx/sites-available/api.yourdomain.com`:
```nginx
server {
  listen 80;
  server_name api.yourdomain.com;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl;
  server_name api.yourdomain.com;

  ssl_certificate /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

Then:
```bash
sudo ln -s /etc/nginx/sites-available/api.yourdomain.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d api.yourdomain.com
```

## 5. RDS PostgreSQL setup

Use AWS RDS PostgreSQL 15+.

Recommended settings:
- Public access: no (private subnet only)
- Storage: 20 GB gp3
- Backup retention: 7–30 days
- Security group: allow EC2 security group only

Create the schema from [agent-backend/src/db/schema.sql](agent-backend/src/db/schema.sql).

## 6. Cloudflare frontend setup

### 6.1 Cloudflare Pages
- Create a Pages project from the repo
- Build command: `cd agent-dashboard && npm install && npm run build`
- Output directory: `agent-dashboard/.next` or use the Pages adapter if you switch to the Cloudflare-compatible Next.js deployment path

### 6.2 Needed frontend env vars
Set these in Cloudflare Pages:
```env
NEXT_PUBLIC_BACKEND_URL=https://api.yourdomain.com
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
```

### 6.3 DNS / TLS
- Point `app.yourdomain.com` to Cloudflare Pages
- Enable Cloudflare Proxy (orange cloud)
- Set TLS to Full (Strict)

## 7. Important security fix before public launch

The current dashboard uses browser-side API keys from local storage in [agent-dashboard/lib/api.ts](agent-dashboard/lib/api.ts). The repo already documents this risk in [C1_ARCHITECTURE.md](C1_ARCHITECTURE.md).

Before production use, do one of these:
1. Add a Next.js server-side proxy route (smallest fix)
2. Add real user auth/JWT sessions
3. Or move all authenticated calls behind a backend-only proxy

This is the main production hardening step for the frontend.

## 8. Deployment sequence

### Phase A — infrastructure
1. Create AWS EC2 instance
2. Create RDS PostgreSQL
3. Configure security groups
4. Install Node.js + Nginx + certbot

### Phase B — backend
1. Clone repo on EC2
2. Install dependencies
3. Configure `.env`
4. Run DB migration/schema
5. Start backend service
6. Verify `/health`

### Phase C — frontend
1. Configure Cloudflare Pages
2. Set `NEXT_PUBLIC_BACKEND_URL`
3. Deploy dashboard
4. Verify `app.yourdomain.com` loads and calls the API

### Phase D — validation
1. `GET /health` returns 200
2. `GET /v1/x402/info` returns 200
3. Frontend loads without JS runtime errors
4. API key / auth path works in the chosen production model

## 9. Rollback plan

If the EC2 backend fails:
1. Keep the previous service copy or Git tag
2. Restore the last known-good `.env`
3. Restart the systemd service
4. Re-run `npm run build`

If the frontend fails:
1. Revert the Pages deployment
2. Restore the previous environment variable values
3. Reissue the Cloudflare Pages deployment

## 10. Suggested next improvements

- Replace in-browser API key usage with a server-side proxy route
- Add EC2 auto-scaling / ALB if traffic grows
- Add Cloudflare WAF rules for the API subdomain
- Add S3 or object storage for logs/artifacts
- Add Prometheus / Grafana or CloudWatch monitoring
