'use client';

import { useState } from 'react';
import type { Message, AgentProvider, Attachment } from '../../types/chat';
import { X402Badge } from './X402Badge';

const AGENT_STYLES: Record<AgentProvider, { bg: string; text: string; border: string; short: string }> = {
  openai:    { bg: 'bg-emerald-400/10',  text: 'text-emerald-400',  border: 'border-emerald-400/20', short: 'G4' },
  anthropic: { bg: 'bg-violet-400/10',   text: 'text-violet-300',   border: 'border-violet-400/20',  short: 'C4' },
  google:    { bg: 'bg-blue-400/10',     text: 'text-blue-400',     border: 'border-blue-400/20',    short: 'GM' },
  groq:      { bg: 'bg-orange-400/10',   text: 'text-orange-400',   border: 'border-orange-400/20',  short: 'GQ' },
  custom:    { bg: 'bg-amber-400/10',    text: 'text-amber-400',    border: 'border-amber-400/20',   short: 'CX' },
};

function AgentAvatar({ provider }: { provider: AgentProvider }) {
  const s = AGENT_STYLES[provider];
  return (
    <div className={`relative w-[30px] h-[30px] rounded-lg flex-shrink-0 mt-0.5 flex items-center justify-center text-[10px] font-semibold ${s.bg} ${s.text} border ${s.border}`}>
      {s.short}
      {/* online dot */}
      <span className="absolute -bottom-[2px] -right-[2px] w-2 h-2 rounded-full bg-green-400 border-2 border-[#07070f] shadow-[0_0_6px_rgba(62,207,142,0.6)]" />
    </div>
  );
}

function RoutingTrace({ routing, expanded, onToggle }: {
  routing: NonNullable<Message['routing']>;
  expanded: boolean;
  onToggle: () => void;
}) {
  const lamports = routing.estimatedCostLamports;
  const solCost = (lamports / 1e9).toFixed(6);

  return (
    <div
      onClick={onToggle}
      className="flex items-start gap-2 px-2.5 py-2 mb-2.5 bg-violet-500/[0.06] border border-violet-500/[0.12] rounded-lg cursor-pointer hover:bg-violet-500/[0.1] hover:border-violet-500/20 transition-all text-[10.5px] font-mono text-white/30"
    >
      <svg className="w-2.5 h-2.5 mt-0.5 flex-shrink-0 stroke-violet-400" viewBox="0 0 24 24" fill="none" strokeWidth={2}>
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
      <div className="flex-1 min-w-0">
        <span>routed via </span>
        <span className="text-violet-300">{routing.classificationMethod}-classifier</span>
        <span> · score </span>
        <span className="text-green-400">{routing.confidence.toFixed(2)}</span>
        <span> · {routing.candidatesConsidered} candidates · </span>
        <span className="text-amber-400">◎{solCost}</span>
        <span className="ml-2 text-white/20">{expanded ? '▲ hide' : '▼ inspect'}</span>
      </div>
    </div>
  );
}

