'use client';

import { useEffect, useRef, useCallback } from 'react';
import type { NetworkNode, NetworkEdge, AgentProvider } from '../../types/chat';

interface AgentNetworkProps {
  activeProvider: AgentProvider | null;
  sessionCost: number;
  activeAgentCount: number;
}

const BASE_NODES: Omit<NetworkNode, 'active'>[] = [
  { id: 'router', label: 'Router',  x: 150, y: 95,  color: '#8b7cf8', glow: 'rgba(139,124,248,0.45)', r: 14 },
  { id: 'openai', label: 'GPT-4o',  x: 55,  y: 42,  color: '#74c7a5', glow: 'rgba(116,199,165,0.4)',  r: 10, provider: 'openai' as AgentProvider },
  { id: 'anthropic', label: 'Claude', x: 55, y: 148, color: '#b4a9ff', glow: 'rgba(180,169,255,0.4)', r: 10, provider: 'anthropic' as AgentProvider },
  { id: 'google', label: 'Gemini',  x: 245, y: 42,  color: '#60a5fa', glow: 'rgba(96,165,250,0.4)',   r: 10, provider: 'google' as AgentProvider },
  { id: 'custom', label: 'Custom',  x: 245, y: 148, color: '#f5a623', glow: 'rgba(245,166,35,0.35)',  r: 8,  provider: 'custom' as AgentProvider },
];

const EDGES: Omit<NetworkEdge, 'active' | 'animOffset'>[] = [
  { from: 'router', to: 'openai' },
  { from: 'router', to: 'anthropic' },
  { from: 'router', to: 'google' },
  { from: 'router', to: 'custom' },
];

export default function AgentNetwork({ activeProvider, sessionCost, activeAgentCount }: AgentNetworkProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const tRef = useRef(0);
  const activeProviderRef = useRef(activeProvider);
  activeProviderRef.current = activeProvider;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = 300, H = 190;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.scale(dpr, dpr);

    const nodeById = (id: string) => BASE_NODES.find(n => n.id === id)!;

    const tick = () => {
      tRef.current += 0.02;
      const t = tRef.current;
      ctx.clearRect(0, 0, W, H);

      // edges
      EDGES.forEach(e => {
        const a = nodeById(e.from);
        const b = nodeById(e.to);
        const isActive = b.provider === activeProviderRef.current;

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = isActive ? 'rgba(139,124,248,0.4)' : 'rgba(255,255,255,0.06)';
        ctx.lineWidth = isActive ? 1.5 : 0.8;
        ctx.stroke();

        if (isActive) {
          const pt = (t * 0.65) % 1;
          const px = a.x + (b.x - a.x) * pt;
          const py = a.y + (b.y - a.y) * pt;

          const grd = ctx.createRadialGradient(px, py, 0, px, py, 9);
          grd.addColorStop(0, 'rgba(139,124,248,0.7)');
          grd.addColorStop(1, 'transparent');
          ctx.beginPath();
          ctx.arc(px, py, 9, 0, Math.PI * 2);
          ctx.fillStyle = grd;
          ctx.fill();

          ctx.beginPath();
          ctx.arc(px, py, 3, 0, Math.PI * 2);
          ctx.fillStyle = '#b4a9ff';
          ctx.fill();
        }
      });

      // nodes
      BASE_NODES.forEach(n => {
        const isRouter = n.id === 'router';
        const isActive = n.provider === activeProviderRef.current || isRouter;
        const pulse = isRouter ? Math.sin(t * 2.2) * 2.5 : 0;
        const extraR = pulse;

        const gr = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * 3 + extraR);
        gr.addColorStop(0, isActive ? n.glow : n.glow.replace(/[\d.]+\)$/, '0.15)'));
        gr.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r * 3 + extraR, 0, Math.PI * 2);
        ctx.fillStyle = gr;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + extraR * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = n.color + '1a';
        ctx.fill();
        ctx.strokeStyle = isActive ? n.color : n.color + '55';
        ctx.lineWidth = isActive ? 1.8 : 1;
        ctx.stroke();

        if (isRouter) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#8b7cf8';
          ctx.fill();
        }

        ctx.fillStyle = isActive ? 'rgba(241,241,245,0.75)' : 'rgba(241,241,245,0.3)';
        ctx.font = '500 9.5px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(n.label, n.x, n.y + n.r + 13);
      });

      animRef.current = requestAnimationFrame(tick);
    };

    tick();
  }, []);

  useEffect(() => {
    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [draw]);

  const lamportsToSol = (l: number) => (l / 1e9).toFixed(6);

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-white/[0.07]">
        <span className="text-[10px] font-medium tracking-[0.08em] text-white/40 uppercase">
          Agent Network · Live
        </span>
        <div className="flex gap-4">
          <div className="text-right">
            <div className="text-[13px] font-medium text-green-400 font-mono">{activeAgentCount}</div>
            <div className="text-[9.5px] text-white/25 mt-0.5">active</div>
          </div>
          <div className="text-right">
            <div className="text-[13px] font-medium text-white/70 font-mono">◎{lamportsToSol(sessionCost)}</div>
            <div className="text-[9.5px] text-white/25 mt-0.5">session</div>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-center py-1">
        <canvas ref={canvasRef} style={{ width: 300, height: 190 }} />
      </div>
    </div>
  );
}
