'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import type { Message, Conversation, AgentProvider, Attachment } from '../../types/chat';
import { useStreamChat } from '../../hooks/useStreamChat';
import Sidebar from './Sidebar';
import ChatMessage from './ChatMessage';

const AgentNetwork = dynamic(() => import('./AgentNetwork'), { ssr: false });

// ─── Mock conversations for sidebar ──────────────────────────────────────────
const MOCK_CONVERSATIONS: Conversation[] = [
  { id: '1', title: 'Debug React render loop',        messages: [], createdAt: new Date(Date.now() - 2 * 60000),         lastAgent: 'openai' },
  { id: '2', title: 'Explain transformer attention',  messages: [], createdAt: new Date(Date.now() - 60 * 60000),        lastAgent: 'anthropic' },
  { id: '3', title: 'Solana escrow flow design',      messages: [], createdAt: new Date(Date.now() - 3 * 60 * 60000),    lastAgent: 'openai' },
  { id: '4', title: 'Market analysis: AI infra 2025', messages: [], createdAt: new Date(Date.now() - 24 * 60 * 60000),   lastAgent: 'google' },
  { id: '5', title: 'Auth module unit tests',          messages: [], createdAt: new Date(Date.now() - 2 * 24 * 60 * 60000), lastAgent: 'anthropic' },
];