function RoutingDetail({ routing }: { routing: NonNullable<Message['routing']> }) {
  return (
    <div className="mb-3 px-3 py-2.5 bg-white/[0.02] border border-white/[0.07] rounded-lg">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px]">
        {[
          ['Task type', routing.taskType],
          ['Method', routing.classificationMethod],
          ['Confidence', `${(routing.confidence * 100).toFixed(0)}%`],
          ['Candidates', String(routing.candidatesConsidered)],
          ['Router latency', `${routing.latencyMs}ms`],
          ['Agent', routing.selectedAgent.model],
        ].map(([label, val]) => (
          <div key={label} className="flex justify-between">
            <span className="text-white/30">{label}</span>
            <span className="text-white/60 font-mono">{val}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StreamingCursor() {
  return (
    <span className="inline-block w-[2px] h-3.5 bg-violet-300 ml-0.5 align-middle animate-[blink_0.75s_steps(1)_infinite]" />
  );
}

function MessageContent({ content, streaming }: { content: string; streaming?: boolean }) {
  const parts = content.split(/(```[\s\S]*?```|`[^`]+`)/g);

  return (
    <div className="text-[13.5px] leading-[1.75] text-white/85">
      {parts.map((part, i) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const code = part.slice(3, -3).replace(/^[a-z]+\n/, '');
          return (
            <pre key={i} className="bg-white/[0.03] border border-white/[0.07] rounded-lg p-3.5 my-2.5 overflow-x-auto">
              <code className="font-mono text-[12.5px] leading-[1.7] text-violet-300/90">{code}</code>
            </pre>
          );
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code key={i} className="font-mono text-[12px] px-1.5 py-0.5 bg-violet-500/10 border border-violet-400/15 rounded text-violet-300">
              {part.slice(1, -1)}
            </code>
          );
        }
        return (
          <span key={i}>
            {part.split('\n\n').map((para, j) => (
              <p key={j} className={j > 0 ? 'mt-2' : ''}>
                {para}
              </p>
            ))}
          </span>
        );
      })}
      {streaming && <StreamingCursor />}
    </div>
  );
}

interface ChatMessageProps {
  message: Message;
  onCopy: (text: string) => void;
}

export default function ChatMessage({ message, onCopy }: ChatMessageProps) {
  const [routingExpanded, setRoutingExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    onCopy(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (message.role === 'user') {
    return (
      <div className="flex justify-end mb-3.5">
        <div className="max-w-[72%] px-4 py-3 bg-violet-500/[0.08] border border-violet-400/[0.16] rounded-[14px_14px_3px_14px] text-[13.5px] leading-[1.65] text-white/90 backdrop-blur-sm">
          {message.content}
        </div>
      </div>
    );
  }

  const provider = message.agent?.provider ?? 'openai';
  const agentStyle = AGENT_STYLES[provider];
  const latency = message.latencyMs;
  const cost = message.costLamports ? (message.costLamports / 1e9).toFixed(6) : null;
  const isChainStep = message.isOrchestration && message.taskIndex != null;

  return (
    <div className="flex gap-3 mb-5 animate-[msgIn_0.28s_cubic-bezier(0.4,0,0.2,1)_both] group">
      <style>{`
        @keyframes msgIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
      `}</style>

      {/* Chain connector line for orchestration steps */}
      {isChainStep ? (
        <div className="flex flex-col items-center flex-shrink-0">
          {/* Vertical connector from previous agent */}
          {(message.taskIndex ?? 0) > 0 && (
            <div className="w-px h-3 bg-gradient-to-b from-violet-500/30 to-violet-500/10 -mt-5 mb-1" />
          )}
          <AgentAvatar provider={provider} />
          {/* Vertical connector to next agent */}
          {(message.taskIndex ?? 0) < (message.totalTasks ?? 1) - 1 && (
            <div className="w-px flex-1 bg-gradient-to-b from-violet-500/20 to-transparent mt-1" />
          )}
        </div>
      ) : (
        <AgentAvatar provider={provider} />
      )}

      <div className="flex-1 min-w-0">
        {/* header row */}
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          {/* Chain step badge */}
          {isChainStep && (
            <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 border border-violet-400/20">
              Step {(message.taskIndex ?? 0) + 1}/{message.totalTasks}
            </span>
          )}
          <span className="text-[12px] font-medium text-white/50">
            {message.agent?.name ?? 'Agent'}
          </span>
          {message.routing && (
            <span className={`font-mono text-[9.5px] px-1.5 py-0.5 rounded border ${agentStyle.bg} ${agentStyle.text} ${agentStyle.border}`}>
              {message.routing.taskType} · {(message.routing.confidence * 100).toFixed(0)}%
            </span>
          )}
          {latency && (
            <span className="font-mono text-[9.5px] px-1.5 py-0.5 rounded bg-green-400/[0.08] text-green-400 border border-green-400/20">
              {latency}ms
            </span>
          )}
          {cost && (
            <span className="font-mono text-[9.5px] px-1.5 py-0.5 rounded bg-amber-400/[0.08] text-amber-400 border border-amber-400/20">
              ◎{cost}
            </span>
          )}
        </div>

        {/* routing trace */}
        {message.routing && (
          <>
            <RoutingTrace
              routing={message.routing}
              expanded={routingExpanded}
              onToggle={() => setRoutingExpanded(v => !v)}
            />
            {routingExpanded && <RoutingDetail routing={message.routing} />}
          </>
        )}

        {/* x402 transaction badge */}
        <X402Badge
          txSignature={message.txSignature}
          amountUsdc={message.x402AmountUsdc}
          agentName={message.agent?.name}
          network="devnet"
        />

        {/* attachments */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-1.5 mb-1">
            {message.attachments.map(att => (
              <div key={att.id} className="flex items-center gap-1.5 px-2 py-1 bg-white/[0.04] border border-white/[0.08] rounded-md">
                {att.type.startsWith('image/') ? (
                  <img src={att.url} alt={att.name} className="w-8 h-8 rounded object-cover" />
                ) : (
                  <svg className="w-3.5 h-3.5 text-white/25 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                )}
                <span className="text-[11px] text-white/40 max-w-[150px] truncate">{att.name}</span>
              </div>
            ))}
          </div>
        )}

        {/* content */}
        <MessageContent content={message.content} streaming={message.streaming} />

        {/* actions */}
        {!message.streaming && (
          <div className="flex gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
            {[
              { label: copied ? 'Copied!' : 'Copy', action: handleCopy },
              { label: '👍 Good', action: () => {} },
              { label: '👎 Bad', action: () => {} },
            ].map(btn => (
              <button
                key={btn.label}
                onClick={btn.action}
                className="px-2 py-1 rounded-md border border-transparent text-[11px] text-white/30 hover:bg-white/[0.05] hover:border-white/[0.08] hover:text-white/50 transition-all font-sans"
              >
                {btn.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
