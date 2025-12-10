// Simple end-to-end harness (SDK -> Backend -> Solana placeholders).
// Prereqs:
// 1) Build SDK: (cd agent-sdk && npm install && npm run build)
// 2) Backend running on http://localhost:3001 with required env and DB.
// 3) Replace sender/receiver wallets below (use devnet for safety).

import { AgentPayClient } from "./agent-sdk/dist/index.js";

async function run() {
  const client = new AgentPayClient({
    apiKey: process.env.AGENTPAY_API_KEY || "test_key",
    baseUrl: process.env.AGENT_BACKEND_URL || "http://localhost:3001"
  });

  try {
    // Test 1: Verify identity
    console.log("Testing identity verification...");
    await client.verifyIdentity({
      firstName: "Test",
      lastName: "User",
      dob: "1990-01-01",
      idNumber: "ID123"
    });
    console.log("✅ Identity verified");

    // Test 2: Log tool call
    console.log("Testing meter logging...");
    await client.logToolCall("agent_123", "summary", 42, { text: "Hello" });
    console.log("✅ Meter logged");

    // Test 3: Send payment (will fail without valid wallets, but tests connectivity)
    console.log("Testing payment endpoint...");
    try {
      const { signature } = await client.payAgent(
        "SENDER_WALLET_PUBKEY",
        "RECEIVER_WALLET_PUBKEY",
        10_000
      );
      console.log("✅ Payment sent", signature);
    } catch (err) {
      // Expected to fail with invalid pubkeys or missing payer
      console.log("⚠️  Payment endpoint responded (error expected with invalid keys):", (err as Error).message);
    }

    console.log("\n✨ All tests completed!");
  } catch (err) {
    console.error("❌ Test failed:", err);
    process.exit(1);
  }
}

run();


