import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Link from "next/link";

const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "/api/proxy";

const TASK_TYPES: { id: string; label: string }[] = [
  { id: "code", label: "Code" },
  { id: "research", label: "Research" },
  { id: "reasoning", label: "Reasoning" },
  { id: "writing", label: "Writing" },
  { id: "math", label: "Math" },
  { id: "translation", label: "Translation" },
  { id: "image", label: "Image" },
  { id: "audio", label: "Audio" },
  { id: "general", label: "General" },
];
const MAX_CATEGORIES = 5;

interface AgentDetail {
  agentId: string;
  name: string | null;
  publicKey: string | null;
  ratePer1kTokens: number;
  categories?: string[];
  bio?: string | null;
  endpointUrl?: string | null;
}

export default function EditAgent() {
  const router = useRouter();
  const slug = typeof router.query.slug === "string" ? router.query.slug : "";

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [original, setOriginal] = useState<AgentDetail | null>(null);

  const [name, setName] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [ratePer1kTokens, setRate] = useState("1000");
  const [categories, setCategories] = useState<string[]>([]);
  const [bio, setBio] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<{ ok: boolean; status?: number; latencyMs?: number; error?: string } | null>(null);

  const testEndpoint = async () => {
    const url = endpointUrl.trim();
    if (!url) {
      setProbe({ ok: false, error: "Enter a URL first" });
      return;
    }
    setProbing(true);
    setProbe(null);
    try {
      const res = await fetch(`${API_URL}/v1/agents/test-endpoint`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setProbe({ ok: false, error: data?.error?.message ?? `Request failed (${res.status})` });
      } else {
        setProbe(data.data);
      }
    } catch (err) {
      setProbe({ ok: false, error: err instanceof Error ? err.message : "Probe failed" });
    } finally {
      setProbing(false);
    }
  };

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    fetch(`${API_URL}/v1/agents/${encodeURIComponent(slug)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Backend responded ${res.status}`);
        return res.json();
      })
      .then((d) => {
        if (!d.success) throw new Error(d?.error?.message || "Failed to load agent");
        const a: AgentDetail = d.data;
        setOriginal(a);
        setName(a.name ?? "");
        setPublicKey(a.publicKey ?? "");
        setRate(String(a.ratePer1kTokens ?? 1000));
        setCategories(a.categories ?? []);
        setBio(a.bio ?? "");
        setEndpointUrl(a.endpointUrl ?? "");
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [slug]);

  const dirty = useMemo(() => {
    if (!original) return false;
    return (
      name !== (original.name ?? "") ||
      publicKey !== (original.publicKey ?? "") ||
      Number(ratePer1kTokens) !== original.ratePer1kTokens ||
      JSON.stringify([...categories].sort()) !== JSON.stringify([...(original.categories ?? [])].sort()) ||
      bio !== (original.bio ?? "") ||
      endpointUrl !== (original.endpointUrl ?? "")
    );
  }, [original, name, publicKey, ratePer1kTokens, categories, bio, endpointUrl]);

  const toggleCategory = (id: string) => {
    setCategories((cs) => {
      if (cs.includes(id)) return cs.filter((c) => c !== id);
      if (cs.length >= MAX_CATEGORIES) return cs;
      return [...cs, id];
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);

    const rate = Number(ratePer1kTokens);
    if (!Number.isFinite(rate) || rate <= 0) {
      setSaveError("Rate must be a positive number");
      return;
    }

    const endpoint = endpointUrl.trim();
    if (endpoint && !/^https?:\/\/.+/i.test(endpoint)) {
      setSaveError("Endpoint URL must start with https:// (or http:// for local dev)");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/v1/agents/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || null,
          publicKey: publicKey.trim() || null,
          ratePer1kTokens: rate,
          categories,
          bio: bio.trim() || null,
          endpointUrl: endpoint || null,
        }),
      });
      const d = await res.json();
      if (!res.ok || !d.success) {
        throw new Error(d?.error?.message || `Request failed (${res.status})`);
      }
      router.push(`/agents/${encodeURIComponent(slug)}`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
      setSubmitting(false);
    }
  };

  return (
    <>
      <Head>
        <title>{original ? `Edit ${original.name || original.agentId}` : "Edit agent"} — Monocle</title>
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
            <Link
              href={`/agents/${encodeURIComponent(slug)}`}
              className="text-sm text-zinc-500 hover:text-white transition-colors"
            >
              ← Back to agent
            </Link>
          </div>
        </header>

        <main className="max-w-2xl mx-auto px-6 py-12">
          {loading && (
            <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-12 text-center text-zinc-500">
              Loading agent…
            </div>
          )}

          {!loading && loadError && (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-8 text-red-300">
              {loadError}
            </div>
          )}

          {!loading && original && (
            <>
              <div className="mb-8">
                <p className="text-xs font-medium uppercase tracking-widest text-zinc-600 mb-2">Edit agent</p>
                <h1 className="text-3xl font-bold text-white mb-1 tracking-tight">{original.name || original.agentId}</h1>
                <p className="text-sm font-mono text-zinc-500">{original.agentId}</p>
              </div>

              <form onSubmit={handleSave} className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-2">Display name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={original.agentId}
                    className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-2">Bio <span className="text-zinc-600 font-normal">· optional</span></label>
                  <textarea
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    rows={3}
                    maxLength={1000}
                    placeholder="What does this agent do? Marketplace listings show this."
                    className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 resize-none"
                  />
                  <p className="text-xs text-zinc-600 mt-1.5">{bio.length}/1000</p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-zinc-300">Task types</label>
                    <span className="text-xs font-mono text-zinc-600">{categories.length}/{MAX_CATEGORIES}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {TASK_TYPES.map((t) => {
                      const selected = categories.includes(t.id);
                      const disabled = !selected && categories.length >= MAX_CATEGORIES;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => toggleCategory(t.id)}
                          disabled={disabled}
                          className={[
                            "px-3.5 py-2 rounded-lg border text-sm font-medium transition-colors cursor-pointer",
                            selected
                              ? "border-white bg-white text-zinc-900"
                              : disabled
                              ? "border-zinc-800 bg-zinc-900/30 text-zinc-700 cursor-not-allowed"
                              : "border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:text-white hover:border-zinc-700",
                          ].join(" ")}
                        >
                          {t.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-2">Default rate</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min={1}
                      value={ratePer1kTokens}
                      onChange={(e) => setRate(e.target.value)}
                      className="flex-1 px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white text-sm focus:outline-none focus:border-zinc-600"
                    />
                    <span className="text-sm text-zinc-500 font-mono whitespace-nowrap">lamports / 1k tokens</span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-2">
                    Solana public key <span className="text-zinc-600 font-normal">· settlement wallet</span>
                  </label>
                  <input
                    type="text"
                    value={publicKey}
                    onChange={(e) => setPublicKey(e.target.value)}
                    placeholder="Paste a base58 wallet address"
                    className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white text-sm font-mono placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-2">
                    Endpoint URL <span className="text-zinc-600 font-normal">· where callers reach your agent</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="url"
                      value={endpointUrl}
                      onChange={(e) => { setEndpointUrl(e.target.value); setProbe(null); }}
                      placeholder="https://your-agent.example.com"
                      className="flex-1 px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white text-sm font-mono placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
                    />
                    <button
                      type="button"
                      onClick={testEndpoint}
                      disabled={probing || !endpointUrl.trim()}
                      className="px-4 py-3 rounded-xl border border-zinc-800 text-zinc-400 font-semibold text-sm hover:text-white hover:border-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
                    >
                      {probing ? "Testing…" : "Test"}
                    </button>
                  </div>
                  {probe && (
                    <div
                      className={[
                        "mt-2 rounded-lg border px-3 py-2 text-xs",
                        probe.ok
                          ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
                          : "border-red-500/30 bg-red-500/5 text-red-300",
                      ].join(" ")}
                    >
                      {probe.ok ? (
                        <>✓ Reachable — HTTP {probe.status} in {probe.latencyMs}ms</>
                      ) : (
                        <>✗ {probe.error || `HTTP ${probe.status}`}</>
                      )}
                    </div>
                  )}
                  <p className="text-xs text-zinc-600 mt-1.5">
                    Public HTTPS endpoint. Required for marketplace listing — our verifier pings it every 15 min.
                  </p>
                </div>

                {saveError && (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
                    {saveError}
                  </div>
                )}

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={submitting || !dirty}
                    className="px-6 py-3 rounded-xl bg-white text-zinc-900 font-semibold text-sm hover:bg-zinc-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer active:scale-[0.97]"
                  >
                    {submitting ? "Saving…" : dirty ? "Save changes" : "No changes"}
                  </button>
                  <Link
                    href={`/agents/${encodeURIComponent(slug)}`}
                    className="text-sm text-zinc-500 hover:text-white transition-colors"
                  >
                    Cancel
                  </Link>
                </div>
              </form>
            </>
          )}
        </main>
      </div>
    </>
  );
}
