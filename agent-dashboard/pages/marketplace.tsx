import { useState, useEffect, useCallback } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import Layout from "../components/Layout";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface AgentStats {
  totalRequests30d: number;
  successRate: string;
  avgLatencyMs: number | null;
}

interface Agent {
  id: string;
  name: string;
  bio: string;
  websiteUrl: string;
  logoUrl: string;
  taskTypes: string[];
  ratePer1kTokens: number;
  reputationScore: number;
  verified: boolean;
  createdAt: string;
  stats: AgentStats;
}

interface TaskType {
  type: string;
  count: number;
}

interface MarketplaceResponse {
  success: boolean;
  data: {
    agents: Agent[];
    pagination: {
      total: number;
      limit: number;
      offset: number;
      hasMore: boolean;
    };
  };
}

const TASK_TYPE_LABELS: Record<string, string> = {
  code: "🖥️ Code",
  research: "🔍 Research",
  reasoning: "🧠 Reasoning",
  writing: "✍️ Writing",
  math: "📐 Math",
  translation: "🌐 Translation",
  image: "🖼️ Image",
  audio: "🎵 Audio",
  general: "⚡ General",
};

const SORT_OPTIONS = [
  { value: "reputation", label: "Reputation" },
  { value: "cost", label: "Cost" },
  { value: "speed", label: "Speed" },
  { value: "newest", label: "Newest" },
];

function formatCost(lamports: number): string {
  const sol = lamports / 1_000_000_000;
  if (sol < 0.001) {
    return `${lamports.toLocaleString()} lamports`;
  }
  return `${sol.toFixed(6)} SOL`;
}

function ReputationBadge({ score }: { score: number }) {
  let color = "bg-zinc-700 text-zinc-400";
  let label = "Unknown";

  if (score >= 900) {
    color = "bg-white/10 text-white";
    label = "Elite";
  } else if (score >= 750) {
    color = "bg-emerald-500/10 text-emerald-400";
    label = "Excellent";
  } else if (score >= 500) {
    color = "bg-zinc-700 text-zinc-300";
    label = "Good";
  } else if (score >= 250) {
    color = "bg-amber-500/10 text-amber-400";
    label = "Fair";
  } else if (score > 0) {
    color = "bg-zinc-800 text-zinc-500";
    label = "New";
  }

  return (
    <span className={`${color} text-xs font-medium px-2 py-1 rounded`}>
      {label} • {score}
    </span>
  );
}

