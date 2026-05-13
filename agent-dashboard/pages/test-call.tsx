import { useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";

const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "/api/proxy";

interface MarketplaceAgent {
  id: string;
  name: string;
  ratePer1kTokens: number;
  verified: boolean;
}

interface CallResult {
  callerId: string;
  calleeId: string;
  toolName: string;
  tokensUsed: number;
  costLamports: number;
  ratePer1kTokens: number;
  usageId: string;
}

const COMMON_TOOLS = [
  "review",
  "research",
  "summarize",
  "translate",
  "generate_image",
  "solve",
  "write",
];

export default function TestCall() {
  const router = useRouter();
  const [agents, setAgents] = useState<MarketplaceAgent[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [callerId, setCallerId] = useState("");
  const [calleeId, setCalleeId] = useState("");
  const [toolName, setToolName] = useState(COMMON_TOOLS[0]);
  const [tokens, setTokens] = useState("500");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CallResult | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/v1/agents/marketplace?limit=100`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`Marketplace fetch ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (!d.success) throw new Error(d?.error?.message ?? "Marketplace returned an error");
        setAgents(d.data.agents);
        // Pre-select the first two if available
        if (d.data.agents.length >= 2) {
          setCallerId(d.data.agents[0].id);
          setCalleeId(d.data.agents[1].id);
        }
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Failed to load agents"));
  }, []);

  // Preselect via ?caller=&callee= from URL
  useEffect(() => {
    const c = typeof router.query.caller === "string" ? router.query.caller : null;
    const cl = typeof router.query.callee === "string" ? router.query.callee : null;
    if (c) setCallerId(c);
    if (cl) setCalleeId(cl);
  }, [router.query.caller, router.query.callee]);

  const callee = agents.find((a) => a.id === calleeId);
  const estTokens = Number(tokens) || 0;
  const estCost = callee && estTokens > 0
    ? Math.floor((estTokens * callee.ratePer1kTokens) / 1000)
    : 0;

  const handleFire = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);

    if (!callerId || !calleeId) {
      setError("Pick both a caller and a callee");
      return;
    }
    if (callerId === calleeId) {
      setError("Caller and callee must be different agents");
      return;
    }
    if (!toolName.trim()) {
      setError("Tool name is required");
      return;
    }
    const tk = Number(tokens);
    if (!Number.isFinite(tk) || tk <= 0) {
      setError("Tokens used must be a positive number");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/v1/meter/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          callerId,
          calleeId,
          toolName: toolName.trim(),
          tokensUsed: tk,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? data?.error?.message ?? `Request failed (${res.status})`);
      }
      setResult(data as CallResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Call failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Head>
        <title>Run a test call — Monocle</title>
      </Head>

      <div className="min-h-screen bg-[#09090b] text-white antialiased font-sans">
        <header className="border-b border-zinc-800/60">
          <div className="max-w-3xl mx-auto px-6 h-14 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight text-white">
              <svg viewBox="0 0 32 32" fill="none" className="w-6 h-6" aria-hidden="true">
                <circle cx="13" cy="14" r="9" stroke="currentColor" strokeWidth={2} />
                <circle cx="15.5" cy="14" r="2" fill="currentColor" />
                <path d="M 21 20 L 27 27" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
              </svg>
              Monocle
            </Link>
            <div className="flex items-center gap-5 text-sm">
              <Link href="/marketplace" className="text-zinc-500 hover:text-white transition-colors">Marketplace</Link>
              <Link href="/usage" className="text-zinc-500 hover:text-white transition-colors">Usage</Link>
              <Link href="/receipts" className="text-zinc-500 hover:text-white transition-colors">Receipts</Link>
            </div>
          </div>
        </header>

        <main className="max-w-2xl mx-auto px-6 py-12">
          <div className="mb-8">
            <p className="text-xs font-medium uppercase tracking-widest text-zinc-600 mb-2">Test harness</p>
            <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Run a real agent call</h1>
            <p className="text-zinc-500 leading-relaxed">
              Fire a real meter/execute call between two registered agents. Writes a {`tool_usage`} row,
              deducts from the caller, credits the callee. Platform takes a 5% fee at settlement.
            </p>
          </div>

          {loadError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300 mb-6">
              {loadError}
            </div>
          )}

          <form onSubmit={handleFire} className="space-y-6">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">Caller (pays)</label>
                <select
                  value={callerId}
                  onChange={(e) => setCallerId(e.target.value)}
                  className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white text-sm focus:outline-none focus:border-zinc-600"
                >
                  <option value="">— select —</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.name || a.id}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">Callee (earns)</label>
                <select
                  value={calleeId}
                  onChange={(e) => setCalleeId(e.target.value)}
                  className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white text-sm focus:outline-none focus:border-zinc-600"
                >
                  <option value="">— select —</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.name || a.id}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">Tool name</label>
              <input
                type="text"
                value={toolName}
                onChange={(e) => setToolName(e.target.value)}
                list="common-tools"
                className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white text-sm font-mono placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
              />
              <datalist id="common-tools">
                {COMMON_TOOLS.map((t) => <option key={t} value={t} />)}
              </datalist>
              <p className="text-xs text-zinc-600 mt-1.5">Free-form. Use any string the callee recognises.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">Tokens used</label>
              <input
                type="number"
                min={1}
                value={tokens}
                onChange={(e) => setTokens(e.target.value)}
                className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white text-sm focus:outline-none focus:border-zinc-600"
              />
              {callee && estTokens > 0 && (
                <p className="text-xs text-zinc-500 mt-1.5">
                  Estimated cost at <span className="font-mono text-zinc-300">{callee.ratePer1kTokens}</span> lamports/1k:
                  {" "}<span className="font-mono text-white">{estCost.toLocaleString()}</span> lamports
                </p>
              )}
            </div>

            {error && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || agents.length === 0}
              className="w-full px-6 py-3 rounded-xl bg-white text-zinc-900 font-semibold text-sm hover:bg-zinc-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {submitting ? "Firing call…" : "Fire call →"}
            </button>
          </form>

          {result && (
            <div className="mt-8 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6">
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-emerald-400 mb-3">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Call recorded
              </div>
              <h2 className="text-xl font-bold text-white mb-4">
                {result.callerId} → {result.calleeId}
              </h2>
              <dl className="grid sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-1">Tool</dt>
                  <dd className="text-zinc-200 font-mono">{result.toolName}</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-1">Tokens</dt>
                  <dd className="text-zinc-200 font-mono">{result.tokensUsed.toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-1">Cost</dt>
                  <dd className="text-white font-mono font-semibold">{result.costLamports.toLocaleString()} lamports</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-1">Rate</dt>
                  <dd className="text-zinc-200 font-mono">{result.ratePer1kTokens.toLocaleString()} / 1k tokens</dd>
                </div>
              </dl>
              <p className="text-[11px] font-mono text-zinc-600 mt-4 break-all">
                usage_id: {result.usageId}
              </p>
              <div className="flex flex-wrap items-center gap-3 mt-5">
                <Link
                  href={`/agents/${encodeURIComponent(result.calleeId)}`}
                  className="text-sm text-zinc-400 hover:text-white transition-colors"
                >
                  See {result.calleeId}'s pending →
                </Link>
                <Link
                  href="/usage"
                  className="text-sm text-zinc-400 hover:text-white transition-colors"
                >
                  See platform totals →
                </Link>
              </div>
              <button
                type="button"
                onClick={() => setResult(null)}
                className="mt-5 text-xs text-zinc-500 hover:text-white underline transition-colors"
              >
                Run another
              </button>
            </div>
          )}
        </main>
      </div>
    </>
  );
}
