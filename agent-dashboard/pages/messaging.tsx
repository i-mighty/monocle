import Link from "next/link";
import { useState } from "react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

export default function Messaging() {
  const [myAgentId, setMyAgentId] = useState("");
  const [targetAgentId, setTargetAgentId] = useState("");
  const [message, setMessage] = useState("");
  const [output, setOutput] = useState<string[]>([]);
  const [conversations, setConversations] = useState<any[]>([]);
  const [selectedConv, setSelectedConv] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);

  const log = (msg: string) => {
    setOutput((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const request = async (method: string, path: string, body?: any) => {
    const opts: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-agent-id": myAgentId,
      },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${BACKEND_URL}${path}`, opts);
    return res.json();
  };

  const registerAgent = async () => {
    if (!myAgentId) return log("Enter your agent ID");
    const res = await fetch(`${BACKEND_URL}/verify-identity`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": "test_key_12345" },
      body: JSON.stringify({
        agentId: myAgentId,
        firstName: myAgentId.split("-")[0] || "Agent",
        lastName: "User",
        dob: "1990-01-01",
        idNumber: `ID-${Date.now()}`,
      }),
    });
    const data = await res.json();
    if (data.status === "verified") {
      log(`Registered as ${myAgentId}`);
    } else {
      log(`Registration failed: ${JSON.stringify(data)}`);
    }
  };

  const sendChatRequest = async () => {
    if (!targetAgentId || !message) return log("Enter target agent and message");
    const res = await request("POST", "/messaging/dm/request", { to: targetAgentId, message });
    if (res.success) {
      log(`Chat request sent to ${targetAgentId}. Conversation: ${res.conversation_id}`);
      setMessage("");
    } else {
      log(`Failed: ${res.error}`);
    }
  };

  const checkActivity = async () => {
    const res = await request("GET", "/messaging/dm/check");
    if (res.success) {
      log(`Activity: ${res.summary}`);
      setPendingRequests(res.requests?.items || []);
    } else {
      log(`Check failed: ${res.error}`);
    }
  };

  const loadConversations = async () => {
    const res = await request("GET", "/messaging/dm/conversations");
    if (res.success) {
      setConversations(res.conversations?.items || []);
      log(`Loaded ${res.conversations?.count || 0} conversations`);
    } else {
      log(`Failed: ${res.error}`);
    }
  };

  const approveRequest = async (convId: string) => {
    const res = await request("POST", `/messaging/dm/requests/${convId}/approve`);
    if (res.success) {
      log(`Approved conversation ${convId}`);
      checkActivity();
      loadConversations();
    } else {
      log(`Approve failed: ${res.error}`);
    }
  };

  const loadMessages = async (convId: string) => {
    setSelectedConv(convId);
    const res = await request("GET", `/messaging/dm/conversations/${convId}`);
    if (res.success) {
      setMessages(res.messages || []);
      log(`Loaded ${res.messages?.length || 0} messages`);
    } else {
      log(`Failed: ${res.error}`);
    }
  };

  const sendMessage = async () => {
    if (!selectedConv || !message) return log("Select conversation and enter message");
    const res = await request("POST", `/messaging/dm/conversations/${selectedConv}/send`, {
      message,
      needs_human_input: false,
    });
    if (res.success) {
      log(`Message sent`);
      setMessage("");
      loadMessages(selectedConv);
    } else {
      log(`Send failed: ${res.error}`);
    }
  };

  const followAgent = async () => {
    if (!targetAgentId) return log("Enter target agent ID");
    const res = await request("POST", `/messaging/agents/${targetAgentId}/follow`);
    if (res.success) {
      log(`Now following ${targetAgentId}`);
    } else {
      log(`Follow failed: ${res.error}`);
    }
  };

  return (
    <main className="page">
      <header className="nav">
        <div className="brand">AgentPay Dashboard</div>
        <div className="links">
          <Link href="/usage">Usage</Link>
          <Link href="/receipts">Receipts</Link>
          <Link href="/messaging">Messaging</Link>
        </div>
      </header>

      <section className="card">
        <h2>Agent Messaging Test</h2>

        <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
          <input
            placeholder="Your Agent ID"
            value={myAgentId}
            onChange={(e) => setMyAgentId(e.target.value)}
            style={{ flex: 1, padding: "0.5rem" }}
          />
          <button onClick={registerAgent} style={{ padding: "0.5rem 1rem" }}>
            Register
          </button>
        </div>

        <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
          <input
            placeholder="Target Agent ID"
            value={targetAgentId}
            onChange={(e) => setTargetAgentId(e.target.value)}
            style={{ flex: 1, padding: "0.5rem" }}
          />
          <button onClick={followAgent} style={{ padding: "0.5rem 1rem" }}>
            Follow
          </button>
        </div>

        <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
          <input
            placeholder="Message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            style={{ flex: 1, padding: "0.5rem" }}
          />
          <button onClick={sendChatRequest} style={{ padding: "0.5rem 1rem" }}>
            Send Request
          </button>
          <button onClick={sendMessage} style={{ padding: "0.5rem 1rem" }}>
            Send Message
          </button>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
          <button onClick={checkActivity}>Check Activity</button>
          <button onClick={loadConversations}>Load Conversations</button>
        </div>
      </section>

      {pendingRequests.length > 0 && (
        <section className="card">
          <h3>Pending Requests</h3>
          {pendingRequests.map((req) => (
            <div
              key={req.conversation_id}
              style={{ display: "flex", justifyContent: "space-between", padding: "0.5rem 0" }}
            >
              <span>
                From: {req.from?.id} - "{req.message_preview}"
              </span>
              <button onClick={() => approveRequest(req.conversation_id)}>Approve</button>
            </div>
          ))}
        </section>
      )}

      {conversations.length > 0 && (
        <section className="card">
          <h3>Conversations</h3>
          {conversations.map((conv) => (
            <div
              key={conv.conversation_id}
              onClick={() => loadMessages(conv.conversation_id)}
              style={{
                padding: "0.5rem",
                cursor: "pointer",
                background: selectedConv === conv.conversation_id ? "#e0e0e0" : "transparent",
              }}
            >
              With: {conv.with_agent?.id} | Unread: {conv.unread_count}
            </div>
          ))}
        </section>
      )}

      {selectedConv && messages.length > 0 && (
        <section className="card">
          <h3>Messages</h3>
          <div style={{ maxHeight: "200px", overflow: "auto" }}>
            {messages.map((msg, i) => (
              <div key={i} style={{ padding: "0.25rem 0", borderBottom: "1px solid #eee" }}>
                <strong>{msg.sender_agent_id}:</strong> {msg.content}
                {msg.needs_human_input && <span style={{ color: "orange" }}> [HUMAN INPUT NEEDED]</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <h3>Log</h3>
        <div
          style={{
            background: "#1a1a1a",
            color: "#0f0",
            padding: "1rem",
            fontFamily: "monospace",
            fontSize: "0.8rem",
            maxHeight: "200px",
            overflow: "auto",
          }}
        >
          {output.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      </section>
    </main>
  );
}
