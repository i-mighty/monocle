"use client";

/**
 * AgentConversationLog.tsx
 *
 * The hackathon demo component. Shows live agent-to-agent negotiations,
 * payments, and task execution as an animated conversation feed.
 */

import { useState, useRef, useEffect } from "react";
import { useOrchestration, AgentEvent, OrchestrationStatus } from "../../hooks/useOrchestration";

// ─── Agent config ─────────────────────────────────────────────────────────────
const AGENT_CONFIG: Record<string, { emoji: string; color: string; bg: string; border: string }> = {
  "orchestrator-001": { emoji: "⬡", color: "#b4a9ff", bg: "rgba(139,124,248,0.12)", border: "rgba(139,124,248,0.25)" },
  "researcher-001":   { emoji: "⬡", color: "#60a5fa", bg: "rgba(96,165,250,0.12)",  border: "rgba(96,165,250,0.25)" },
  "writer-001":       { emoji: "⬡", color: "#f9a8d4", bg: "rgba(249,168,212,0.12)", border: "rgba(249,168,212,0.25)" },
  "coder-001":        { emoji: "⬡", color: "#4ade80", bg: "rgba(74,222,128,0.12)",  border: "rgba(74,222,128,0.25)" },
  "factcheck-001":    { emoji: "⬡", color: "#fbbf24", bg: "rgba(251,191,36,0.12)",  border: "rgba(251,191,36,0.25)" },
  "formatter-001":    { emoji: "⬡", color: "#f87171", bg: "rgba(248,113,113,0.12)", border: "rgba(248,113,113,0.25)" },
  "default":          { emoji: "⬡", color: "#94a3b8", bg: "rgba(148,163,184,0.1)",  border: "rgba(148,163,184,0.2)" },
};

const AGENT_NAMES: Record<string, string> = {
  "orchestrator-001": "Orchestrator",
  "researcher-001":   "Research Agent",
  "writer-001":       "Writer Agent",
  "coder-001":        "Code Agent",
  "factcheck-001":    "FactCheck Agent",
  "formatter-001":    "Formatter Agent",
};

function getAgent(id?: string) {
  if (!id) return AGENT_CONFIG.default;
  return AGENT_CONFIG[id] ?? AGENT_CONFIG.default;
}

function getAgentName(id?: string, fallback?: string) {
  if (!id) return fallback ?? "Agent";
  return AGENT_NAMES[id] ?? fallback ?? id;
}

function lamportsToSol(lam?: string | null): string {
  if (!lam) return "0";
  const n = Number(lam) / 1_000_000_000;
  return n < 0.001 ? `${lam} lam` : `◎${n.toFixed(6)}`;
}

function depthIndent(depth: number) {
  return depth > 0 ? `${depth * 20}px` : "0px";
}

// ─── Status bar ───────────────────────────────────────────────────────────────
function StatusBar({ status, agentCount, totalCost, durationMs }: {
  status: OrchestrationStatus;
  agentCount: number;
  totalCost: string | null;
  durationMs: number;
}) {
  const statusConfig: Record<OrchestrationStatus, { label: string; color: string; pulse: boolean }> = {
    idle:        { label: "Ready",        color: "#94a3b8", pulse: false },
    starting:    { label: "Starting...",  color: "#b4a9ff", pulse: true },
    negotiating: { label: "Negotiating",  color: "#fbbf24", pulse: true },
    executing:   { label: "Executing",    color: "#60a5fa", pulse: true },
    assembling:  { label: "Assembling",   color: "#f9a8d4", pulse: true },
    complete:    { label: "Complete",     color: "#4ade80", pulse: false },
    failed:      { label: "Failed",       color: "#f87171", pulse: false },
  };
  const cfg = statusConfig[status];

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "12px",
      padding: "8px 14px",
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: "8px", marginBottom: "12px",
      fontSize: "11.5px", fontFamily: "'JetBrains Mono', monospace",
    }}>
      <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <span style={{
          width: "7px", height: "7px", borderRadius: "50%",
          background: cfg.color,
          boxShadow: cfg.pulse ? `0 0 8px ${cfg.color}` : "none",
          animation: cfg.pulse ? "orchPulse 1.5s infinite" : "none",
        }} />
        <span style={{ color: cfg.color, fontWeight: 500 }}>{cfg.label}</span>
      </span>
      {agentCount > 0 && (
        <span style={{ color: "rgba(241,241,245,0.4)" }}>
          {agentCount} agent{agentCount !== 1 ? "s" : ""}
        </span>
      )}
      {totalCost && (
        <span style={{ color: "rgba(62,207,142,0.8)" }}>
          {lamportsToSol(totalCost)} total
        </span>
      )}
      {durationMs > 0 && (
        <span style={{ color: "rgba(241,241,245,0.3)", marginLeft: "auto" }}>
          {(durationMs / 1000).toFixed(1)}s
        </span>
      )}
      <style>{`
        @keyframes orchPulse {
          0%,100% { opacity:1; transform:scale(1); }
          50% { opacity:0.5; transform:scale(0.85); }
        }
      `}</style>
    </div>
  );
}

