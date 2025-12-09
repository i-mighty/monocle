// Simple end-to-end harness (SDK -> Backend -> Solana placeholders).
// Prereqs:
// 1) Build SDK: (cd agent-sdk && npm install && npm run build)
// 2) Backend running on http://localhost:3001 with required env and DB.
// 3) Replace sender/receiver wallets below (use devnet for safety).

import AgentPay from "./agent-sdk/dist/index.js";

async function run() {
  const client = new AgentPay({
    apiKey: process.env.AGENTPAY_API_KEY || "test_key",
    baseUrl: process.env.AGENT_BACKEND_URL || "http://localhost:3001"
  });

  await client.verifyIdentity({
    firstName: "Test",
    lastName: "User",
    dob: "1990-01-01",
    idNumber: "ID123"
  });
  console.log("Identity verified ✔️");

  await client.logToolCall("agent_123", "summary", 42, { text: "Hello" });
  console.log("Meter logged ✔️");

  const { signature } = await client.payAgent("SENDER_WALLET_PUBKEY", "RECEIVER_WALLET_PUBKEY", 10_000);
  console.log("Payment sent ✔️", signature);
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

