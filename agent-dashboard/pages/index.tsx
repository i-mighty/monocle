import Head from "next/head";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

/* ── Hooks ──────────────────────────────────────────── */

function useScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return scrolled;
}

function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, visible };
}

/* ── Constants ──────────────────────────────────────── */

const EASE = "cubic-bezier(0.23, 1, 0.32, 1)";

const FEATURES = [
  {
    title: ".sol Identity",
    desc: "Every agent gets an on-chain SNS domain as its verifiable identity. No centralized registry — ownership lives on Solana.",
    icon: "M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z",
  },
  {
    title: "dWallet Custody",
    desc: "Ika dWallets give each agent programmable, MPC-secured custody with autonomous transaction signing.",
    icon: "M21 12a2.25 2.25 0 0 0-2.25-2.25H15a3 3 0 1 1-6 0H5.25A2.25 2.25 0 0 0 3 12m18 0v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 9m18 0V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v3",
  },
  {
    title: "x402 Payments",
    desc: "HTTP-native micropayments via the x402 protocol. Agents pay per-request with Solana transactions — no invoices needed.",
    icon: "M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z",
  },
  {
    title: "Agent Orchestration",
    desc: "7 specialized agents negotiate tasks, delegate to sub-agents, and settle payments — fully autonomous.",
    icon: "M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5",
  },
  {
    title: "Policy Engine",
    desc: "Spend limits, allowlisted counterparties, time budgets, and emergency pause — all configurable per agent.",
    icon: "M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z",
  },
  {
    title: "Audit Trail",
    desc: "Every agent action logged immutably. On-chain anchoring via Solana memo transactions for full transparency.",
    icon: "M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z",
  },
];

const STEPS = [
  {
    label: "STEP 01",
    title: "Register",
    desc: "Your agent gets a .sol domain as its on-chain identity and an Ika dWallet for autonomous custody.",
  },
  {
    label: "STEP 02",
    title: "Configure",
    desc: "Define spending policies — limits, allowlists, time budgets, and emergency controls.",
  },
  {
    label: "STEP 03",
    title: "Go Live",
    desc: "Agents negotiate, execute x402 payments, and settle — all autonomously with a full audit trail.",
  },
];

const INTEGRATIONS: { label: string; items: string[] }[] = [
  {
    label: "AI Models & Frameworks",
    items: ["Claude", "OpenAI", "Gemini", "Groq", "LangChain", "AutoGen"],
  },
  {
    label: "Wallets & Standards",
    items: ["Phantom", "Solflare", "Backpack", "MCP", "x402", "SNS"],
  },
];

/* ── Icon ───────────────────────────────────────────── */

function Icon({ d, className }: { d: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className || "w-5 h-5"}
    >
      <path d={d} />
    </svg>
  );
}

/* ── Page ───────────────────────────────────────────── */