// ─── Individual event card ─────────────────────────────────────────────────────
function EventCard({ event }: { event: AgentEvent }) {
  const [expanded, setExpanded] = useState(false);

  const fromCfg = getAgent(event.fromAgent?.id ?? event.agentId);
  const toCfg   = getAgent(event.toAgent?.id);

  const renderContent = () => {
    switch (event.type) {
      case "session_started":
        return (
          <div style={{ color: "rgba(241,241,245,0.6)", fontSize: "12px" }}>
            <span style={{ color: "#b4a9ff" }}>Orchestrator</span> received task:
            <span style={{ color: "rgba(241,241,245,0.85)", marginLeft: "6px", fontStyle: "italic" }}>
              &quot;{event.userPrompt?.slice(0, 80)}{(event.userPrompt?.length ?? 0) > 80 ? "..." : ""}&quot;
            </span>
          </div>
        );

      case "task_plan":
        return (
          <div>
            <div style={{ color: "rgba(241,241,245,0.5)", fontSize: "11px", marginBottom: "8px" }}>
              Decomposed into {event.subtasks?.length} subtasks:
            </div>
            {event.subtasks?.map((t) => {
              const ac = getAgent(t.assignedAgent?.agentId);
              return (
                <div key={t.id} style={{
                  display: "flex", alignItems: "center", gap: "8px",
                  padding: "5px 8px", marginBottom: "4px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: "6px", fontSize: "11.5px",
                }}>
                  <span style={{ color: ac.color, fontFamily: "'JetBrains Mono',monospace", fontSize: "10px" }}>
                    {t.type}
                  </span>
                  <span style={{ color: "rgba(241,241,245,0.6)", flex: 1 }}>
                    {t.description.slice(0, 70)}
                  </span>
                  <span style={{ color: ac.color, fontSize: "10.5px" }}>
                    → {t.assignedAgent?.name ?? t.assignedAgent?.agentId}
                  </span>
                </div>
              );
            })}
          </div>
        );

      case "quote_requested":
        return (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px" }}>
            <AgentChip cfg={fromCfg} name={getAgentName(event.fromAgent?.id)} />
            <span style={{ color: "rgba(241,241,245,0.3)" }}>→</span>
            <AgentChip cfg={toCfg} name={getAgentName(event.toAgent?.id)} />
            <span style={{ color: "rgba(241,241,245,0.4)", marginLeft: "4px" }}>
              requesting quote for
            </span>
            <span style={{
              color: "#fbbf24", fontFamily: "'JetBrains Mono',monospace", fontSize: "11px",
              padding: "1px 6px", background: "rgba(251,191,36,0.08)",
              border: "1px solid rgba(251,191,36,0.15)", borderRadius: "4px",
            }}>{event.taskType}</span>
          </div>
        );

      case "quote_received":
        return (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px" }}>
            <AgentChip cfg={fromCfg} name={getAgentName(event.fromAgent?.id)} />
            <span style={{ color: "rgba(241,241,245,0.3)" }}>quoted</span>
            <span style={{
              color: "#fbbf24", fontFamily: "'JetBrains Mono',monospace", fontWeight: 600,
            }}>{event.quotedLamports} lam</span>
            <span style={{ color: "rgba(241,241,245,0.3)" }}>
              ({event.ratePer1kTokens} lam/1k tokens)
            </span>
          </div>
        );

      case "quote_accepted":
        return (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px" }}>
            <span style={{ color: "#4ade80", fontSize: "13px" }}>✓</span>
            <AgentChip cfg={fromCfg} name={getAgentName(event.fromAgent?.id)} />
            <span style={{ color: "rgba(241,241,245,0.4)" }}>accepted</span>
            <span style={{
              color: "#4ade80", fontFamily: "'JetBrains Mono',monospace", fontWeight: 600,
            }}>{event.agreedLamports} lam</span>
            <span style={{ color: "rgba(241,241,245,0.3)" }}>— payment escrowed</span>
          </div>
        );

      case "quote_rejected":
        return (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "#f87171" }}>
            <span>✗ Quote rejected:</span>
            <span style={{ color: "rgba(241,241,245,0.5)" }}>{event.error}</span>
          </div>
        );

      case "agent_executing":
        return (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px" }}>
            <AgentChip cfg={fromCfg} name={getAgentName(event.agentId, event.agentName)} />
            <ExecutingDots />
            <span style={{ color: "rgba(241,241,245,0.4)" }}>
              {event.taskDescription?.slice(0, 60)}
            </span>
          </div>
        );

      case "sub_delegation":
        return (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px" }}>
            <AgentChip cfg={fromCfg} name={getAgentName(event.fromAgent?.id)} />
            <span style={{ color: "#fbbf24", fontSize: "10px" }}>↪ sub-delegates to</span>
            <AgentChip cfg={toCfg} name={getAgentName(event.toAgent?.id)} />
            <span style={{ color: "rgba(241,241,245,0.35)", fontSize: "11px" }}>
              (depth {event.depth})
            </span>
          </div>
        );

      case "result_delivered":
        return (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", marginBottom: "6px" }}>
              <AgentChip cfg={fromCfg} name={getAgentName(event.fromAgent?.id)} />
              <span style={{ color: "rgba(241,241,245,0.4)" }}>delivered result</span>
              <span style={{ color: "#4ade80", fontFamily: "'JetBrains Mono',monospace", fontSize: "11px" }}>
                {event.costLamports} lam · {event.tokensUsed} tokens
              </span>
              {event.txSignature && (
                <a
                  href={`https://explorer.solana.com/tx/${event.txSignature}?cluster=devnet`}
                  target="_blank" rel="noopener noreferrer"
                  style={{
                    marginLeft: "auto", fontSize: "10.5px",
                    color: "rgba(62,207,142,0.7)", fontFamily: "'JetBrains Mono',monospace",
                    textDecoration: "none", padding: "1px 6px",
                    background: "rgba(62,207,142,0.08)",
                    border: "1px solid rgba(62,207,142,0.15)",
                    borderRadius: "4px",
                  }}
                >
                  {event.txSignature.slice(0,6)}...{event.txSignature.slice(-4)} ↗
                </a>
              )}
            </div>
            {event.resultPreview && (
              <div style={{
                padding: "8px 10px",
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: "6px", fontSize: "12px",
                color: "rgba(241,241,245,0.6)", fontStyle: "italic",
                cursor: expanded ? "default" : "pointer",
              }} onClick={() => setExpanded(!expanded)}>
                {expanded ? event.resultPreview : event.resultPreview.slice(0, 100) + "..."}
                {!expanded && (
                  <span style={{ color: "#b4a9ff", marginLeft: "6px", fontSize: "11px" }}>
                    expand ↓
                  </span>
                )}
              </div>
            )}
          </div>
        );

      case "assembling":
        return (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px" }}>
            <AgentChip cfg={getAgent("orchestrator-001")} name="Orchestrator" />
            <ExecutingDots />
            <span style={{ color: "rgba(241,241,245,0.4)" }}>assembling final response...</span>
          </div>
        );

      case "session_complete":
        return (
          <div>
            <div style={{
              display: "flex", alignItems: "center", gap: "10px",
              padding: "10px 12px",
              background: "rgba(74,222,128,0.06)",
              border: "1px solid rgba(74,222,128,0.15)",
              borderRadius: "8px", fontSize: "12px",
            }}>
              <span style={{ color: "#4ade80", fontSize: "15px" }}>✓</span>
              <span style={{ color: "#4ade80", fontWeight: 500 }}>Orchestration complete</span>
              <span style={{ color: "rgba(241,241,245,0.4)" }}>·</span>
              <span style={{ color: "rgba(62,207,142,0.8)", fontFamily: "'JetBrains Mono',monospace" }}>
                {event.agentCount} agents · {lamportsToSol(event.totalCostLamports ?? null)} · {((event.durationMs ?? 0)/1000).toFixed(1)}s
              </span>
            </div>
          </div>
        );

      case "session_failed":
        return (
          <div style={{
            padding: "8px 12px",
            background: "rgba(248,113,113,0.06)",
            border: "1px solid rgba(248,113,113,0.2)",
            borderRadius: "7px", fontSize: "12px", color: "#f87171",
          }}>
            ✗ {event.error}
          </div>
        );

      default:
        return (
          <div style={{ fontSize: "11.5px", color: "rgba(241,241,245,0.35)" }}>
            {event.message ?? event.type}
          </div>
        );
    }
  };

  const depthBorderColor = [
    "rgba(139,124,248,0.15)",
    "rgba(96,165,250,0.15)",
    "rgba(251,191,36,0.15)",
  ][Math.min(event.depth ?? 0, 2)];

  return (
    <div style={{
      marginLeft: depthIndent(event.depth ?? 0),
      marginBottom: "6px",
      padding: "9px 12px",
      background: "rgba(255,255,255,0.02)",
      border: `1px solid ${depthBorderColor}`,
      borderLeft: `2px solid ${depthBorderColor}`,
      borderRadius: "0 8px 8px 0",
      animation: "eventIn 0.2s cubic-bezier(.4,0,.2,1) both",
    }}>
      {renderContent()}
      <style>{`
        @keyframes eventIn {
          from { opacity:0; transform:translateX(-6px); }
          to { opacity:1; transform:translateX(0); }
        }
      `}</style>
    </div>
  );
}

