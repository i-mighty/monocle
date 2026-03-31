/**
 * useOrchestration.ts
 *
 * Frontend hook that:
 *   1. POSTs to /v1/orchestrate to start a session
 *   2. Opens SSE stream to /v1/orchestrate/:sessionId/stream
 *   3. Parses all agent events and builds a live conversation log
 *   4. Returns state for AgentConversationLog component
 *
 * Usage:
 *   const { startOrchestration, events, status, finalResponse } = useOrchestration();
 */

import { useState, useCallback, useRef } from "react";

const BASE_URL = process.env.NEXT_PUBLIC_MONOCLE_API_URL ?? "http://localhost:3001";
const API_KEY  = process.env.NEXT_PUBLIC_MONOCLE_API_KEY  ?? "";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentEventType =
  | "session_started"
  | "orchestrator_thinking"
  | "task_plan"
  | "quote_requested"
  | "quote_received"
  | "quote_accepted"
  | "quote_rejected"
  | "agent_executing"
  | "sub_delegation"
  | "result_delivered"
  | "assembling"
  | "session_complete"
  | "session_failed"
  | "waiting_for_dependency"
  | "subtask_failed";

export interface AgentEvent {
  id: string;
  type: AgentEventType;
  timestamp: string;
  depth?: number;

  // Agent identity
  fromAgent?: { id: string; name?: string };
  toAgent?: { id: string; name?: string };
  agentId?: string;
  agentName?: string;

  // Negotiation
  negotiationId?: string;
  quotedLamports?: string;
  agreedLamports?: string;
  ratePer1kTokens?: string;

  // Task
  taskType?: string;
  taskDescription?: string;
  subtasks?: SubtaskPlan[];

  // Results
  resultPreview?: string;
  costLamports?: string;
  tokensUsed?: number;
  txSignature?: string;
  finalResponse?: string;
  totalCostLamports?: string;
  agentCount?: number;
  durationMs?: number;

  // Meta
  message?: string;
  error?: string;
  sessionId?: string;
  userPrompt?: string;
}

export interface SubtaskPlan {
  id: string;
  type: string;
  description: string;
  assignedAgent: { agentId: string; name: string };
  estimatedTokens: number;
}

export type OrchestrationStatus =
  | "idle"
  | "starting"
  | "negotiating"
  | "executing"
  | "assembling"
  | "complete"
  | "failed";

// ─── Hook ────────────────────────────────────────────────────────────────────
export function useOrchestration() {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [status, setStatus] = useState<OrchestrationStatus>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [finalResponse, setFinalResponse] = useState<string | null>(null);
  const [totalCost, setTotalCost] = useState<string | null>(null);
  const [agentCount, setAgentCount] = useState<number>(0);
  const [durationMs, setDurationMs] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const eventCounter = useRef(0);

  const addEvent = useCallback((raw: Omit<AgentEvent, "id">) => {
    const event: AgentEvent = {
      ...raw,
      id: `evt_${++eventCounter.current}`,
      timestamp: raw.timestamp ?? new Date().toISOString(),
    };
    setEvents((prev) => [...prev, event]);
    return event;
  }, []);

  const connectStream = useCallback((sid: string) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const url = `${BASE_URL}/v1/orchestrate/${sid}/stream`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as AgentEvent;

        switch (data.type) {
          case "session_started":
            setStatus("negotiating");
            addEvent(data);
            break;

          case "orchestrator_thinking":
            addEvent(data);
            break;

          case "task_plan":
            setStatus("negotiating");
            addEvent(data);
            break;

          case "quote_requested":
          case "quote_received":
            addEvent(data);
            break;

          case "quote_accepted":
            setStatus("executing");
            addEvent(data);
            break;

          case "quote_rejected":
          case "subtask_failed":
            addEvent(data);
            break;

          case "agent_executing":
          case "sub_delegation":
            addEvent(data);
            break;

          case "result_delivered":
            addEvent(data);
            break;

          case "assembling":
            setStatus("assembling");
            addEvent(data);
            break;

          case "session_complete":
            setStatus("complete");
            setFinalResponse(data.finalResponse ?? null);
            setTotalCost(data.totalCostLamports ?? null);
            setAgentCount(data.agentCount ?? 0);
            setDurationMs(data.durationMs ?? 0);
            addEvent(data);
            es.close();
            break;

          case "session_failed":
            setStatus("failed");
            setError(data.error ?? "Unknown error");
            addEvent(data);
            es.close();
            break;

          default:
            // Ignore unknown events (heartbeats, historical, etc)
            break;
        }
      } catch {
        // Ignore parse errors (heartbeats etc)
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects on error
    };
  }, [addEvent]);

  const startOrchestration = useCallback(async (message: string) => {
    // Reset state
    setEvents([]);
    setStatus("starting");
    setFinalResponse(null);
    setTotalCost(null);
    setAgentCount(0);
    setDurationMs(0);
    setError(null);
    eventCounter.current = 0;

    try {
      const res = await fetch(`${BASE_URL}/v1/orchestrate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": API_KEY,
        },
        body: JSON.stringify({ message, stream: true }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }

      const data = await res.json();
      setSessionId(data.sessionId);
      connectStream(data.sessionId);
    } catch (err) {
      setStatus("failed");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [connectStream]);

  const reset = useCallback(() => {
    eventSourceRef.current?.close();
    setEvents([]);
    setStatus("idle");
    setSessionId(null);
    setFinalResponse(null);
    setTotalCost(null);
    setError(null);
    eventCounter.current = 0;
  }, []);

  return {
    startOrchestration,
    reset,
    events,
    status,
    sessionId,
    finalResponse,
    totalCost,
    agentCount,
    durationMs,
    error,
  };
}