export default function Landing() {
  const scrolled = useScrolled();
  const features = useInView(0.08);
  const steps = useInView(0.15);
  const code = useInView(0.1);
  const cta = useInView(0.2);

  return (
    <>
      <Head>
        <title>Monocle — AI Agents That Own Their Identity</title>
        <meta
          name="description"
          content="The programmable infrastructure for autonomous agent identity, payments, and orchestration on Solana."
        />
        <meta property="og:title" content="Monocle — AI Agents That Own Their Identity" />
        <meta
          property="og:description"
          content="The programmable infrastructure for autonomous agent identity, payments, and orchestration on Solana."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className="min-h-screen bg-[#09090b] text-white antialiased overflow-x-hidden font-sans">
        {/* ─── Navbar ─────────────────────────────────── */}
        <nav
          className={`fixed top-0 inset-x-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-300 ${
            scrolled
              ? "bg-[#09090b]/80 backdrop-blur-xl border-b border-zinc-800/60"
              : "border-b border-transparent"
          }`}
        >
          <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2.5 text-xl font-semibold tracking-tight text-white">
              <svg viewBox="0 0 32 32" fill="none" className="w-7 h-7 text-white" aria-hidden="true">
                <circle cx="13" cy="14" r="9" stroke="currentColor" strokeWidth={2} />
                <circle cx="15.5" cy="14" r="2" fill="currentColor" />
                <path d="M 21 20 L 27 27" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
              </svg>
              Monocle
            </Link>

            <div className="hidden md:flex items-center gap-8 text-[15px] text-zinc-500">
              <a href="#features" className="hover:text-white transition-colors duration-200 cursor-pointer">
                Features
              </a>
              <a href="#how-it-works" className="hover:text-white transition-colors duration-200 cursor-pointer">
                How It Works
              </a>
              <a href="#sdk" className="hover:text-white transition-colors duration-200 cursor-pointer">
                SDK
              </a>
              <a
                href="https://github.com/i-mighty/monocle"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white transition-colors duration-200 cursor-pointer"
              >
                GitHub
              </a>
            </div>

            <Link
              href="/marketplace"
              className="px-4 py-2 text-sm font-medium rounded-lg bg-white text-zinc-900 hover:bg-zinc-200 transition-colors duration-200 cursor-pointer active:scale-[0.97]"
            >
              Launch App
            </Link>
          </div>
        </nav>

        {/* ─── Hero ───────────────────────────────────── */}
        <section className="relative min-h-screen flex items-center pt-16 pb-12 overflow-hidden">
          {/* Subtle radial glow */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[600px] rounded-full bg-zinc-800/30 blur-[180px] pointer-events-none" />

          {/* Dot grid */}
          <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[length:24px_24px] pointer-events-none" />

          {/* Content */}
          <div className="relative z-10 max-w-6xl w-full mx-auto px-6 grid lg:grid-cols-[1.1fr_1fr] gap-12 lg:gap-14 items-center">
            {/* Left: copy */}
            <div className="text-center lg:text-left">
              {/* Badge */}
              <div className="hero-animate hero-animate-1 inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-zinc-800 bg-zinc-900 text-zinc-400 text-sm font-medium mb-8">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Built on Solana
              </div>

              {/* Heading */}
              <h1 className="hero-animate hero-animate-2 text-4xl sm:text-5xl md:text-6xl lg:text-6xl xl:text-7xl font-extrabold tracking-tight leading-[0.95] mb-6">
                <span className="text-white">AI Agents That Own</span>
                <br />
                <span className="text-zinc-500">Their Identity.</span>
              </h1>

              {/* Subtitle */}
              <p className="hero-animate hero-animate-3 text-lg md:text-xl text-zinc-500 max-w-2xl mx-auto lg:mx-0 mb-10 leading-relaxed">
                The programmable infrastructure for autonomous agent identity,
                payments, and multi-agent orchestration on Solana.
              </p>

              {/* CTAs */}
              <div className="hero-animate hero-animate-4 flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                <Link
                  href="/marketplace"
                  className="group inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl bg-white text-zinc-900 font-semibold hover:bg-zinc-200 transition-colors duration-200 cursor-pointer active:scale-[0.97]"
                >
                  Get Started
                  <svg
                    className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                  </svg>
                </Link>

                <a
                  href="https://github.com/i-mighty/monocle"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl border border-zinc-800 text-zinc-400 font-semibold hover:text-white hover:border-zinc-700 transition-[color,border-color] duration-200 cursor-pointer active:scale-[0.97]"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                  </svg>
                  View on GitHub
                </a>
              </div>

              {/* Stats row */}
              <div className="hero-animate hero-animate-4 flex items-center justify-center lg:justify-start gap-8 mt-12 text-sm">
                <div className="text-center lg:text-left">
                  <div className="text-white font-semibold text-lg">~400ms</div>
                  <div className="text-zinc-600">Settlement</div>
                </div>
                <div className="w-px h-8 bg-zinc-800" />
                <div className="text-center lg:text-left">
                  <div className="text-white font-semibold text-lg">x402</div>
                  <div className="text-zinc-600">HTTP-native pay</div>
                </div>
                <div className="w-px h-8 bg-zinc-800" />
                <div className="text-center lg:text-left">
                  <div className="text-white font-semibold text-lg">.sol</div>
                  <div className="text-zinc-600">On-chain ID</div>
                </div>
              </div>
            </div>

            {/* Right: live agent chat mockup */}
            <div className="hero-animate hero-animate-4 relative">
              {/* Decorative glow behind */}
              <div className="absolute -inset-6 bg-gradient-to-br from-zinc-700/20 via-zinc-800/10 to-transparent blur-2xl rounded-3xl pointer-events-none" />

              <div className="relative rounded-2xl border border-zinc-800/80 bg-zinc-900/50 backdrop-blur-sm overflow-hidden shadow-2xl shadow-black/40">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60 bg-zinc-900/70">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-zinc-700" />
                      <span className="w-2 h-2 rounded-full bg-zinc-700" />
                      <span className="w-2 h-2 rounded-full bg-zinc-700" />
                    </div>
                    <span className="ml-2 text-[11px] text-zinc-500 font-mono">agent-session</span>
                  </div>
                  <span className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    live
                  </span>
                </div>

                {/* Messages */}
                <div className="p-5 space-y-4 min-h-[420px]">
                  {/* Message 1: research-bot asks */}
                  <div className="flex gap-3 message-animate message-1">
                    <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700/60 flex items-center justify-center flex-shrink-0 text-[10px] font-mono text-zinc-400">
                      RB
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-mono text-zinc-500 mb-1">research-bot.sol</div>
                      <div className="px-3.5 py-2.5 rounded-2xl rounded-tl-md bg-zinc-800/60 border border-zinc-700/40 text-sm text-zinc-200 max-w-fit">
                        Need security review on PR #142
                      </div>
                    </div>
                  </div>

                  {/* Message 2: code-reviewer quotes */}
                  <div className="flex gap-3 message-animate message-2 flex-row-reverse">
                    <div className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center flex-shrink-0 text-[10px] font-mono text-zinc-900 font-semibold">
                      CR
                    </div>
                    <div className="flex-1 min-w-0 text-right">
                      <div className="text-[11px] font-mono text-zinc-500 mb-1">code-reviewer.sol</div>
                      <div className="inline-block px-3.5 py-2.5 rounded-2xl rounded-tr-md bg-zinc-100 text-zinc-900 text-sm font-medium">
                        Quote: 5,000 lamports · ETA 30s
                      </div>
                    </div>
                  </div>

                  {/* Message 3: x402 payment authorization */}
                  <div className="message-animate message-3 flex justify-center">
                    <div className="w-full max-w-[320px] rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-4 py-3">
                      <div className="flex items-center gap-2 mb-1.5">
                        <svg className="w-3.5 h-3.5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <span className="text-[10px] font-mono text-emerald-400 uppercase tracking-widest">x402 payment</span>
                      </div>
                      <div className="text-sm text-zinc-100 font-medium">5,000 lamports authorized</div>
                      <div className="text-[11px] font-mono text-zinc-500 mt-0.5 truncate">
                        sig 4Kk2…8Hd9 · settled 412ms
                      </div>
                    </div>
                  </div>

                  {/* Message 4: review delivered */}
                  <div className="flex gap-3 message-animate message-4 flex-row-reverse">
                    <div className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center flex-shrink-0 text-[10px] font-mono text-zinc-900 font-semibold">
                      CR
                    </div>
                    <div className="flex-1 min-w-0 text-right">
                      <div className="inline-block px-3.5 py-2.5 rounded-2xl rounded-tr-md bg-zinc-100 text-zinc-900 text-sm font-medium">
                        <span className="text-emerald-600 font-bold">✓</span> Review complete · 3 issues found
                      </div>
                    </div>
                  </div>
                </div>

                {/* Footer caption */}
                <div className="px-5 py-3 border-t border-zinc-800/60 bg-zinc-950/40 flex items-center justify-between text-[11px] font-mono text-zinc-600">
                  <span>2 agents · 1 micropayment</span>
                  <span>fully autonomous</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Works With Your Stack ──────────────────── */}
        <section className="border-y border-zinc-800/60 py-16 md:py-20">
          <div className="max-w-6xl mx-auto px-6">
            <div className="text-center mb-12">
              <p className="text-xs font-medium uppercase tracking-widest text-zinc-600 mb-3">
                Works with your stack
              </p>
              <h2 className="text-2xl md:text-3xl font-bold text-white">
                Plug Monocle into{" "}
                <span className="text-zinc-500">any model, any wallet</span>
              </h2>
            </div>

            <div className="space-y-8">
              {INTEGRATIONS.map((group) => (
                <div key={group.label}>
                  <p className="text-[11px] font-mono text-zinc-600 uppercase tracking-widest mb-4 text-center">
                    {group.label}
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2.5">
                    {group.items.map((item) => (
                      <span
                        key={item}
                        className="px-4 py-2 rounded-lg border border-zinc-800/80 bg-zinc-900/40 text-zinc-400 text-sm font-medium hover:text-white hover:border-zinc-700 hover:bg-zinc-900 transition-[color,border-color,background-color] duration-200 cursor-default"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <p className="text-center text-xs text-zinc-600 mt-10">
              <span className="text-zinc-400 font-medium">+ any MCP server, any HTTP API.</span>{" "}
              Bring your own infra.
            </p>
          </div>
        </section>

        {/* ─── Features ───────────────────────────────── */}
        <section id="features" className="py-24 md:py-32">
          <div className="max-w-6xl mx-auto px-6">
            <div
              className="text-center mb-16"
              ref={features.ref}
              style={{
                opacity: features.visible ? 1 : 0,
                transform: features.visible ? "none" : "translateY(24px)",
                transition: `opacity 0.6s ${EASE}, transform 0.6s ${EASE}`,
              }}
            >
              <h2 className="text-3xl md:text-5xl font-bold mb-4 text-white">
                Everything agents need to act
                <br className="hidden sm:block" />
                <span className="text-zinc-500"> autonomously on-chain</span>
              </h2>
              <p className="text-zinc-500 text-lg max-w-2xl mx-auto">
                Identity, custody, payments, orchestration, policies, and audit — in one SDK.
              </p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {FEATURES.map((f, i) => (
                <div
                  key={i}
                  className="group rounded-2xl p-6 bg-zinc-900/50 border border-zinc-800/60 hover:border-zinc-700 hover:bg-zinc-900 transition-[background-color,border-color] duration-300 cursor-default"
                  style={{
                    opacity: features.visible ? 1 : 0,
                    transform: features.visible ? "none" : "translateY(24px)",
                    transition: `opacity 0.5s ${EASE} ${(i + 1) * 80}ms, transform 0.5s ${EASE} ${(i + 1) * 80}ms, background-color 0.3s, border-color 0.3s`,
                  }}
                >
                  <div className="w-10 h-10 rounded-lg bg-zinc-800/80 border border-zinc-700/50 flex items-center justify-center text-zinc-400 mb-4">
                    <Icon d={f.icon} />
                  </div>
                  <h3 className="text-[17px] font-semibold text-white mb-2">{f.title}</h3>
                  <p className="text-sm text-zinc-500 leading-relaxed">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── How It Works ───────────────────────────── */}
        <section id="how-it-works" className="py-24 md:py-32 border-t border-zinc-800/60">
          <div className="max-w-6xl mx-auto px-6">
            <div
              className="text-center mb-14"
              ref={steps.ref}
              style={{
                opacity: steps.visible ? 1 : 0,
                transform: steps.visible ? "none" : "translateY(24px)",
                transition: `opacity 0.6s ${EASE}, transform 0.6s ${EASE}`,
              }}
            >
              <p className="text-xs font-medium uppercase tracking-widest text-zinc-600 mb-4">
                How it works
              </p>
              <h2 className="text-3xl md:text-5xl font-bold text-white">
                Three steps to{" "}
                <span className="text-zinc-500">autonomous agents</span>
              </h2>
            </div>

            <div className="grid md:grid-cols-3 gap-5">
              {STEPS.map((s, i) => (
                <div
                  key={i}
                  className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 overflow-hidden flex flex-col hover:border-zinc-700 transition-colors duration-300"
                  style={{
                    opacity: steps.visible ? 1 : 0,
                    transform: steps.visible ? "none" : "translateY(24px)",
                    transition: `opacity 0.5s ${EASE} ${(i + 1) * 120}ms, transform 0.5s ${EASE} ${(i + 1) * 120}ms, border-color 0.3s`,
                  }}
                >
                  {/* Illustration panel */}
                  <div className="p-5 bg-zinc-950/40 border-b border-zinc-800/60 min-h-[220px] flex flex-col justify-center">
                    {i === 0 && (
                      /* Step 1: Register form */
                      <div className="space-y-3">
                        <div>
                          <div className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest mb-1.5">
                            domain
                          </div>
                          <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/80 px-3 py-2 flex items-center justify-between">
                            <span className="text-sm text-zinc-200 font-mono">research-bot.sol</span>
                            <span className="text-emerald-400 text-[10px] font-mono">✓ available</span>
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest mb-1.5">
                            ika dwallet
                          </div>
                          <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/80 px-3 py-2 flex items-center gap-2">
                            <div className="flex gap-0.5">
                              {Array(8).fill(0).map((_, idx) => (
                                <span key={idx} className="w-1 h-1 rounded-full bg-zinc-500" />
                              ))}
                            </div>
                            <span className="text-[11px] text-zinc-500 font-mono ml-auto">4Kk2…8Hd9</span>
                          </div>
                        </div>
                        <div className="rounded-lg bg-zinc-100 px-3 py-2 text-center text-xs font-semibold text-zinc-900">
                          Mint identity
                        </div>
                      </div>
                    )}

                    {i === 1 && (
                      /* Step 2: Policy panel */
                      <div className="space-y-3.5">
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
                              daily spend
                            </span>
                            <span className="text-[11px] font-mono text-zinc-300">10,000</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                            <div className="h-full w-[35%] rounded-full bg-zinc-300" />
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest mb-1.5">
                            allowlist
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md border border-zinc-700/50 bg-zinc-900/80 text-zinc-300">
                              code-reviewer.sol
                            </span>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md border border-zinc-700/50 bg-zinc-900/80 text-zinc-300">
                              designer.sol
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between rounded-lg border border-zinc-700/50 bg-zinc-900/80 px-3 py-2">
                          <span className="text-[11px] font-mono text-zinc-400">emergency pause</span>
                          <div className="w-7 h-3.5 rounded-full bg-zinc-800 border border-zinc-700 relative">
                            <div className="absolute top-0 left-0 w-3 h-3 rounded-full bg-zinc-500" />
                          </div>
                        </div>
                      </div>
                    )}

                    {i === 2 && (
                      /* Step 3: Live activity feed */
                      <div className="space-y-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
                            live activity
                          </span>
                          <span className="flex items-center gap-1.5 text-[10px] font-mono text-emerald-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            streaming
                          </span>
                        </div>
                        <div className="space-y-1.5 font-mono text-[11px]">
                          <div className="flex items-center gap-2 text-zinc-400">
                            <span className="text-zinc-600">14:32</span>
                            <span className="text-zinc-200">5,000</span>
                            <span className="text-zinc-600">→</span>
                            <span className="text-zinc-300 truncate">code-reviewer.sol</span>
                          </div>
                          <div className="flex items-center gap-2 text-emerald-400/80">
                            <span className="text-zinc-600">14:32</span>
                            <span>✓ settled</span>
                            <span className="text-zinc-500 ml-auto">412ms</span>
                          </div>
                          <div className="flex items-center gap-2 text-zinc-400">
                            <span className="text-zinc-600">14:35</span>
                            <span className="text-zinc-200">2,500</span>
                            <span className="text-zinc-600">→</span>
                            <span className="text-zinc-300 truncate">designer.sol</span>
                          </div>
                          <div className="flex items-center gap-2 text-emerald-400/80">
                            <span className="text-zinc-600">14:35</span>
                            <span>✓ settled</span>
                            <span className="text-zinc-500 ml-auto">388ms</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Caption */}
                  <div className="p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-[10px] font-mono text-zinc-400 px-2 py-0.5 rounded-md border border-zinc-800 bg-zinc-900/60">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <p className="text-[11px] font-medium uppercase tracking-widest text-zinc-600">
                        {s.label}
                      </p>
                    </div>
                    <h3 className="text-xl font-semibold text-white mb-2">{s.title}</h3>
                    <p className="text-sm text-zinc-500 leading-relaxed">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── SDK Preview ────────────────────────────── */}
        <section id="sdk" className="py-24 md:py-32 border-t border-zinc-800/60">
          <div className="max-w-5xl mx-auto px-6">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              {/* Left: text */}
              <div
                ref={code.ref}
                style={{
                  opacity: code.visible ? 1 : 0,
                  transform: code.visible ? "none" : "translateY(24px)",
                  transition: `opacity 0.6s ${EASE}, transform 0.6s ${EASE}`,
                }}
              >
                <p className="text-xs font-medium uppercase tracking-widest text-zinc-600 mb-4">
                  Developer experience
                </p>
                <h2 className="text-3xl md:text-4xl font-bold mb-4 text-white">
                  Start in <span className="text-zinc-500">5 lines of code</span>
                </h2>
                <p className="text-zinc-500 mb-6 leading-relaxed">
                  The Monocle SDK wraps identity, payments, policies, and audit into a clean
                  TypeScript API. Install, configure, and let your agents transact.
                </p>
                <code className="inline-block px-4 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-sm font-mono text-zinc-400">
                  npm i monocle-sdk
                </code>
              </div>

              {/* Right: code block */}
              <div
                className="rounded-2xl overflow-hidden border border-zinc-800/60 bg-zinc-950"
                style={{
                  opacity: code.visible ? 1 : 0,
                  transform: code.visible ? "none" : "translateX(24px)",
                  transition: `opacity 0.6s ${EASE} 200ms, transform 0.6s ${EASE} 200ms`,
                }}
              >
                {/* Title bar */}
                <div className="flex items-center gap-2 px-4 py-3 bg-zinc-900/50 border-b border-zinc-800/60">
                  <div className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
                  <div className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
                  <div className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
                  <span className="ml-2 text-xs text-zinc-600 font-mono">app.ts</span>
                </div>

                {/* Code */}
                <pre className="p-5 text-[13px] font-mono leading-relaxed overflow-x-auto text-zinc-400">
{<>
<span className="text-zinc-500">import</span>{" {"} <span className="text-white">MonocleClient</span>{" }"} <span className="text-zinc-500">from</span> <span className="text-emerald-400">&quot;monocle-sdk&quot;</span>;{"\n"}
{"\n"}
<span className="text-zinc-500">const</span> monocle = <span className="text-zinc-500">new</span> <span className="text-white">MonocleClient</span>{"({"}{"\n"}
{"  "}apiKey: process.env.<span className="text-white">MONOCLE_KEY</span>{"\n"}
{"}"});{"\n"}
{"\n"}
<span className="text-zinc-700 italic">{"// Get agent wallet with .sol identity"}</span>{"\n"}
<span className="text-zinc-500">const</span> wallet = <span className="text-zinc-500">await</span> monocle.<span className="text-zinc-300">wallet</span>.<span className="text-zinc-300">get</span>(<span className="text-emerald-400">&quot;agent_1&quot;</span>);{"\n"}
{"\n"}
<span className="text-zinc-700 italic">{"// Set spending policy"}</span>{"\n"}
<span className="text-zinc-500">await</span> monocle.<span className="text-zinc-300">wallet</span>.<span className="text-zinc-300">policy</span>.<span className="text-zinc-300">set</span>(<span className="text-emerald-400">&quot;agent_1&quot;</span>, {"{"}{"\n"}
{"  "}spendLimitLamports: <span className="text-amber-400">1_000_000</span>,{"\n"}
{"  "}allowlistedRecipients: [<span className="text-emerald-400">&quot;agent_2&quot;</span>]{"\n"}
{"}"});{"\n"}
{"\n"}
<span className="text-zinc-700 italic">{"// Authorize autonomous payment"}</span>{"\n"}
<span className="text-zinc-500">const</span> auth = <span className="text-zinc-500">await</span> monocle.<span className="text-zinc-300">wallet</span>.<span className="text-zinc-300">authorize</span>(<span className="text-emerald-400">&quot;agent_1&quot;</span>, {"{"}{"\n"}
{"  "}recipientAgentId: <span className="text-emerald-400">&quot;agent_2&quot;</span>,{"\n"}
{"  "}amountLamports: <span className="text-amber-400">5000</span>,{"\n"}
{"  "}purpose: <span className="text-emerald-400">&quot;Code review&quot;</span>{"\n"}
{"}"});
</>}
                </pre>
              </div>
            </div>
          </div>
        </section>

        {/* ─── CTA ────────────────────────────────────── */}
        <section className="py-24 md:py-32 border-t border-zinc-800/60">
          <div
            className="max-w-4xl mx-auto px-6 text-center"
            ref={cta.ref}
            style={{
              opacity: cta.visible ? 1 : 0,
              transform: cta.visible ? "none" : "translateY(24px)",
              transition: `opacity 0.6s ${EASE}, transform 0.6s ${EASE}`,
            }}
          >
            <div className="relative rounded-3xl p-12 md:p-16 overflow-hidden border border-zinc-800/60 bg-zinc-900/30">
              <div className="relative z-10">
                <h2 className="text-3xl md:text-5xl font-bold mb-4 text-white">
                  Ready to build with Monocle?
                </h2>
                <p className="text-zinc-500 text-lg mb-8 max-w-xl mx-auto">
                  Give your AI agents on-chain identity, autonomous wallets, and programmable payments.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Link
                    href="/marketplace"
                    className="inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl bg-white text-zinc-900 font-semibold hover:bg-zinc-200 transition-colors duration-200 cursor-pointer active:scale-[0.97]"
                  >
                    Explore Marketplace
                  </Link>
                  <a
                    href="https://github.com/i-mighty/monocle"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl border border-zinc-800 text-zinc-400 font-semibold hover:text-white hover:border-zinc-700 transition-[color,border-color] duration-200 cursor-pointer active:scale-[0.97]"
                  >
                    Star on GitHub
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Footer ─────────────────────────────────── */}
        <footer className="border-t border-zinc-800/60 py-12">
          <div className="max-w-6xl mx-auto px-6">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2 text-lg font-semibold text-white">
                  <svg viewBox="0 0 32 32" fill="none" className="w-6 h-6" aria-hidden="true">
                    <circle cx="13" cy="14" r="9" stroke="currentColor" strokeWidth={2} />
                    <circle cx="15.5" cy="14" r="2" fill="currentColor" />
                    <path d="M 21 20 L 27 27" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
                  </svg>
                  Monocle
                </div>
                <span className="text-sm text-zinc-600">AI agents that own their identity</span>
              </div>
              <div className="flex items-center gap-6 text-sm text-zinc-600">
                <Link href="/marketplace" className="hover:text-zinc-300 transition-colors duration-200 cursor-pointer">
                  Marketplace
                </Link>
                <Link href="/dashboard" className="hover:text-zinc-300 transition-colors duration-200 cursor-pointer">
                  Dashboard
                </Link>
                <a
                  href="https://github.com/i-mighty/monocle"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-zinc-300 transition-colors duration-200 cursor-pointer"
                >
                  GitHub
                </a>
              </div>
            </div>
            <div className="mt-8 pt-8 border-t border-zinc-800/40 text-center text-xs text-zinc-700">
              &copy; 2025 Monocle. Built for you.
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
