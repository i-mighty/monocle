#!/usr/bin/env node
/**
 * AgentPay Quick Setup Script
 * Cross-platform setup (Windows, macOS, Linux)
 * Run: node setup.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

function run(cmd, cwd = ROOT) {
  console.log(`  > ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

function copyIfMissing(src, dest, name) {
  if (!fs.existsSync(dest)) {
    fs.copyFileSync(src, dest);
    console.log(`  [OK] Created ${name}`);
  } else {
    console.log(`  [SKIP] ${name} already exists`);
  }
}

console.log('\n[START] AgentPay Quick Setup');
console.log('='.repeat(40));

// Step 1: Install dependencies
console.log('\n[STEP] Installing dependencies...\n');

console.log('Backend:');
run('npm install', path.join(ROOT, 'agent-backend'));

console.log('\nSDK:');
run('npm install', path.join(ROOT, 'agent-sdk'));
run('npm run build', path.join(ROOT, 'agent-sdk'));

console.log('\nDashboard:');
run('npm install', path.join(ROOT, 'agent-dashboard'));

// Step 2: Create .env files
console.log('\n[STEP] Creating .env files...\n');

copyIfMissing(
  path.join(ROOT, 'agent-backend', 'env.sample'),
  path.join(ROOT, 'agent-backend', '.env'),
  'agent-backend/.env'
);

copyIfMissing(
  path.join(ROOT, 'agent-sdk', 'env.sample'),
  path.join(ROOT, 'agent-sdk', '.env'),
  'agent-sdk/.env'
);

copyIfMissing(
  path.join(ROOT, 'agent-dashboard', 'env.sample'),
  path.join(ROOT, 'agent-dashboard', '.env.local'),
  'agent-dashboard/.env.local'
);

// Done
console.log('\n[DONE] Setup complete!');
console.log('\nNext steps:');
console.log('1. Edit agent-backend/.env with your database URL and Solana settings');
console.log('2. Create PostgreSQL database:');
console.log('   psql -U postgres -c "CREATE DATABASE agentpay;"');
console.log('3. Initialize schema:');
console.log('   psql -U postgres -d agentpay -f agent-backend/src/db/schema.sql');
console.log('\nThen run (in separate terminals):');
console.log('  Terminal 1: cd agent-backend && npm run dev');
console.log('  Terminal 2: cd agent-dashboard && npm run dev');
console.log('  Terminal 3: node test.js');
console.log('\nOpen http://localhost:3000 to see the dashboard\n');
