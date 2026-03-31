import { useState, useCallback, useRef } from 'react';
import type { Message, StreamChunk, RoutingDecision, AgentProvider, OrchestrationTask } from '../types/chat';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';

interface UseStreamChatOptions {
  apiKey: string;
  conversationId?: string;
  skipUserMessage?: boolean;
  onRoutingDecision?: (routing: RoutingDecision) => void;
  onAgentActivated?: (provider: string) => void;
}

interface UseStreamChatReturn {
  sendMessage: (content: string) => Promise<void>;
  isStreaming: boolean;
  isRouting: boolean;
  abort: () => void;
}

/**
 * Map a model name or agent ID to a provider.
 */
function inferProvider(model: string): AgentProvider {
  const m = model.toLowerCase();
  if (m.includes('gpt') || m.includes('openai') || m.includes('o1') || m.includes('o3') || m.includes('o4')) return 'openai';
  if (m.includes('claude') || m.includes('anthropic') || m.includes('sonnet') || m.includes('opus') || m.includes('haiku')) return 'anthropic';
  if (m.includes('gemini') || m.includes('google') || m.includes('palm')) return 'google';
  if (m.includes('llama') || m.includes('groq') || m.includes('mixtral')) return 'groq';
  return 'custom';
}

export function useStreamChat(
  messages: Message[],
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  options: UseStreamChatOptions
): UseStreamChatReturn {
  const [isStreaming, setIsStreaming] = useState(false);
  const [isRouting, setIsRouting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setIsRouting(false);
  }, []);

  const sendMessage = useCallback(async (content: string) => {
    if (isStreaming) return;

    if (!options.skipUserMessage) {
      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, userMsg]);
    }
    setIsRouting(true);

    const assistantId = crypto.randomUUID();
    const startTime = Date.now();

    abortRef.current = new AbortController();

    // Orchestration state: tracks which message ID belongs to which agent task
    let isOrchestrationMode = false;
    let currentAgentMsgId = assistantId;
    const agentMsgAccumulated: Record<string, string> = {};

    try {
      const res = await fetch(`${BASE_URL}/v1/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': options.apiKey,
        },
        body: JSON.stringify({
          message: content,
          conversationId: options.conversationId,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        throw new Error(`API error: ${res.status} ${res.statusText}`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('No response body');

      let accumulatedContent = '';
      let routingDecision: RoutingDecision | undefined;

      // Insert placeholder assistant message (used for single-agent path)
      setMessages(prev => [
        ...prev,
        {
          id: assistantId,
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          streaming: true,
        },
      ]);

      setIsRouting(false);
      setIsStreaming(true);

      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;

          let chunk: StreamChunk;
          try {
            chunk = JSON.parse(data);
          } catch {
            continue;
          }

          // ═══════════════════════════════════════════════════
          // ORCHESTRATION EVENTS (multi-agent)
          // ═══════════════════════════════════════════════════

          if (chunk.type === 'orchestration_start' && chunk.plan) {
            isOrchestrationMode = true;

            // Replace the placeholder message with an orchestration plan message
            setMessages(prev =>
              prev.map(m =>
                m.id === assistantId
                  ? {
                      ...m,
                      content: `🔀 **Multi-Agent Pipeline** — ${chunk.plan!.tasks.length} agents collaborating\n\n${chunk.plan!.tasks.map((t: OrchestrationTask, i: number) => `${i + 1}. **${t.agentName}** — ${t.description}`).join('\n')}`,
                      streaming: false,
                      isOrchestration: true,
                      orchestrationPlan: { chainId: chunk.plan!.chainId, tasks: chunk.plan!.tasks },
                      agent: { name: 'Orchestrator', provider: 'custom' as AgentProvider, model: 'monocle-router' },
                    }
                  : m
              )
            );
            continue;
          }

          if (chunk.type === 'agent_start' && chunk.agent && isOrchestrationMode) {
            // Create a NEW message for this agent
            const agentMsgId = crypto.randomUUID();
            currentAgentMsgId = agentMsgId;
            agentMsgAccumulated[agentMsgId] = '';

            const provider = chunk.agent.provider
              ? (chunk.agent.provider as AgentProvider)
              : inferProvider(chunk.agent.model);

            setMessages(prev => [
              ...prev,
              {
                id: agentMsgId,
                role: 'assistant',
                content: '',
                timestamp: new Date(),
                streaming: true,
                agent: {
                  name: chunk.agent!.name,
                  provider,
                  model: chunk.agent!.model,
                },
                isOrchestration: true,
                taskId: chunk.taskId,
                taskIndex: chunk.taskIndex,
                totalTasks: chunk.totalTasks,
              },
            ]);

            options.onAgentActivated?.(provider);
            continue;
          }

          if (chunk.type === 'agent_chunk' && chunk.text != null && isOrchestrationMode) {
            agentMsgAccumulated[currentAgentMsgId] =
              (agentMsgAccumulated[currentAgentMsgId] || '') + chunk.text;

            const content = agentMsgAccumulated[currentAgentMsgId];
            const targetId = currentAgentMsgId;

            setMessages(prev =>
              prev.map(m =>
                m.id === targetId ? { ...m, content, streaming: true } : m
              )
            );
            continue;
          }

          if (chunk.type === 'agent_complete' && isOrchestrationMode) {
            const targetId = currentAgentMsgId;

            setMessages(prev =>
              prev.map(m =>
                m.id === targetId
                  ? {
                      ...m,
                      streaming: false,
                      costLamports: chunk.costLamports || 0,
                      txSignature: chunk.txSignature,
                      latencyMs: chunk.latencyMs,
                    }
                  : m
              )
            );
            continue;
          }

          if (chunk.type === 'orchestration_complete' && isOrchestrationMode) {
            // All agents done — no additional message needed,
            // UI already shows all agent messages with their badges
            setIsStreaming(false);
            continue;
          }

          // ═══════════════════════════════════════════════════
          // SINGLE-AGENT EVENTS (existing behavior)
          // ═══════════════════════════════════════════════════

          if (chunk.type === 'routing' && chunk.agent) {
            const provider = inferProvider(chunk.agent.model);
            routingDecision = {
              selectedAgent: {
                agentId: chunk.agent.id,
                name: chunk.agent.name,
                provider,
                model: chunk.agent.model,
                taskTypes: [chunk.taskType || 'general'],
                ratePer1kTokens: 0,
                reputationScore: 0,
                uptime: 0,
              },
              taskType: chunk.taskType || 'general',
              confidence: chunk.confidence || 0,
              classificationMethod: 'keyword',
              candidatesConsidered: 1,
              latencyMs: 0,
              estimatedCostLamports: chunk.estimatedCostLamports || 0,
            };

            options.onRoutingDecision?.(routingDecision);
            options.onAgentActivated?.(provider);

            setMessages(prev =>
              prev.map(m =>
                m.id === assistantId
                  ? {
                      ...m,
                      agent: {
                        name: chunk.agent!.name,
                        provider,
                        model: chunk.agent!.model,
                      },
                      routing: routingDecision,
                    }
                  : m
              )
            );
          }

          if (chunk.type === 'chunk' && chunk.text != null && !isOrchestrationMode) {
            accumulatedContent += chunk.text;
            setMessages(prev =>
              prev.map(m =>
                m.id === assistantId
                  ? { ...m, content: accumulatedContent, streaming: true }
                  : m
              )
            );
          }

          if (chunk.type === 'done') {
            const latency = chunk.latencyMs || (Date.now() - startTime);
            const costLamports = chunk.cost?.totalLamports || 0;

            if (routingDecision && chunk.routing) {
              routingDecision.latencyMs = latency;
              routingDecision.estimatedCostLamports = costLamports;
              routingDecision.taskType = chunk.routing.taskType || routingDecision.taskType;
              routingDecision.confidence = chunk.routing.confidence || routingDecision.confidence;
            }

            setMessages(prev =>
              prev.map(m =>
                m.id === assistantId
                  ? {
                      ...m,
                      content: accumulatedContent,
                      streaming: false,
                      latencyMs: latency,
                      costLamports,
                      txSignature: chunk.txSignature,
                      x402AmountUsdc: chunk.x402AmountUsdc ?? null,
                      routing: routingDecision,
                    }
                  : m
              )
            );
          }

          // ── error events ──────────────────────────────────
          if (chunk.type === 'error' || chunk.type === 'STREAM_ERROR') {
            const msg = typeof chunk.error === 'string'
              ? chunk.error
              : chunk.error?.message ?? 'Stream error';
            throw new Error(msg);
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;

      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId
            ? {
                ...m,
                content: m.content || '⚠ Connection interrupted. Please try again.',
                streaming: false,
              }
            : m
        )
      );
    } finally {
      setIsStreaming(false);
      setIsRouting(false);
    }
  }, [isStreaming, messages, setMessages, options]);

  return { sendMessage, isStreaming, isRouting, abort };
}