// Replace with real API key from env / user session
const API_KEY = process.env.NEXT_PUBLIC_MONOCLE_API_KEY ?? '';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>(MOCK_CONVERSATIONS);
  const [activeConvId, setActiveConvId] = useState<string | null>('1');
  const [convTitle, setConvTitle] = useState('Debug React render loop');
  const [inputValue, setInputValue] = useState('');
  const [graphOpen, setGraphOpen] = useState(false);
  const [activeProvider, setActiveProvider] = useState<AgentProvider | null>(null);
  const [sessionCostLamports, setSessionCostLamports] = useState(0);
  const [tokenCount, setTokenCount] = useState(0);
  const [attachments, setAttachments] = useState<{id:string;name:string;size:number;type:string;url:string;file:File}[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { sendMessage, isStreaming, isRouting, abort } = useStreamChat(
    messages,
    setMessages,
    {
      apiKey: API_KEY,
      conversationId: activeConvId ?? undefined,
      skipUserMessage: true,
      onRoutingDecision: (routing) => {
        setActiveProvider(routing.selectedAgent.provider);
        setSessionCostLamports(prev => prev + routing.estimatedCostLamports);
      },
      onAgentActivated: (provider) => {
        setActiveProvider(provider as AgentProvider);
      },
    }
  );

  // auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // generate conversation title from first message
  useEffect(() => {
    if (messages.length === 1 && messages[0].role === 'user') {
      const title = messages[0].content.slice(0, 50) + (messages[0].content.length > 50 ? '…' : '');
      setConvTitle(title);
    }
  }, [messages]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const newAttachments = Array.from(files).map(file => ({
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      type: file.type,
      url: URL.createObjectURL(file),
      file,
    }));
    setAttachments(prev => [...prev, ...newAttachments]);
    // reset input so same file can be re-selected
    e.target.value = '';
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => {
      const att = prev.find(a => a.id === id);
      if (att) URL.revokeObjectURL(att.url);
      return prev.filter(a => a.id !== id);
    });
  }, []);

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if ((!text && attachments.length === 0) || isStreaming || isRouting) return;
    const currentAttachments = attachments.map(a => ({
      id: a.id, name: a.name, size: a.size, type: a.type, url: a.url,
    }));
    setInputValue('');
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    setTokenCount(0);

    // Add attachments to the user message
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text || (currentAttachments.length > 0 ? `[Attached ${currentAttachments.length} file(s): ${currentAttachments.map(a => a.name).join(', ')}]` : ''),
      timestamp: new Date(),
      attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
    };
    setMessages(prev => [...prev, userMsg]);

    // Build the message text to include file info for the model
    const msgText = currentAttachments.length > 0
      ? `${text}\n\n[Attached files: ${currentAttachments.map(a => `${a.name} (${a.type}, ${formatFileSize(a.size)})`).join(', ')}]`
      : text;

    await sendMessage(msgText);
  }, [inputValue, attachments, isStreaming, isRouting, sendMessage, setMessages]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
    const words = e.target.value.trim().split(/\s+/).filter(Boolean).length;
    setTokenCount(Math.round(words * 1.3));
  };

  const handleNewChat = () => {
    const newId = crypto.randomUUID();
    const newConv: Conversation = {
      id: newId,
      title: 'New conversation',
      messages: [],
      createdAt: new Date(),
    };
    setConversations(prev => [newConv, ...prev]);
    setActiveConvId(newId);
    setMessages([]);
    setConvTitle('New conversation');
    setActiveProvider(null);
    setSessionCostLamports(0);
    textareaRef.current?.focus();
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  // cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      attachments.forEach(a => URL.revokeObjectURL(a.url));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeAgentCount = activeProvider ? 1 : 0;
  const isBusy = isStreaming || isRouting;

  return (
    <div className="flex w-full h-screen bg-[#07070f] overflow-hidden font-sans">
      {/* bg decorations */}
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{
          backgroundImage: 'linear-gradient(rgba(139,124,248,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(139,124,248,0.025) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />
      <div className="fixed w-[600px] h-[600px] rounded-full pointer-events-none z-0 opacity-60"
        style={{ background: 'radial-gradient(circle, rgba(139,124,248,0.07) 0%, transparent 70%)', top: '-200px', left: '-100px' }} />
      <div className="fixed w-[500px] h-[500px] rounded-full pointer-events-none z-0 opacity-60"
        style={{ background: 'radial-gradient(circle, rgba(62,207,142,0.05) 0%, transparent 70%)', bottom: '-150px', right: '-100px' }} />

      {/* sidebar */}
      <Sidebar
        conversations={conversations}
        activeId={activeConvId}
        onSelect={setActiveConvId}
        onNew={handleNewChat}
        onGraphToggle={() => setGraphOpen(v => !v)}
        graphOpen={graphOpen}
        balanceSol={0.4821}
        userName="Adewale O."
        userInitials="AO"
      />

      {/* main */}
      <div className="flex-1 flex flex-col min-w-0 relative z-[5]">

        {/* floating network panel */}
        <div className={`absolute top-[62px] right-4 w-[310px] bg-[rgba(10,10,22,0.92)] backdrop-blur-[32px] border border-white/[0.07] rounded-[14px] z-50 shadow-[0_24px_64px_rgba(0,0,0,0.6)] transition-all duration-[250ms] ease-[cubic-bezier(0.4,0,0.2,1)] overflow-hidden ${
          graphOpen ? 'opacity-100 translate-y-0 scale-100 pointer-events-auto' : 'opacity-0 -translate-y-2 scale-[0.97] pointer-events-none'
        }`}>
          <AgentNetwork
            activeProvider={activeProvider}
            sessionCost={sessionCostLamports}
            activeAgentCount={activeAgentCount}
          />
        </div>

        {/* topbar */}
        <div className="h-[54px] flex items-center px-[18px] gap-2.5 border-b border-white/[0.07] bg-[rgba(7,7,15,0.65)] backdrop-blur-xl flex-shrink-0">
          <span className="flex-1 text-[13.5px] font-medium text-white/85 truncate">{convTitle}</span>
          <div className="flex items-center gap-1.5 px-2.5 py-[5px] bg-green-400/[0.07] border border-green-400/15 rounded-[6px] text-[11px] font-mono text-green-400/80">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 shadow-[0_0_6px_rgba(62,207,142,0.6)] animate-pulse" />
            auto-routing
          </div>
          <button className="w-8 h-8 rounded-[7px] border border-white/[0.07] bg-transparent text-white/40 hover:bg-white/[0.05] hover:text-white/60 transition-all flex items-center justify-center">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          </button>
          <button className="w-8 h-8 rounded-[7px] border border-white/[0.07] bg-transparent text-white/40 hover:bg-white/[0.05] hover:text-white/60 transition-all flex items-center justify-center">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
          </button>
        </div>

        {/* messages */}
        <div className="flex-1 overflow-y-auto py-5 scrollbar-thin scrollbar-thumb-white/[0.05]">
          <div className="max-w-[720px] mx-auto px-5">

            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-violet-300 flex items-center justify-center mb-4 shadow-[0_0_30px_rgba(139,124,248,0.3)]">
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5}>
                    <circle cx="12" cy="12" r="4"/>
                    <circle cx="4" cy="12" r="2.5"/>
                    <circle cx="20" cy="12" r="2.5"/>
                    <line x1="6.5" y1="12" x2="8" y2="12"/>
                    <line x1="16" y1="12" x2="17.5" y2="12"/>
                  </svg>
                </div>
                <p className="text-[15px] font-medium text-white/60 mb-1.5">Ask Monocle anything</p>
                <p className="text-[13px] text-white/25 max-w-xs">The best AI agent is automatically selected for your task</p>
              </div>
            )}

            {/* session divider */}
            {messages.length > 0 && (
              <div className="flex items-center gap-2.5 pb-5 text-[10.5px] text-white/20 font-mono">
                <div className="flex-1 h-px bg-white/[0.06] max-w-[80px]" />
                session started · {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).toLowerCase()}
                <div className="flex-1 h-px bg-white/[0.06] max-w-[80px]" />
              </div>
            )}

            {messages.map(msg => (
              <ChatMessage key={msg.id} message={msg} onCopy={handleCopy} />
            ))}

            {/* routing / thinking state */}
            {isRouting && (
              <div className="flex gap-3 mb-5 animate-[msgIn_0.2s_ease_both]">
                <style>{`@keyframes msgIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}`}</style>
                <div className="w-[30px] h-[30px] rounded-lg flex-shrink-0 mt-0.5 flex items-center justify-center text-[10px] font-semibold bg-violet-500/10 text-violet-300 border border-violet-400/20">M</div>
                <div className="pt-1.5">
                  <p className="text-[11px] font-mono text-white/30 mb-1.5">
                    <span className="text-violet-300">monocle</span> is routing your request...
                  </p>
                  <div className="flex gap-1">
                    {[0, 150, 300].map(d => (
                      <span key={d} className="w-[5px] h-[5px] rounded-full bg-white/25 animate-bounce" style={{ animationDelay: `${d}ms` }} />
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* input */}
        <div className="px-5 pt-3.5 pb-5 border-t border-white/[0.07] bg-[rgba(7,7,15,0.72)] backdrop-blur-xl flex-shrink-0">
          <div className="max-w-[720px] mx-auto">
            <div className={`bg-white/[0.04] border rounded-[14px] px-3.5 py-3 flex flex-col gap-2.5 transition-all duration-200 ${
              inputValue ? 'border-violet-400/30 bg-violet-500/[0.04] shadow-[0_0_0_3px_rgba(139,124,248,0.06),0_0_28px_rgba(139,124,248,0.06)]' : 'border-white/[0.07]'
            }`}>
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything — Monocle routes to the best agent..."
                rows={1}
                disabled={isBusy}
                className="bg-transparent border-none outline-none text-[13.5px] leading-[1.6] text-white/85 placeholder-white/20 resize-none min-h-[22px] max-h-[140px] overflow-y-auto w-full font-sans disabled:opacity-50"
                style={{ fontFamily: 'inherit' }}
              />

              {/* Attachment chips */}
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {attachments.map(att => (
                    <div
                      key={att.id}
                      className="flex items-center gap-1.5 px-2 py-1 bg-white/[0.05] border border-white/[0.08] rounded-md group"
                    >
                      {att.type.startsWith('image/') ? (
                        <img src={att.url} alt={att.name} className="w-5 h-5 rounded object-cover" />
                      ) : (
                        <svg className="w-3.5 h-3.5 text-white/30 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                      )}
                      <span className="text-[11px] text-white/50 max-w-[120px] truncate">{att.name}</span>
                      <span className="text-[10px] text-white/20 font-mono">{formatFileSize(att.size)}</span>
                      <button
                        onClick={() => removeAttachment(att.id)}
                        className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-white/20 hover:text-red-400 hover:bg-red-400/10 transition-all opacity-0 group-hover:opacity-100"
                      >
                        <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-400/[0.07] border border-green-400/15 rounded-[5px] text-[11px] font-mono text-green-400/70 cursor-pointer hover:bg-green-400/10 transition-all">
                  <span className="w-[5px] h-[5px] rounded-full bg-green-400 shadow-[0_0_5px_rgba(62,207,142,0.5)]" />
                  Auto-route
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleFileSelect}
                  accept=".txt,.md,.json,.csv,.pdf,.png,.jpg,.jpeg,.gif,.webp,.svg,.ts,.tsx,.js,.jsx,.py,.rs,.go,.html,.css"
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isBusy}
                  className="w-[30px] h-[30px] rounded-[7px] border border-white/[0.07] bg-transparent text-white/25 hover:bg-white/[0.05] hover:text-white/50 transition-all flex items-center justify-center disabled:opacity-30"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
                  </svg>
                </button>
                <div className="flex-1" />
                <span className="text-[11px] font-mono text-white/20">{tokenCount} / 8k</span>
                {isBusy ? (
                  <button
                    onClick={abort}
                    className="h-[30px] px-4 bg-red-500/20 border border-red-400/20 rounded-[7px] text-red-400 text-[12.5px] font-medium flex items-center gap-1.5 hover:bg-red-500/30 transition-all"
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
                    Stop
                  </button>
                ) : (
                  <button
                    onClick={handleSend}
                    disabled={!inputValue.trim() && attachments.length === 0}
                    className="h-[30px] px-4 bg-gradient-to-r from-violet-500 to-violet-400 border-none rounded-[7px] text-white text-[12.5px] font-medium flex items-center gap-1.5 shadow-[0_0_16px_rgba(139,124,248,0.3)] hover:shadow-[0_0_24px_rgba(139,124,248,0.5)] hover:-translate-y-px transition-all active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:shadow-none disabled:hover:translate-y-0"
                  >
                    Send
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5}>
                      <line x1="22" y1="2" x2="11" y2="13"/>
                      <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
