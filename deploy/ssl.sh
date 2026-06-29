#!/usr/bin/env bash
# ssl.sh — run AFTER api.monocle.3lvn4g.xyz DNS A record is live
set -euo pipefail

EC2_USER="ubuntu"
EC2_IP="54.242.122.233"
KEY="$HOME/.ssh/monocle-ec2-key.pem"
SSH="ssh -i $KEY -o StrictHostKeyChecking=no $EC2_USER@$EC2_IP"

echo "==> Issuing Let's Encrypt cert for api.monocle.3lvn4g.xyz..."
$SSH sudo certbot --nginx \
  -d api.monocle.3lvn4g.xyz \
  --non-interactive --agree-tos -m admin@3lvn4g.xyz

$SSH sudo nginx -t && $SSH sudo systemctl reload nginx

echo ""
echo "=== SSL issued. API live at: https://api.monocle.3lvn4g.xyz/health"
