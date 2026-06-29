#!/usr/bin/env bash
# deploy.sh — push backend to EC2 and restart services
# Run from the repo root: bash deploy/deploy.sh
set -euo pipefail

EC2_IP="54.242.122.233"
EC2_USER="ubuntu"
KEY="$HOME/.ssh/monocle-ec2-key.pem"
REMOTE="/opt/monocle/app"
SSH="ssh -i $KEY -o StrictHostKeyChecking=no $EC2_USER@$EC2_IP"

echo "==> Syncing code to EC2..."
rsync -az --delete \
  --exclude node_modules \
  --exclude dist \
  --exclude .git \
  --exclude "*.env" \
  --exclude agent-dashboard \
  -e "ssh -i $KEY -o StrictHostKeyChecking=no" \
  . $EC2_USER@$EC2_IP:$REMOTE/

echo "==> Uploading backend env and configs..."
scp -i "$KEY" -o StrictHostKeyChecking=no \
  deploy/backend.env \
  $EC2_USER@$EC2_IP:$REMOTE/deploy/

echo "==> Running remote setup..."
$SSH bash << 'REMOTE_EOF'
set -euo pipefail
REMOTE="/opt/monocle/app"

echo "--- Installing system packages (if not already done)..."
if ! command -v node &>/dev/null; then
  sudo apt update -y
  sudo apt install -y nginx certbot python3-certbot-nginx postgresql postgresql-contrib
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
  sudo apt install -y nodejs
fi

echo "--- Setting up PostgreSQL..."
sudo systemctl enable postgresql
sudo systemctl start postgresql
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='agentpay'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER agentpay WITH PASSWORD 'AgentPay2024Prod!';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='agentpay'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE agentpay OWNER agentpay;"

echo "--- Building backend..."
cd $REMOTE/agent-backend
npm ci --omit=dev 2>&1 | tail -3
npm run build

echo "--- Applying DB schema..."
PGPASSWORD='AgentPay2024Prod!' psql -h localhost -U agentpay -d agentpay \
  -f $REMOTE/agent-backend/src/db/schema.sql 2>&1 || echo "(Schema already applied — skipping)"

echo "--- Installing systemd service..."
sudo cp $REMOTE/deploy/monocle-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable monocle-backend
sudo systemctl restart monocle-backend

echo "--- Setting up Nginx..."
sudo cp $REMOTE/deploy/nginx.conf /etc/nginx/sites-available/monocle
sudo ln -sf /etc/nginx/sites-available/monocle /etc/nginx/sites-enabled/monocle
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo ""
echo "=== Backend deployment complete ==="
echo "  Health: http://$(curl -s ifconfig.me):3001/health"
echo ""
echo "Next: add DNS A record then run: bash deploy/ssl.sh"
REMOTE_EOF
