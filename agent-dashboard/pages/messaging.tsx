import Link from "next/link";
import { useEffect, useState } from "react";
import Layout from "../components/Layout";
import { getMyAgents, MyAgent } from "../lib/api";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "/api/proxy";

export default function Messaging() {
  const [myAgentId, setMyAgentId] = useState("");
  const [myAgents, setMyAgents] = useState<MyAgent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);

  // Load the caller's own agents so they pick rather than retype an id.
  useEffect(() => {
    (async () => {
      try {
        const { agents } = await getMyAgents();
        setMyAgents(agents);
        // One agent is the common case; selecting it saves a pointless click.
        if (agents.length === 1) setMyAgentId(agents[0].agentId);
      } catch {
        setMyAgents([]);
      } finally {
        setLoadingAgents(false);
      }
    })();
  }, []);
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

  // registerAgent() lived here: it POSTed to /verify-identity with a fabricated
  // name, a hardcoded date of birth and a timestamp as the ID number, to
  // "register" an agent the user had already registered. Agents are now picked
  // from the ones they own, so nothing needs inventing.

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

  const sendMsg = async () => {
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

  const inputClass = "bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 flex-1";
  const btnClass = "bg-zinc-800 border border-zinc-700 text-white text-sm px-4 py-2 rounded-lg hover:bg-zinc-700 transition-colors";
  const btnSmClass = "bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs px-3 py-1.5 rounded-lg hover:bg-zinc-700 transition-colors";

  return (
    <Layout title="Messaging">
      {/* Agent Identity */}
      <section className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-6 mb-6">
        <h2 className="text-[17px] font-semibold text-white mb-4">Agent Messaging</h2>

        {/* Which of your agents you are acting as.
            This used to be a free-text box plus a Register button, which asked
            you to re-register an agent you had already registered and to
            remember its id exactly. Your agents are known, so they are offered. */}
        <div className="mb-3">
          <label className="block text-zinc-500 text-xs mb-1.5">Send as</label>
          {loadingAgents ? (
            <div className="text-zinc-600 text-sm py-2">Loading your agents…</div>
          ) : myAgents.length === 0 ? (
            <div className="text-sm text-zinc-500 py-2">
              You don&apos;t have any agents yet.{" "}
              <Link href="/agents/register" className="text-zinc-300 underline hover:text-white">
                Register one
              </Link>{" "}
              to start messaging.
            </div>
          ) : (
            <select
              value={myAgentId}
              onChange={(e) => setMyAgentId(e.target.value)}
              className={inputClass}
            >
              <option value="">Select an agent…</option>
              {myAgents.map((a) => (
                <option key={a.agentId} value={a.agentId}>
                  {a.name ? `${a.name} (${a.agentId})` : a.agentId}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex gap-3 mb-3">
          <input
            placeholder="Target Agent ID"
            value={targetAgentId}
            onChange={(e) => setTargetAgentId(e.target.value)}
            className={inputClass}
          />
          <button onClick={followAgent} className={btnClass}>Follow</button>
        </div>

        <div className="flex gap-3 mb-4">
          <input
            placeholder="Message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className={inputClass}
          />
          <button onClick={sendChatRequest} className={btnClass}>Send Request</button>
          <button onClick={sendMsg} className={btnClass}>Send Message</button>
        </div>

        <div className="flex gap-2">
          <button onClick={checkActivity} className={btnSmClass}>Check Activity</button>
          <button onClick={loadConversations} className={btnSmClass}>Load Conversations</button>
        </div>
      </section>

      {/* Pending Requests */}
      {pendingRequests.length > 0 && (
        <section className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-6 mb-6">
          <h3 className="text-[15px] font-semibold text-white mb-3">Pending Requests</h3>
          <div className="space-y-2">
            {pendingRequests.map((req) => (
              <div
                key={req.conversation_id}
                className="flex items-center justify-between py-2 border-b border-zinc-800/40 last:border-0"
              >
                <span className="text-sm text-zinc-400">
                  From: <span className="text-white font-mono">{req.from?.id}</span> — &ldquo;{req.message_preview}&rdquo;
                </span>
                <button onClick={() => approveRequest(req.conversation_id)} className={btnSmClass}>
                  Approve
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Conversations */}
      {conversations.length > 0 && (
        <section className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-6 mb-6">
          <h3 className="text-[15px] font-semibold text-white mb-3">Conversations</h3>
          <div className="space-y-1">
            {conversations.map((conv) => (
              <div
                key={conv.conversation_id}
                onClick={() => loadMessages(conv.conversation_id)}
                className={`px-3 py-2 rounded-lg cursor-pointer text-sm transition-colors ${
                  selectedConv === conv.conversation_id
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:bg-zinc-800/50 hover:text-white"
                }`}
              >
                With: <span className="font-mono">{conv.with_agent?.id}</span> | Unread: {conv.unread_count}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Messages */}
      {selectedConv && messages.length > 0 && (
        <section className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-6 mb-6">
          <h3 className="text-[15px] font-semibold text-white mb-3">Messages</h3>
          <div className="max-h-[200px] overflow-auto space-y-1">
            {messages.map((msg, i) => (
              <div key={i} className="py-1.5 border-b border-zinc-800/40 last:border-0 text-sm">
                <span className="text-white font-mono font-medium">{msg.sender_agent_id}:</span>{" "}
                <span className="text-zinc-400">{msg.content}</span>
                {msg.needs_human_input && (
                  <span className="text-amber-400 text-xs ml-2">[HUMAN INPUT NEEDED]</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Log */}
      <section className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl overflow-hidden">
        <div className="px-6 py-3 border-b border-zinc-800/60">
          <h3 className="text-[15px] font-semibold text-white">Log</h3>
        </div>
        <div className="bg-[#0a0a0a] px-6 py-4 font-mono text-xs text-zinc-500 max-h-[200px] overflow-auto">
          {output.length === 0 ? (
            <div className="text-zinc-700">No activity yet.</div>
          ) : (
            output.map((line, i) => (
              <div key={i} className="py-0.5">{line}</div>
            ))
          )}
        </div>
      </section>
    </Layout>
  );
}
