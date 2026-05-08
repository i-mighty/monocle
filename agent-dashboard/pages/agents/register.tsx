import { useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Link from "next/link";

const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "/api/proxy";

interface FormState {
  agentId: string;
  name: string;
  ratePer1kTokens: string;
  publicKey: string;
}

export default function RegisterAgent() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({
    agentId: "",
    name: "",
    ratePer1kTokens: "1000",
    publicKey: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((s) => ({ ...s, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const agentId = form.agentId.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
    if (!agentId) {
      setError("Agent ID is required");
      return;
    }

    const rate = Number(form.ratePer1kTokens);
    if (!Number.isFinite(rate) || rate <= 0) {
      setError("Rate must be a positive number (lamports per 1k tokens)");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/v1/agents/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId,
          name: form.name.trim() || agentId,
          ratePer1kTokens: rate,
          publicKey: form.publicKey.trim() || undefined,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data?.error?.message || `Request failed (${res.status})`);
      }

      // Redirect to the agent detail page
      router.push(`/agents/${agentId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
      setSubmitting(false);
    }
  };

  return (
    <>
      <Head>
        <title>Register Agent — Monocle</title>
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
            <Link href="/dashboard" className="text-sm text-zinc-500 hover:text-white transition-colors">
              ← Back to dashboard
            </Link>
          </div>
        </header>

        <main className="max-w-2xl mx-auto px-6 py-12">
          <div className="mb-8">
            <p className="text-xs font-medium uppercase tracking-widest text-zinc-600 mb-2">New agent</p>
            <h1 className="text-3xl font-bold text-white mb-2">Register an agent</h1>
            <p className="text-zinc-500 leading-relaxed">
              Create an on-chain identity and a billing record for your agent. You can attach an Ika dWallet,
              SNS domain, and a Solana endpoint after registration.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">
                Agent ID <span className="text-zinc-600 font-normal">· lowercase, hyphen-separated</span>
              </label>
              <input
                type="text"
                value={form.agentId}
                onChange={(e) => update("agentId", e.target.value)}
                placeholder="research-bot"
                required
                className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
              />
              <p className="text-xs text-zinc-600 mt-1.5">Unique identifier. Becomes the slug in URLs.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">Display name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                placeholder="Research Bot"
                className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
              />
              <p className="text-xs text-zinc-600 mt-1.5">Optional. Defaults to the agent ID.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">Default rate</label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={1}
                  value={form.ratePer1kTokens}
                  onChange={(e) => update("ratePer1kTokens", e.target.value)}
                  className="flex-1 px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white text-sm focus:outline-none focus:border-zinc-600"
                />
                <span className="text-sm text-zinc-500 font-mono whitespace-nowrap">lamports / 1k tokens</span>
              </div>
              <p className="text-xs text-zinc-600 mt-1.5">Per-tool rates can override this later.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">
                Solana public key <span className="text-zinc-600 font-normal">· optional</span>
              </label>
              <input
                type="text"
                value={form.publicKey}
                onChange={(e) => update("publicKey", e.target.value)}
                placeholder="Paste a base58 wallet address for settlement"
                className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white text-sm font-mono placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
              />
              <p className="text-xs text-zinc-600 mt-1.5">Where settlements get sent. Add later if you don't have one yet.</p>
            </div>

            {error && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={submitting}
                className="px-6 py-3 rounded-xl bg-white text-zinc-900 font-semibold text-sm hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer active:scale-[0.97]"
              >
                {submitting ? "Registering…" : "Register agent"}
              </button>
              <Link href="/marketplace" className="text-sm text-zinc-500 hover:text-white transition-colors">
                Or browse the marketplace
              </Link>
            </div>
          </form>
        </main>
      </div>
    </>
  );
}
