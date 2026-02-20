import Link from "next/link";
import { useEffect, useState, useRef } from "react";
import { getStoredApiKey } from "../lib/api";

// =============================================================================
// TYPES
// =============================================================================

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  taskType?: string;
  agent?: {
    name: string;
    model: string;
  };
  cost?: {
    totalLamports: number;
    breakdown: {
      agentCost: number;
      platformFee: number;
    };
  };
  usage?: {
    totalTokens: number;
  };
  latencyMs?: number;
  timestamp: Date;
}

interface SpecialistAgent {
  agentId: string;
  name: string;
  description: string;
  taskTypes: string[];
  provider: string;
  model: string;
  pricing: {
    ratePer1kTokens: number;
  };
  metrics: {
    qualityScore: number;
  };
}

// =============================================================================
// API FUNCTIONS
// =============================================================================

const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

async function sendMessage(
  message: string, 
  conversationId?: string,
  apiKey?: string
): Promise<any> {
  const res = await fetch(`${BASE_URL}/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "X-API-Key": apiKey } : {})
    },
    body: JSON.stringify({ message, conversationId })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

async function previewMessage(message: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/v1/chat/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message })
  });
  return res.json();
}

async function getAgents(): Promise<{ agents: SpecialistAgent[] }> {
  const res = await fetch(`${BASE_URL}/v1/chat/agents`);
  return res.json();
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function ChatPage() {
  // State
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [agents, setAgents] = useState<SpecialistAgent[]>([]);
  const [showAgents, setShowAgents] = useState(false);
  const [totalCost, setTotalCost] = useState(0);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // =============================================================================
  // EFFECTS
  // =============================================================================

  useEffect(() => {
    const key = getStoredApiKey();
    if (key) setApiKey(key);
    loadAgents();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Preview on input change (debounced)
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (input.trim().length > 10) {
        previewMessage(input).then(setPreview).catch(() => {});
      } else {
        setPreview(null);
      }
    }, 500);
    return () => clearTimeout(timeout);
  }, [input]);

  // =============================================================================
  // HANDLERS
  // =============================================================================

  const loadAgents = async () => {
    try {
      const data = await getAgents();
      setAgents(data.agents || []);
    } catch (err) {
      console.error("Failed to load agents:", err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: input.trim(),
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setLoading(true);
    setPreview(null);

    try {
      const response = await sendMessage(
        userMessage.content,
        conversationId || undefined,
        apiKey || undefined
      );

      if (response.conversationId) {
        setConversationId(response.conversationId);
      }

      const assistantMessage: Message = {
        id: response.messageId || `msg-${Date.now()}-resp`,
        role: "assistant",
        content: response.response,
        taskType: response.taskType,
        agent: response.agentUsed,
        cost: response.cost,
        usage: response.usage,
        latencyMs: response.latencyMs,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMessage]);
      setTotalCost(prev => prev + (response.cost?.totalLamports || 0));

    } catch (err: any) {
      const errorMessage: Message = {
        id: `msg-${Date.now()}-err`,
        role: "assistant",
        content: `Error: ${err.message}`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    }

    setLoading(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const startNewChat = () => {
    setMessages([]);
    setConversationId(null);
    setTotalCost(0);
    setInput("");
    inputRef.current?.focus();
  };

  const formatCost = (lamports: number) => {
    if (lamports >= 1e9) return `${(lamports / 1e9).toFixed(6)} SOL`;
    return `${lamports.toLocaleString()} lamports`;
  };

  // =============================================================================
  // RENDER
  // =============================================================================

  return (
    <main className="page">
      <style jsx global>{styles}</style>

      {/* Navigation */}
      <nav className="nav">
        <div className="brand">
          <span className="logo">Monocle</span>
          <span className="tagline">AI Router</span>
        </div>
        <div className="links">
          <Link href="/">Marketplace</Link>
          <Link href="/economy">Economy</Link>
          <Link href="/chat" className="active">Chat</Link>
        </div>
      </nav>

      <div className="chat-container">
        {/* Sidebar */}
        <aside className="sidebar">
          <button className="new-chat-btn" onClick={startNewChat}>
            + New Chat
          </button>

          <div className="sidebar-section">
            <h3>Session Stats</h3>
            <div className="stat-item">
              <span>Messages</span>
              <span>{messages.length}</span>
            </div>
            <div className="stat-item">
              <span>Total Cost</span>
              <span>{formatCost(totalCost)}</span>
            </div>
          </div>

          <div className="sidebar-section">
            <h3 onClick={() => setShowAgents(!showAgents)} className="toggle-header">
              Specialist Agents {showAgents ? "−" : "+"}
            </h3>
            {showAgents && (
              <div className="agents-list">
                {agents.map(agent => (
                  <div key={agent.agentId} className="agent-item">
                    <div className="agent-name">{agent.name}</div>
                    <div className="agent-model">{agent.model}</div>
                    <div className="agent-tasks">
                      {agent.taskTypes.join(", ")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {!apiKey && (
            <div className="sidebar-section api-key-section">
              <h3>API Key</h3>
              <input
                type="password"
                placeholder="Enter API key"
                onChange={(e) => {
                  setApiKey(e.target.value);
                  localStorage.setItem("apiKey", e.target.value);
                }}
              />
              <p className="hint">Optional: enables conversation history</p>
            </div>
          )}
        </aside>

        {/* Main Chat Area */}
        <div className="chat-main">
          {/* Messages */}
          <div className="messages">
            {messages.length === 0 && (
              <div className="welcome">
                <h1>Welcome to Monocle AI</h1>
                <p>Ask anything. The best AI agent will be automatically selected.</p>
                <div className="features">
                  <div className="feature">
                    <div className="feature-icon">R</div>
                    <div className="feature-text">
                      <strong>Research</strong>
                      <span>Find facts and information</span>
                    </div>
                  </div>
                  <div className="feature">
                    <div className="feature-icon">C</div>
                    <div className="feature-text">
                      <strong>Code</strong>
                      <span>Write and debug code</span>
                    </div>
                  </div>
                  <div className="feature">
                    <div className="feature-icon">W</div>
                    <div className="feature-text">
                      <strong>Writing</strong>
                      <span>Create content and documents</span>
                    </div>
                  </div>
                  <div className="feature">
                    <div className="feature-icon">A</div>
                    <div className="feature-text">
                      <strong>Analysis</strong>
                      <span>Think through problems</span>
                    </div>
                  </div>
                </div>
                <p className="pay-info">Pay only for what you use. No subscriptions.</p>
              </div>
            )}

            {messages.map((msg) => (
              <div key={msg.id} className={`message ${msg.role}`}>
                <div className="message-header">
                  {msg.role === "user" ? (
                    <span className="sender">You</span>
                  ) : (
                    <span className="sender">
                      {msg.agent ? `${msg.agent.name}` : "Assistant"}
                      {msg.taskType && <span className="task-badge">{msg.taskType}</span>}
                    </span>
                  )}
                </div>
                <div className="message-content">
                  {msg.content.split("```").map((part, i) => {
                    if (i % 2 === 1) {
                      // Code block
                      const [lang, ...code] = part.split("\n");
                      return (
                        <pre key={i} className="code-block">
                          <code>{code.join("\n")}</code>
                        </pre>
                      );
                    }
                    return <span key={i}>{part}</span>;
                  })}
                </div>
                {msg.role === "assistant" && msg.cost && (
                  <div className="message-meta">
                    <span className="meta-item">
                      {msg.usage?.totalTokens} tokens
                    </span>
                    <span className="meta-item cost">
                      {formatCost(msg.cost.totalLamports)}
                    </span>
                    <span className="meta-item">
                      {msg.latencyMs}ms
                    </span>
                    {msg.agent && (
                      <span className="meta-item model">
                        {msg.agent.model}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="message assistant loading">
                <div className="typing-indicator">
                  <span></span><span></span><span></span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="input-area">
            {preview && preview.preview && (
              <div className="preview-bar">
                <span className="preview-task">
                  Will use: <strong>{preview.preview.selectedAgent.name}</strong>
                </span>
                <span className="preview-cost">
                  Est. cost: ~{formatCost(preview.preview.estimatedCost.totalLamports)}
                </span>
              </div>
            )}
            <form onSubmit={handleSubmit} className="input-form">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything..."
                rows={1}
                disabled={loading}
              />
              <button type="submit" disabled={loading || !input.trim()}>
                {loading ? "..." : "Send"}
              </button>
            </form>
            <p className="input-hint">
              Press Enter to send. Shift+Enter for new line.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { 
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0f172a;
    min-height: 100vh;
    color: #e2e8f0;
  }
  
  .page { 
    height: 100vh;
    display: flex;
    flex-direction: column;
  }

  /* Navigation */
  .nav {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 24px;
    background: rgba(30, 27, 75, 0.8);
    border-bottom: 1px solid rgba(139, 92, 246, 0.2);
  }
  .brand {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }
  .logo {
    font-size: 24px;
    font-weight: 700;
    background: linear-gradient(135deg, #8b5cf6, #06b6d4);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .tagline {
    font-size: 14px;
    color: #64748b;
  }
  .links { display: flex; gap: 8px; }
  .links a {
    color: #a5b4fc;
    text-decoration: none;
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 14px;
    transition: all 0.2s;
  }
  .links a:hover, .links a.active {
    background: rgba(139, 92, 246, 0.2);
    color: #c4b5fd;
  }

  /* Chat Container */
  .chat-container {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  /* Sidebar */
  .sidebar {
    width: 260px;
    background: rgba(15, 23, 42, 0.8);
    border-right: 1px solid rgba(139, 92, 246, 0.1);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 24px;
    overflow-y: auto;
  }
  .new-chat-btn {
    width: 100%;
    padding: 12px;
    background: linear-gradient(135deg, #8b5cf6, #7c3aed);
    color: white;
    border: none;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }
  .new-chat-btn:hover {
    filter: brightness(1.1);
  }
  .sidebar-section h3 {
    font-size: 12px;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 12px;
  }
  .toggle-header {
    cursor: pointer;
  }
  .stat-item {
    display: flex;
    justify-content: space-between;
    padding: 8px 0;
    font-size: 14px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }
  .stat-item span:last-child {
    color: #8b5cf6;
    font-weight: 500;
  }
  .agents-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .agent-item {
    padding: 8px;
    background: rgba(139, 92, 246, 0.1);
    border-radius: 6px;
    font-size: 12px;
  }
  .agent-name {
    font-weight: 600;
    color: #c4b5fd;
  }
  .agent-model {
    color: #64748b;
    margin-top: 2px;
  }
  .agent-tasks {
    color: #475569;
    margin-top: 4px;
    font-size: 11px;
  }
  .api-key-section input {
    width: 100%;
    padding: 8px;
    background: rgba(0,0,0,0.3);
    border: 1px solid rgba(139, 92, 246, 0.3);
    border-radius: 6px;
    color: white;
    font-size: 13px;
  }
  .hint {
    font-size: 11px;
    color: #475569;
    margin-top: 6px;
  }

  /* Main Chat */
  .chat-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Messages */
  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /* Welcome Screen */
  .welcome {
    text-align: center;
    padding: 60px 20px;
    max-width: 600px;
    margin: auto;
  }
  .welcome h1 {
    font-size: 36px;
    margin-bottom: 12px;
    background: linear-gradient(135deg, #8b5cf6, #06b6d4);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .welcome > p {
    color: #94a3b8;
    margin-bottom: 40px;
  }
  .features {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 16px;
    margin-bottom: 40px;
  }
  .feature {
    display: flex;
    gap: 12px;
    padding: 16px;
    background: rgba(139, 92, 246, 0.1);
    border-radius: 12px;
    text-align: left;
  }
  .feature-icon {
    width: 40px;
    height: 40px;
    background: linear-gradient(135deg, #8b5cf6, #7c3aed);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    flex-shrink: 0;
  }
  .feature-text {
    display: flex;
    flex-direction: column;
  }
  .feature-text strong {
    color: #c4b5fd;
  }
  .feature-text span {
    font-size: 13px;
    color: #64748b;
  }
  .pay-info {
    color: #8b5cf6;
    font-weight: 500;
  }

  /* Message Bubbles */
  .message {
    max-width: 80%;
    padding: 16px;
    border-radius: 16px;
  }
  .message.user {
    align-self: flex-end;
    background: linear-gradient(135deg, #8b5cf6, #7c3aed);
    border-bottom-right-radius: 4px;
  }
  .message.assistant {
    align-self: flex-start;
    background: rgba(30, 27, 75, 0.8);
    border: 1px solid rgba(139, 92, 246, 0.2);
    border-bottom-left-radius: 4px;
  }
  .message-header {
    margin-bottom: 8px;
    font-size: 13px;
  }
  .sender {
    font-weight: 600;
    color: rgba(255,255,255,0.9);
  }
  .task-badge {
    margin-left: 8px;
    padding: 2px 8px;
    background: rgba(6, 182, 212, 0.3);
    border-radius: 10px;
    font-size: 11px;
    color: #06b6d4;
  }
  .message-content {
    line-height: 1.6;
    white-space: pre-wrap;
  }
  .code-block {
    background: rgba(0,0,0,0.4);
    padding: 12px;
    border-radius: 8px;
    margin: 12px 0;
    overflow-x: auto;
    font-family: 'Fira Code', monospace;
    font-size: 13px;
  }
  .message-meta {
    display: flex;
    gap: 12px;
    margin-top: 12px;
    padding-top: 8px;
    border-top: 1px solid rgba(255,255,255,0.1);
    font-size: 11px;
    color: #64748b;
  }
  .meta-item.cost {
    color: #8b5cf6;
    font-weight: 500;
  }
  .meta-item.model {
    color: #06b6d4;
  }

  /* Loading */
  .message.loading {
    background: transparent;
    border: none;
    padding: 16px 0;
  }
  .typing-indicator {
    display: flex;
    gap: 4px;
  }
  .typing-indicator span {
    width: 8px;
    height: 8px;
    background: #8b5cf6;
    border-radius: 50%;
    animation: bounce 1.4s infinite ease-in-out;
  }
  .typing-indicator span:nth-child(1) { animation-delay: 0s; }
  .typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
  .typing-indicator span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes bounce {
    0%, 80%, 100% { transform: translateY(0); }
    40% { transform: translateY(-8px); }
  }

  /* Input Area */
  .input-area {
    padding: 16px 24px 24px;
    background: rgba(15, 23, 42, 0.8);
    border-top: 1px solid rgba(139, 92, 246, 0.1);
  }
  .preview-bar {
    display: flex;
    justify-content: space-between;
    padding: 8px 12px;
    background: rgba(139, 92, 246, 0.1);
    border-radius: 8px;
    margin-bottom: 12px;
    font-size: 13px;
    color: #94a3b8;
  }
  .preview-task strong {
    color: #8b5cf6;
  }
  .preview-cost {
    color: #06b6d4;
  }
  .input-form {
    display: flex;
    gap: 12px;
  }
  .input-form textarea {
    flex: 1;
    padding: 14px 16px;
    background: rgba(30, 27, 75, 0.6);
    border: 1px solid rgba(139, 92, 246, 0.3);
    border-radius: 12px;
    color: white;
    font-size: 15px;
    resize: none;
    min-height: 52px;
    max-height: 200px;
    overflow-y: auto;
  }
  .input-form textarea::placeholder {
    color: #64748b;
  }
  .input-form textarea:focus {
    outline: none;
    border-color: #8b5cf6;
  }
  .input-form button {
    padding: 14px 28px;
    background: linear-gradient(135deg, #8b5cf6, #7c3aed);
    color: white;
    border: none;
    border-radius: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }
  .input-form button:hover:not(:disabled) {
    filter: brightness(1.1);
  }
  .input-form button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .input-hint {
    font-size: 12px;
    color: #475569;
    margin-top: 8px;
    text-align: center;
  }

  /* Responsive */
  @media (max-width: 768px) {
    .sidebar {
      display: none;
    }
    .features {
      grid-template-columns: 1fr;
    }
  }
`;
