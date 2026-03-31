'use client';

import { useRef, useCallback, useState } from 'react';
import type { Conversation, AgentProvider } from '../../types/chat';

const PROVIDER_PILL: Record<AgentProvider, { label: string; cls: string }> = {
  openai:    { label: 'gpt-4o',    cls: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/15' },
  anthropic: { label: 'claude-4',  cls: 'text-violet-300 bg-violet-400/10 border-violet-400/15' },
  google:    { label: 'gemini-2',  cls: 'text-blue-400 bg-blue-400/10 border-blue-400/15' },
  groq:      { label: 'llama-3.3', cls: 'text-orange-400 bg-orange-400/10 border-orange-400/15' },
  custom:    { label: 'custom',    cls: 'text-amber-400 bg-amber-400/10 border-amber-400/15' },
};

function timeAgo(date: Date) {
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onGraphToggle: () => void;
  graphOpen: boolean;
  balanceSol: number;
  userName: string;
  userInitials: string;
}

export default function Sidebar({
  conversations, activeId, onSelect, onNew, onGraphToggle, graphOpen, balanceSol, userName, userInitials
}: SidebarProps) {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(260);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const next = Math.min(360, Math.max(200, startW.current + ev.clientX - startX.current));
      setWidth(next);
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [width]);

  return (
    <div
      ref={sidebarRef}
      style={{ width }}
      className="relative flex flex-col flex-shrink-0 h-full bg-[rgba(8,8,18,0.72)] backdrop-blur-2xl border-r border-white/[0.07] transition-none z-10"
    >
      {/* resize handle */}
      <div
        onMouseDown={onMouseDown}
        className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize z-20 flex items-center justify-center group"
      >
        <div className="w-px h-10 bg-white/[0.07] rounded group-hover:w-[2px] group-hover:bg-violet-500 group-hover:shadow-[0_0_8px_rgba(139,124,248,0.4)] transition-all" />
      </div>

      {/* header */}
      <div className="flex items-center gap-2.5 px-4 py-[17px] border-b border-white/[0.07]">
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <div className="w-[30px] h-[30px] rounded-[8px] bg-gradient-to-br from-violet-500 to-violet-300 flex items-center justify-center flex-shrink-0 shadow-[0_0_18px_rgba(139,124,248,0.4)]">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5}>
              <circle cx="12" cy="12" r="4"/>
              <circle cx="4" cy="12" r="2.5"/>
              <circle cx="20" cy="12" r="2.5"/>
              <line x1="6.5" y1="12" x2="8" y2="12"/>
              <line x1="16" y1="12" x2="17.5" y2="12"/>
            </svg>
          </div>
          <span className="text-[15px] font-semibold tracking-[-0.4px] text-white/90">
            mono<span className="font-light text-white/40">cle</span>
          </span>
        </div>
        <button
          onClick={onGraphToggle}
          className={`w-[28px] h-[28px] rounded-[6px] border border-white/[0.08] flex items-center justify-center transition-all ${
            graphOpen ? 'bg-violet-500/20 border-violet-400/30 text-violet-300' : 'text-white/40 hover:bg-white/[0.05] hover:text-white/60'
          }`}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="5" cy="12" r="2"/>
            <circle cx="19" cy="5" r="2"/>
            <circle cx="19" cy="19" r="2"/>
            <line x1="7" y1="11.5" x2="17" y2="6"/>
            <line x1="7" y1="12.5" x2="17" y2="18"/>
          </svg>
        </button>
      </div>

      {/* new chat btn */}
      <div className="px-3 pt-3 pb-1.5">
        <button
          onClick={onNew}
          className="w-full px-3 py-2.5 bg-violet-500/10 border border-violet-400/20 rounded-[9px] text-violet-300 text-[12.5px] flex items-center gap-2 hover:bg-violet-500/[0.18] hover:shadow-[0_0_18px_rgba(139,124,248,0.15)] transition-all"
        >
          <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          New conversation
        </button>
      </div>

      {/* list */}
      <div className="px-1.5 pt-1">
        <p className="px-2.5 pb-1.5 text-[10px] font-medium tracking-[0.09em] uppercase text-white/20">Recents</p>
      </div>
      <div className="flex-1 overflow-y-auto px-1.5 pb-2 scrollbar-thin scrollbar-thumb-white/[0.06]">
        {conversations.map(conv => {
          const lastAgent = conv.lastAgent;
          const pill = lastAgent ? PROVIDER_PILL[lastAgent] : null;
          return (
            <div
              key={conv.id}
              onClick={() => onSelect(conv.id)}
              className={`px-2.5 py-2.5 rounded-[8px] cursor-pointer mb-[2px] border transition-all ${
                conv.id === activeId
                  ? 'bg-white/[0.06] border-violet-400/15 shadow-[0_0_10px_rgba(139,124,248,0.05)]'
                  : 'border-transparent hover:bg-white/[0.04] hover:border-white/[0.07]'
              }`}
            >
              <p className="text-[12.5px] text-white/80 truncate mb-[3px]">{conv.title}</p>
              <div className="flex items-center gap-1.5">
                {pill && (
                  <span className={`font-mono text-[9.5px] px-1.5 py-0.5 rounded border ${pill.cls}`}>
                    {pill.label}
                  </span>
                )}
                <span className="text-[10.5px] text-white/25">{timeAgo(conv.createdAt)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* footer */}
      <div className="px-1.5 py-2.5 border-t border-white/[0.07]">
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-[8px] cursor-pointer hover:bg-white/[0.04] transition-all">
          <div className="w-[30px] h-[30px] rounded-full bg-gradient-to-br from-violet-500 to-emerald-400 flex items-center justify-center text-[11px] font-semibold text-white flex-shrink-0 shadow-[0_0_10px_rgba(139,124,248,0.3)]">
            {userInitials}
          </div>
          <div>
            <p className="text-[12.5px] text-white/80">{userName}</p>
            <p className="text-[10.5px] text-green-400 font-mono">◎ {balanceSol.toFixed(4)} SOL</p>
          </div>
        </div>
      </div>
    </div>
  );
}