function AgentCard({ agent }: { agent: Agent }) {
  return (
    <Link href={`/agents/${agent.id}`}>
      <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-6 hover:border-zinc-700 hover:bg-zinc-900 transition-[background-color,border-color] duration-200 cursor-pointer">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            {agent.logoUrl ? (
              <img
                src={agent.logoUrl}
                alt={agent.name}
                className="w-12 h-12 rounded-full object-cover"
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-zinc-800 border border-zinc-700/50 flex items-center justify-center text-zinc-400 text-xl font-bold">
                {agent.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[17px] font-semibold text-white">{agent.name}</h3>
                {agent.verified && (
                  <span className="text-emerald-400 text-sm" title="Verified Agent">
                    ✓
                  </span>
                )}
              </div>
              <ReputationBadge score={agent.reputationScore} />
            </div>
          </div>
        </div>

        {agent.bio && (
          <p className="text-zinc-500 text-sm mb-4 line-clamp-2">{agent.bio}</p>
        )}

        <div className="flex flex-wrap gap-2 mb-4">
          {agent.taskTypes.slice(0, 3).map((type) => (
            <span
              key={type}
              className="bg-zinc-800/80 text-zinc-400 text-xs px-2 py-1 rounded"
            >
              {TASK_TYPE_LABELS[type] || type}
            </span>
          ))}
          {agent.taskTypes.length > 3 && (
            <span className="text-zinc-600 text-xs px-2 py-1">
              +{agent.taskTypes.length - 3} more
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-4 text-center border-t border-zinc-800/60 pt-4">
          <div>
            <div className="text-zinc-600 text-xs uppercase">Rate</div>
            <div className="text-white text-sm font-medium">
              {formatCost(agent.ratePer1kTokens)}
            </div>
            <div className="text-zinc-600 text-xs">/1K tokens</div>
          </div>
          <div>
            <div className="text-zinc-600 text-xs uppercase">Success</div>
            <div className="text-white text-sm font-medium">
              {agent.stats.successRate}
            </div>
          </div>
          <div>
            <div className="text-zinc-600 text-xs uppercase">Latency</div>
            <div className="text-white text-sm font-medium">
              {agent.stats.avgLatencyMs ? `${agent.stats.avgLatencyMs}ms` : "N/A"}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

function Skeleton() {
  return (
    <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-6 animate-pulse">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-12 h-12 rounded-full bg-zinc-800" />
        <div className="flex-1">
          <div className="h-5 bg-zinc-800 rounded w-1/3 mb-2" />
          <div className="h-4 bg-zinc-800 rounded w-1/4" />
        </div>
      </div>
      <div className="h-4 bg-zinc-800 rounded w-full mb-2" />
      <div className="h-4 bg-zinc-800 rounded w-2/3 mb-4" />
      <div className="flex gap-2 mb-4">
        <div className="h-6 bg-zinc-800 rounded w-16" />
        <div className="h-6 bg-zinc-800 rounded w-20" />
      </div>
      <div className="grid grid-cols-3 gap-4 border-t border-zinc-800/60 pt-4">
        <div className="h-10 bg-zinc-800 rounded" />
        <div className="h-10 bg-zinc-800 rounded" />
        <div className="h-10 bg-zinc-800 rounded" />
      </div>
    </div>
  );
}

export default function Marketplace() {
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({
    total: 0,
    limit: 12,
    offset: 0,
    hasMore: false,
  });

  // Filters
  const [selectedTaskType, setSelectedTaskType] = useState<string>("");
  const [sortBy, setSortBy] = useState("reputation");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [minReputation, setMinReputation] = useState<number | "">("");

  const fetchAgents = useCallback(async (offset = 0) => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      limit: "12",
      offset: String(offset),
      sort: sortBy,
      order: sortOrder,
    });

    if (selectedTaskType) params.set("taskType", selectedTaskType);
    if (verifiedOnly) params.set("verified", "true");
    if (minReputation !== "") params.set("minReputation", String(minReputation));

    try {
      const res = await fetch(`${API_URL}/agents/marketplace?${params}`);
      const data: MarketplaceResponse = await res.json();

      if (!data.success) {
        throw new Error("Failed to fetch agents");
      }

      setAgents(data.data.agents);
      setPagination(data.data.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load marketplace");
    } finally {
      setLoading(false);
    }
  }, [sortBy, sortOrder, selectedTaskType, verifiedOnly, minReputation]);

  const fetchTaskTypes = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/agents/marketplace/task-types`);
      const data = await res.json();
      if (data.success) {
        setTaskTypes(data.data.taskTypes);
      }
    } catch (err) {
      console.error("Failed to fetch task types:", err);
    }
  }, []);

  useEffect(() => {
    fetchTaskTypes();
  }, [fetchTaskTypes]);

  useEffect(() => {
    // Read initial filters from URL
    const { taskType, sort, order, verified, minRep } = router.query;
    if (taskType && typeof taskType === "string") setSelectedTaskType(taskType);
    if (sort && typeof sort === "string") setSortBy(sort);
    if (order === "asc" || order === "desc") setSortOrder(order);
    if (verified === "true") setVerifiedOnly(true);
    if (minRep && typeof minRep === "string") setMinReputation(Number(minRep));
  }, [router.query]);

  useEffect(() => {
    fetchAgents(0);
  }, [fetchAgents]);

  const handleFilterChange = () => {
    // Update URL with current filters
    const params: Record<string, string> = { sort: sortBy, order: sortOrder };
    if (selectedTaskType) params.taskType = selectedTaskType;
    if (verifiedOnly) params.verified = "true";
    if (minReputation !== "") params.minRep = String(minReputation);

    router.push({ pathname: "/marketplace", query: params }, undefined, { shallow: true });
  };

  useEffect(() => {
    handleFilterChange();
  }, [sortBy, sortOrder, selectedTaskType, verifiedOnly, minReputation]);

  const handlePageChange = (newOffset: number) => {
    fetchAgents(newOffset);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <Layout title="Agent Marketplace">
      <Head>
        <title>Agent Marketplace | Monocle</title>
        <meta
          name="description"
          content="Discover and integrate AI agents for your applications."
        />
      </Head>

      {/* Hero */}
      <section className="py-12 text-center">
        <h1 className="text-4xl font-bold text-white mb-4 tracking-tight">
          AI Agent Marketplace
        </h1>
        <p className="text-zinc-500 text-lg max-w-2xl mx-auto">
          Discover verified AI agents for your applications. Compare performance,
          pricing, and capabilities to find the perfect match.
        </p>
      </section>

      {/* Filters */}
      <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-4 mb-8">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm text-zinc-500 mb-1">Task Type</label>
            <select
              value={selectedTaskType}
              onChange={(e) => setSelectedTaskType(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-zinc-600"
            >
              <option value="">All Types</option>
              {taskTypes.map((t) => (
                <option key={t.type} value={t.type}>
                  {TASK_TYPE_LABELS[t.type] || t.type} ({t.count})
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-[150px]">
            <label className="block text-sm text-zinc-500 mb-1">Sort By</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-zinc-600"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-[120px]">
            <label className="block text-sm text-zinc-500 mb-1">Order</label>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as "asc" | "desc")}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-zinc-600"
            >
              <option value="desc">High to Low</option>
              <option value="asc">Low to High</option>
            </select>
          </div>

          <div className="min-w-[120px]">
            <label className="block text-sm text-zinc-500 mb-1">Min Reputation</label>
            <input
              type="number"
              min="0"
              max="1000"
              placeholder="0"
              value={minReputation}
              onChange={(e) =>
                setMinReputation(e.target.value ? Number(e.target.value) : "")
              }
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-zinc-600"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="verified"
              checked={verifiedOnly}
              onChange={(e) => setVerifiedOnly(e.target.checked)}
              className="w-4 h-4 rounded bg-zinc-900 border-zinc-700 text-white focus:ring-zinc-600"
            />
            <label htmlFor="verified" className="text-sm text-zinc-400">
              Verified only
            </label>
          </div>
        </div>
      </div>

      {/* Results summary */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-zinc-500">
          {loading
            ? "Loading..."
            : `Showing ${agents.length} of ${pagination.total} agents`}
        </p>
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-8 text-center">
          <p className="text-red-400">{error}</p>
          <button
            onClick={() => fetchAgents(pagination.offset)}
            className="mt-2 text-red-300 hover:text-red-200 underline"
          >
            Try again
          </button>
        </div>
      )}

      {/* Agent Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} />)
          : agents.map((agent) => <AgentCard key={agent.id} agent={agent} />)}
      </div>

      {/* Empty State */}
      {!loading && !error && agents.length === 0 && (
        <div className="text-center py-16">
          <div className="text-5xl mb-4 opacity-50">⌕</div>
          <h3 className="text-xl font-semibold text-white mb-2">No agents found</h3>
          <p className="text-zinc-500 mb-4">
            Try adjusting your filters or check back later.
          </p>
          <button
            onClick={() => {
              setSelectedTaskType("");
              setVerifiedOnly(false);
              setMinReputation("");
              setSortBy("reputation");
              setSortOrder("desc");
            }}
            className="text-zinc-400 hover:text-white underline"
          >
            Clear all filters
          </button>
        </div>
      )}

      {/* Pagination */}
      {pagination.total > pagination.limit && (
        <div className="flex items-center justify-center gap-4 mt-8">
          <button
            onClick={() => handlePageChange(pagination.offset - pagination.limit)}
            disabled={pagination.offset === 0}
            className="px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-700 transition-colors"
          >
            Previous
          </button>
          <span className="text-zinc-500">
            Page {Math.floor(pagination.offset / pagination.limit) + 1} of{" "}
            {Math.ceil(pagination.total / pagination.limit)}
          </span>
          <button
            onClick={() => handlePageChange(pagination.offset + pagination.limit)}
            disabled={!pagination.hasMore}
            className="px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-700 transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </Layout>
  );
}
