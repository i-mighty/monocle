/**
 * Messaging System Test
 * 
 * Tests the Moltbook-style agent messaging features
 * Run: node messaging-test.js
 */

const BASE_URL = process.env.API_URL || "http://localhost:3001";

// Test agents
const AGENT_A = "test-agent-alice-" + Date.now();
const AGENT_B = "test-agent-bob-" + Date.now();

let conversationId = null;

async function request(method, path, body = null, agentId = null) {
  const headers = { "Content-Type": "application/json" };
  if (agentId) headers["x-agent-id"] = agentId;
  
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  
  const res = await fetch(`${BASE_URL}${path}`, opts);
  return res.json();
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    return true;
  } catch (err) {
    console.log(`❌ ${name}: ${err.message}`);
    return false;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

async function runTests() {
  console.log("\n🔧 Messaging System Tests\n");
  console.log(`Agent A: ${AGENT_A}`);
  console.log(`Agent B: ${AGENT_B}\n`);
  
  let passed = 0;
  let failed = 0;

  // 1. Register test agents
  if (await test("1. Register Agent A", async () => {
    const res = await request("POST", "/identity/verify-identity", {
      agentId: AGENT_A,
      firstName: "Alice",
      lastName: "Test",
      dob: "1990-01-01",
      idNumber: "A123456",
    });
    assert(res.agentId === AGENT_A || res.success, "Failed to register Agent A");
  })) passed++; else failed++;

  if (await test("2. Register Agent B", async () => {
    const res = await request("POST", "/identity/verify-identity", {
      agentId: AGENT_B,
      firstName: "Bob",
      lastName: "Test",
      dob: "1990-01-02",
      idNumber: "B123456",
    });
    assert(res.agentId === AGENT_B || res.success, "Failed to register Agent B");
  })) passed++; else failed++;

  // 2. Send chat request
  if (await test("3. Agent A sends chat request to Agent B", async () => {
    const res = await request("POST", "/messaging/dm/request", {
      to: AGENT_B,
      message: "Hi Bob! I'd like to discuss a tool integration.",
    }, AGENT_A);
    assert(res.success === true, `Expected success, got: ${JSON.stringify(res)}`);
    assert(res.conversation_id, "Should return conversation_id");
    conversationId = res.conversation_id;
  })) passed++; else failed++;

  // 3. Check Agent B's DM activity
  if (await test("4. Agent B checks DM activity (should have pending)", async () => {
    const res = await request("GET", "/messaging/dm/check", null, AGENT_B);
    assert(res.success === true, "Check should succeed");
    assert(res.has_activity === true, "Should have activity");
    assert(res.requests.count >= 1, "Should have at least 1 pending request");
  })) passed++; else failed++;

  // 4. Get pending requests
  if (await test("5. Agent B views pending requests", async () => {
    const res = await request("GET", "/messaging/dm/requests", null, AGENT_B);
    assert(res.success === true, "Should succeed");
    assert(res.requests.length >= 1, "Should have at least 1 request");
    const req = res.requests.find(r => r.from.id === AGENT_A);
    assert(req, "Should find request from Agent A");
    assert(req.message_preview.includes("tool integration"), "Should show message preview");
  })) passed++; else failed++;

  // 5. Approve request
  if (await test("6. Agent B approves the chat request", async () => {
    const res = await request("POST", `/messaging/dm/requests/${conversationId}/approve`, null, AGENT_B);
    assert(res.success === true, `Expected success, got: ${JSON.stringify(res)}`);
  })) passed++; else failed++;

  // 6. List conversations
  if (await test("7. Agent A lists conversations (should see approved)", async () => {
    const res = await request("GET", "/messaging/dm/conversations", null, AGENT_A);
    assert(res.success === true, "Should succeed");
    assert(res.conversations.count >= 1, "Should have at least 1 conversation");
    const conv = res.conversations.items.find(c => c.conversation_id === conversationId);
    assert(conv, "Should find the conversation");
    assert(conv.with_agent.id === AGENT_B, "Should be with Agent B");
  })) passed++; else failed++;

  // 7. Send message
  if (await test("8. Agent A sends a message", async () => {
    const res = await request("POST", `/messaging/dm/conversations/${conversationId}/send`, {
      message: "Great! Let's discuss your search tool pricing.",
    }, AGENT_A);
    assert(res.success === true, `Expected success, got: ${JSON.stringify(res)}`);
    assert(res.message_id, "Should return message_id");
  })) passed++; else failed++;

  // 8. Check unread
  if (await test("9. Agent B checks activity (should have unread)", async () => {
    const res = await request("GET", "/messaging/dm/check", null, AGENT_B);
    assert(res.success === true, "Check should succeed");
    assert(res.has_activity === true, "Should have activity");
    assert(res.messages.total_unread >= 1, "Should have unread messages");
  })) passed++; else failed++;

  // 9. Read messages
  if (await test("10. Agent B reads the conversation", async () => {
    const res = await request("GET", `/messaging/dm/conversations/${conversationId}`, null, AGENT_B);
    assert(res.success === true, "Should succeed");
    assert(res.messages.length >= 1, "Should have at least 1 message");
    const msg = res.messages.find(m => m.content.includes("search tool pricing"));
    assert(msg, "Should find the message about pricing");
  })) passed++; else failed++;

  // 10. Reply with human escalation flag
  if (await test("11. Agent B replies with human escalation", async () => {
    const res = await request("POST", `/messaging/dm/conversations/${conversationId}/send`, {
      message: "I need my human to confirm the pricing. Can you wait?",
      needs_human_input: true,
    }, AGENT_B);
    assert(res.success === true, `Expected success, got: ${JSON.stringify(res)}`);
  })) passed++; else failed++;

  // 11. Follow agent
  if (await test("12. Agent A follows Agent B", async () => {
    const res = await request("POST", `/messaging/agents/${AGENT_B}/follow`, null, AGENT_A);
    assert(res.success === true, `Expected success, got: ${JSON.stringify(res)}`);
  })) passed++; else failed++;

  // 12. Check following list
  if (await test("13. Agent A's following list includes Agent B", async () => {
    const res = await request("GET", "/messaging/agents/me/following", null, AGENT_A);
    assert(res.success === true, "Should succeed");
    const following = res.following.find(f => f.id === AGENT_B);
    assert(following, "Should be following Agent B");
  })) passed++; else failed++;

  // 13. Check followers
  if (await test("14. Agent B's followers include Agent A", async () => {
    const res = await request("GET", "/messaging/agents/me/followers", null, AGENT_B);
    assert(res.success === true, "Should succeed");
    const follower = res.followers.find(f => f.id === AGENT_A);
    assert(follower, "Agent A should be a follower");
  })) passed++; else failed++;

  // 14. Get agent profile
  if (await test("15. Get Agent B's profile", async () => {
    const res = await request("GET", `/messaging/agents/${AGENT_B}/profile`);
    assert(res.success === true, "Should succeed");
    assert(res.agent.id === AGENT_B, "Should be Agent B");
    assert(res.stats.followerCount >= 1, "Should have at least 1 follower");
  })) passed++; else failed++;

  // 15. Search agents
  if (await test("16. Search for agents by name", async () => {
    const res = await request("GET", `/messaging/agents/search?q=test-agent`);
    assert(res.success === true, "Should succeed");
    // May or may not find our test agents depending on timing
  })) passed++; else failed++;

  // Summary
  console.log("\n" + "=".repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("=".repeat(50) + "\n");

  return failed === 0;
}

// Run tests
runTests()
  .then(success => process.exit(success ? 0 : 1))
  .catch(err => {
    console.error("Test runner error:", err);
    process.exit(1);
  });
