/**
 * Monocle — Devnet Wallet Setup Script
 *
 * Generates a fresh Solana keypair for x402 payments,
 * writes the config to your .env, and prints next steps.
 *
 * Usage:
 *   cd agent-backend
 *   npx ts-node scripts/setup-x402-wallet.ts
 */

import { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

const ENV_PATH = path.join(__dirname, "..", ".env");
const DEVNET_RPC = "https://api.devnet.solana.com";

// ─── ANSI colors ──────────────────────────────────────────────
const cl = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  purple: "\x1b[35m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
};

function log(msg: string) { console.log(msg); }
function ok(msg: string)  { log(`${cl.green}✓${cl.reset} ${msg}`); }
function info(msg: string){ log(`${cl.cyan}→${cl.reset} ${msg}`); }
function warn(msg: string){ log(`${cl.yellow}⚠${cl.reset} ${msg}`); }
function err(msg: string) { log(`${cl.red}✗${cl.reset} ${msg}`); }
function dim(msg: string) { log(`${cl.dim}${msg}${cl.reset}`); }

// ─── Banner ───────────────────────────────────────────────────
function banner() {
  log("");
  log(`${cl.purple}${cl.bold}  ███╗   ███╗ ██████╗ ███╗   ██╗ ██████╗  ██████╗██╗     ███████╗${cl.reset}`);
  log(`${cl.purple}${cl.bold}  ████╗ ████║██╔═══██╗████╗  ██║██╔═══██╗██╔════╝██║     ██╔════╝${cl.reset}`);
  log(`${cl.purple}${cl.bold}  ██╔████╔██║██║   ██║██╔██╗ ██║██║   ██║██║     ██║     █████╗  ${cl.reset}`);
  log(`${cl.purple}${cl.bold}  ██║╚██╔╝██║██║   ██║██║╚██╗██║██║   ██║██║     ██║     ██╔══╝  ${cl.reset}`);
  log(`${cl.purple}${cl.bold}  ██║ ╚═╝ ██║╚██████╔╝██║ ╚████║╚██████╔╝╚██████╗███████╗███████╗${cl.reset}`);
  log(`${cl.purple}${cl.bold}  ╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═══╝ ╚═════╝  ╚═════╝╚══════╝╚══════╝${cl.reset}`);
  log("");
  log(`  ${cl.bold}x402 Devnet Wallet Setup${cl.reset}  ${cl.dim}· Solana Hackathon Edition${cl.reset}`);
  log("");
}

// ─── Check if wallet already exists in .env ───────────────────
function getExistingWallet(): string | null {
  if (!fs.existsSync(ENV_PATH)) return null;
  const env = fs.readFileSync(ENV_PATH, "utf8");
  const match = env.match(/^X402_PAY_TO=(.+)$/m);
  return match ? match[1].trim() : null;
}

// ─── Update .env with x402 config ─────────────────────────────
function updateEnv(publicKey: string, privateKeyHex: string) {
  if (!fs.existsSync(ENV_PATH)) {
    err(`.env not found at ${ENV_PATH}`);
    process.exit(1);
  }

  let env = fs.readFileSync(ENV_PATH, "utf8");

  const updates: Record<string, string> = {
    X402_PAY_TO: publicKey,
    X402_CLIENT_PRIVATE_KEY: privateKeyHex,
    SOLANA_NETWORK: "devnet",
    X402_FACILITATOR_URL: "https://x402.org/facilitator",
    X402_CHAT_PRICE: "0.001",
  };

  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(env)) {
      env = env.replace(regex, `${key}=${value}`);
    } else {
      env += `\n${key}=${value}`;
    }
  }

  fs.writeFileSync(ENV_PATH, env);
}

// ─── Check devnet SOL balance ─────────────────────────────────
async function checkBalance(publicKey: string): Promise<number> {
  try {
    const connection = new Connection(DEVNET_RPC, "confirmed");
    const balance = await connection.getBalance(new PublicKey(publicKey));
    return balance / LAMPORTS_PER_SOL;
  } catch {
    return -1;
  }
}