// ─── Helper components ────────────────────────────────────────────────────────
function AgentChip({ cfg, name }: { cfg: ReturnType<typeof getAgent>; name: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "4px",
      padding: "2px 7px",
      background: cfg.bg, border: `1px solid ${cfg.border}`,
      borderRadius: "4px", fontSize: "11px",
      color: cfg.color, fontWeight: 500,
      fontFamily: "'JetBrains Mono', monospace",
    }}>
      {name}
    </span>
  );
}

function ExecutingDots() {
  return (
    <span style={{ display: "inline-flex", gap: "3px", alignItems: "center" }}>
      {[0,1,2].map(i => (
        <span key={i} style={{
          width: "4px", height: "4px", borderRadius: "50%",
          background: "rgba(241,241,245,0.3)",
          animation: `execDot 1.2s infinite ${i*0.15}s`,
          display: "inline-block",
        }} />
      ))}
      <style>{`
        @keyframes execDot {
          0%,80%,100%{opacity:0.2;transform:scale(0.7)}
          40%{opacity:1;transform:scale(1)}
        }
      `}</style>
    </span>
  );
}

// ─── Main exported component ──────────────────────────────────────────────────
export default function AgentConversationLog() {
  const [input, setInput] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  const {
    startOrchestration, reset,
    events, status, finalResponse,
    totalCost, agentCount, durationMs,
  } = useOrchestration();

  // Auto-scroll to bottom
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [events]);

  const handleSubmit = () => {
    if (!input.trim() || status !== "idle") return;
    startOrchestration(input.trim());
    setInput("");
  };

  const isIdle = status === "idle";
  const isDone = status === "complete" || status === "failed";

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: "transparent", fontFamily: "'Inter', sans-serif",
    }}>
      {/* Header */}
      <div style={{
        padding: "14px 18px 12px",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        display: "flex", alignItems: "center", gap: "12px",
      }}>
        <div style={{
          width: "32px", height: "32px", borderRadius: "8px",
          background: "linear-gradient(135deg, #8b7cf8, #b4a9ff)",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 0 16px rgba(139,124,248,0.4)",
          fontSize: "14px", color: "white", fontWeight: 600,
        }}>M</div>
        <div>
          <div style={{ fontSize: "14px", fontWeight: 500, color: "rgba(241,241,245,0.9)" }}>
            Agent Network
          </div>
          <div style={{ fontSize: "11px", color: "rgba(241,241,245,0.35)", fontFamily: "'JetBrains Mono',monospace" }}>
            Multi-agent orchestration · x402 payments · Solana devnet
          </div>
        </div>
        {isDone && (
          <button onClick={reset} style={{
            marginLeft: "auto", padding: "5px 12px",
            background: "rgba(139,124,248,0.1)",
            border: "1px solid rgba(139,124,248,0.2)",
            borderRadius: "6px", color: "#b4a9ff",
            fontSize: "12px", cursor: "pointer", fontFamily: "'Inter',sans-serif",
          }}>
            New session
          </button>
        )}
      </div>

      {/* Status bar */}
      {!isIdle && (
        <div style={{ padding: "10px 16px 0" }}>
          <StatusBar status={status} agentCount={agentCount} totalCost={totalCost} durationMs={durationMs} />
        </div>
      )}

      {/* Event log */}
      <div
        ref={logRef}
        style={{
          flex: 1, overflowY: "auto", padding: "12px 16px",
          display: "flex", flexDirection: "column", gap: "2px",
        }}
      >
        {isIdle && events.length === 0 && (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", height: "100%", gap: "14px",
            color: "rgba(241,241,245,0.2)",
          }}>
            <div style={{ fontSize: "36px", opacity: 0.4 }}>⬡</div>
            <div style={{ fontSize: "13px", textAlign: "center", maxWidth: "300px" }}>
              Send a complex task to see agents negotiate, pay each other, and collaborate in real time
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", width: "100%", maxWidth: "340px" }}>
              {[
                "Research the latest AI models and write a comparison",
                "Implement a binary search tree in TypeScript with tests",
                "Explain transformer attention mechanisms with examples",
              ].map((s) => (
                <button key={s} onClick={() => setInput(s)} style={{
                  padding: "8px 12px", background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.07)",
                  borderRadius: "7px", color: "rgba(241,241,245,0.5)",
                  fontSize: "12px", cursor: "pointer", textAlign: "left",
                  fontFamily: "'Inter',sans-serif", transition: "all 0.15s",
                }}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(139,124,248,0.08)"; e.currentTarget.style.color = "rgba(180,169,255,0.8)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.color = "rgba(241,241,245,0.5)"; }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {events.map((event) => (
          <EventCard key={event.id} event={event} />
        ))}

        {/* Final response */}
        {finalResponse && (
          <div style={{
            marginTop: "12px", padding: "14px 16px",
            background: "rgba(74,222,128,0.04)",
            border: "1px solid rgba(74,222,128,0.12)",
            borderRadius: "10px",
          }}>
            <div style={{
              fontSize: "10.5px", color: "rgba(74,222,128,0.6)",
              fontFamily: "'JetBrains Mono',monospace",
              marginBottom: "10px", letterSpacing: "0.06em",
            }}>
              FINAL RESPONSE · ASSEMBLED FROM {agentCount} AGENTS
            </div>
            <div style={{
              fontSize: "13.5px", lineHeight: 1.75,
              color: "rgba(241,241,245,0.88)",
              whiteSpace: "pre-wrap",
            }}>
              {finalResponse}
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{
        padding: "12px 16px 16px",
        borderTop: "1px solid rgba(255,255,255,0.07)",
        background: "rgba(7,7,15,0.6)",
        backdropFilter: "blur(20px)",
      }}>
        <div style={{
          display: "flex", gap: "8px", alignItems: "flex-end",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.09)",
          borderRadius: "11px", padding: "10px 12px",
          transition: "border-color 0.15s",
        }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={!isIdle}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
            }}
            placeholder={isIdle ? "Give agents a complex task..." : "Orchestration in progress..."}
            rows={2}
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              color: "rgba(241,241,245,0.9)", fontSize: "13.5px",
              fontFamily: "'Inter',sans-serif", resize: "none", lineHeight: 1.6,
              opacity: isIdle ? 1 : 0.5,
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={!isIdle || !input.trim()}
            style={{
              height: "32px", padding: "0 16px",
              background: "linear-gradient(135deg, #8b7cf8, #a599ff)",
              border: "none", borderRadius: "7px",
              color: "white", fontSize: "12.5px", fontWeight: 500,
              fontFamily: "'Inter',sans-serif", cursor: isIdle && input.trim() ? "pointer" : "not-allowed",
              opacity: isIdle && input.trim() ? 1 : 0.4,
              transition: "all 0.15s",
              boxShadow: isIdle && input.trim() ? "0 0 16px rgba(139,124,248,0.3)" : "none",
              flexShrink: 0,
            }}
          >
            Run
          </button>
        </div>
      </div>
    </div>
  );
}