// ─── Ask user a yes/no question ───────────────────────────────
function ask(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${cl.yellow}?${cl.reset} ${question} (y/n) `, (ans) => {
      rl.close();
      resolve(ans.toLowerCase().startsWith("y"));
    });
  });
}

// ─── Main ─────────────────────────────────────────────────────
async function main() {
  banner();

  // 1. Check for existing wallet
  const existing = getExistingWallet();
  if (existing) {
    warn(`Wallet already configured: ${cl.cyan}${existing}${cl.reset}`);
    const overwrite = await ask("Generate a new wallet and overwrite?");
    if (!overwrite) {
      info("Keeping existing wallet. Checking balance...");
      const bal = await checkBalance(existing);
      if (bal >= 0) {
        ok(`Balance: ${cl.green}${bal.toFixed(4)} SOL${cl.reset} on devnet`);
      }
      printNextSteps(existing);
      return;
    }
  }

  // 2. Generate fresh keypair
  log(`${cl.bold}Step 1: Generating Solana keypair...${cl.reset}`);
  const keypair = Keypair.generate();
  const publicKey = keypair.publicKey.toBase58();
  const privateKeyHex = Buffer.from(keypair.secretKey).toString("hex");

  ok(`Public key:  ${cl.cyan}${publicKey}${cl.reset}`);
  ok(`Private key: ${cl.dim}${privateKeyHex.slice(0, 16)}...${privateKeyHex.slice(-8)}${cl.reset} (written to .env)`);
  log("");

  // 3. Write to .env
  log(`${cl.bold}Step 2: Writing config to .env...${cl.reset}`);
  updateEnv(publicKey, privateKeyHex);
  ok("x402 config written to agent-backend/.env");
  log("");
  dim("  X402_PAY_TO=" + publicKey);
  dim("  X402_CLIENT_PRIVATE_KEY=<hidden>");
  dim("  SOLANA_NETWORK=devnet");
  dim("  X402_FACILITATOR_URL=https://x402.org/facilitator");
  dim("  X402_CHAT_PRICE=0.001");
  log("");

  // 4. Airdrop instructions
  log(`${cl.bold}Step 3: Fund your devnet wallet${cl.reset}`);
  log("");
  info(`Get devnet SOL (for transaction fees):`);
  log(`  ${cl.cyan}https://faucet.solana.com${cl.reset}`);
  log(`  Paste: ${cl.bold}${publicKey}${cl.reset}`);
  log("");
  info(`Get devnet USDC (for x402 payments):`);
  log(`  ${cl.cyan}https://faucet.circle.com${cl.reset}`);
  log(`  Network: Solana Devnet`);
  log(`  Paste: ${cl.bold}${publicKey}${cl.reset}`);
  log("");

  // 5. Try to airdrop SOL automatically
  const autoAirdrop = await ask("Try automatic devnet SOL airdrop? (requires internet)");
  if (autoAirdrop) {
    log("");
    info("Requesting 2 SOL airdrop from devnet...");
    try {
      const connection = new Connection(DEVNET_RPC, "confirmed");
      const sig = await connection.requestAirdrop(
        keypair.publicKey,
        2 * LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(sig, "confirmed");
      const bal = await checkBalance(publicKey);
      ok(`Airdrop confirmed! Balance: ${cl.green}${bal.toFixed(4)} SOL${cl.reset}`);
      log(`  ${cl.dim}Tx: https://explorer.solana.com/tx/${sig}?cluster=devnet${cl.reset}`);
    } catch (e) {
      warn("Airdrop failed (rate limited). Use https://faucet.solana.com manually.");
    }
    log("");
  }

  printNextSteps(publicKey);
}

function printNextSteps(publicKey: string) {
  log("");
  log(`${cl.bold}${cl.purple}━━━ Next Steps ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${cl.reset}`);
  log("");
  log(`  ${cl.bold}1.${cl.reset} Restart the backend:`);
  log(`     ${cl.dim}cd agent-backend && npm run dev${cl.reset}`);
  log("");
  log(`  ${cl.bold}2.${cl.reset} Verify x402 is active:`);
  log(`     ${cl.dim}curl http://localhost:3001/v1/x402-feed/status${cl.reset}`);
  log(`     Look for: ${cl.green}"x402Enabled": true${cl.reset}`);
  log("");
  log(`  ${cl.bold}3.${cl.reset} Open the chat and send a message:`);
  log(`     ${cl.dim}http://localhost:3000/chat${cl.reset}`);
  log(`     You should see a green tx badge appear under each response`);
  log("");
  log(`  ${cl.bold}4.${cl.reset} Watch live transactions:`);
  log(`     ${cl.dim}http://localhost:3000/payments${cl.reset}`);
  log("");
  log(`  ${cl.bold}5.${cl.reset} Verify on Solana Explorer:`);
  log(`     ${cl.cyan}https://explorer.solana.com/address/${publicKey}?cluster=devnet${cl.reset}`);
  log("");
  log(`${cl.purple}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${cl.reset}`);
  log("");
  log(`  ${cl.green}${cl.bold}Monocle is ready for the hackathon. Ship it.${cl.reset}`);
  log("");
}

main().catch((e) => {
  err(`Setup failed: ${e.message}`);
  process.exit(1);
});
