import { useState, useEffect, useCallback } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";

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
  let color = "bg-gray-600";
  let label = "Unknown";

  if (score >= 900) {
    color = "bg-purple-600";
    label = "Elite";
  } else if (score >= 750) {
    color = "bg-green-600";
    label = "Excellent";
  } else if (score >= 500) {
    color = "bg-blue-600";
    label = "Good";
  } else if (score >= 250) {
    color = "bg-yellow-600";
    label = "Fair";
  } else if (score > 0) {
    color = "bg-red-600";
    label = "New";
  }

  return (
    <span className={`${color} text-white text-xs font-medium px-2 py-1 rounded`}>
      {label} • {score}
    </span>
  );
}

function AgentCard({ agent }: { agent: Agent }) {
  return (
    <Link href={`/agents/${agent.id}`}>
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 hover:border-purple-500 transition-all cursor-pointer">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            {agent.logoUrl ? (
              <img
                src={agent.logoUrl}
                alt={agent.name}
                className="w-12 h-12 rounded-full object-cover"
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white text-xl font-bold">
                {agent.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-white">{agent.name}</h3>
                {agent.verified && (
                  <span className="text-green-400" title="Verified Agent">
                    ✓
                  </span>
                )}
              </div>
              <ReputationBadge score={agent.reputationScore} />
            </div>
          </div>
        </div>

        {agent.bio && (
          <p className="text-gray-400 text-sm mb-4 line-clamp-2">{agent.bio}</p>
        )}

        <div className="flex flex-wrap gap-2 mb-4">
          {agent.taskTypes.slice(0, 3).map((type) => (
            <span
              key={type}
              className="bg-gray-700 text-gray-300 text-xs px-2 py-1 rounded"
            >
              {TASK_TYPE_LABELS[type] || type}
            </span>
          ))}
          {agent.taskTypes.length > 3 && (
            <span className="text-gray-500 text-xs px-2 py-1">
              +{agent.taskTypes.length - 3} more
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-4 text-center border-t border-gray-700 pt-4">
          <div>
            <div className="text-gray-400 text-xs uppercase">Rate</div>
            <div className="text-white text-sm font-medium">
              {formatCost(agent.ratePer1kTokens)}
            </div>
            <div className="text-gray-500 text-xs">/1K tokens</div>
          </div>
          <div>
            <div className="text-gray-400 text-xs uppercase">Success</div>
            <div className="text-white text-sm font-medium">
              {agent.stats.successRate}
            </div>
          </div>
          <div>
            <div className="text-gray-400 text-xs uppercase">Latency</div>
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
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 animate-pulse">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-12 h-12 rounded-full bg-gray-700" />
        <div className="flex-1">
          <div className="h-5 bg-gray-700 rounded w-1/3 mb-2" />
          <div className="h-4 bg-gray-700 rounded w-1/4" />
        </div>
      </div>
      <div className="h-4 bg-gray-700 rounded w-full mb-2" />
      <div className="h-4 bg-gray-700 rounded w-2/3 mb-4" />
      <div className="flex gap-2 mb-4">
        <div className="h-6 bg-gray-700 rounded w-16" />
        <div className="h-6 bg-gray-700 rounded w-20" />
      </div>
      <div className="grid grid-cols-3 gap-4 border-t border-gray-700 pt-4">
        <div className="h-10 bg-gray-700 rounded" />
        <div className="h-10 bg-gray-700 rounded" />
        <div className="h-10 bg-gray-700 rounded" />
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
    <>
      <Head>
        <title>Agent Marketplace | Monocle</title>
        <meta
          name="description"
          content="Discover and integrate AI agents for your applications. Browse by capability, compare performance, and find the perfect agent for your needs."
        />
      </Head>

      <div className="min-h-screen bg-gray-900 text-white">
        {/* Header */}
        <header className="border-b border-gray-800">
          <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-blue-500 rounded-lg flex items-center justify-center text-white font-bold">
                M
              </div>
              <span className="text-xl font-semibold">Monocle</span>
            </Link>
            <nav className="flex items-center gap-6">
              <Link href="/marketplace" className="text-purple-400 font-medium">
                Marketplace
              </Link>
              <Link href="/usage" className="text-gray-400 hover:text-white">
                Dashboard
              </Link>
              <Link
                href="/agents/register"
                className="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg text-sm font-medium"
              >
                Register Agent
              </Link>
            </nav>
          </div>
        </header>

        {/* Hero */}
        <section className="bg-gradient-to-b from-gray-800 to-gray-900 py-12">
          <div className="max-w-7xl mx-auto px-4 text-center">
            <h1 className="text-4xl font-bold mb-4">
              AI Agent Marketplace
            </h1>
            <p className="text-gray-400 text-lg max-w-2xl mx-auto">
              Discover verified AI agents for your applications. Compare performance,
              pricing, and capabilities to find the perfect match for your needs.
            </p>
          </div>
        </section>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 py-8">
          {/* Filters */}
          <div className="bg-gray-800 rounded-lg p-4 mb-8">
            <div className="flex flex-wrap gap-4 items-end">
              {/* Task Type Filter */}
              <div className="flex-1 min-w-[200px]">
                <label className="block text-sm text-gray-400 mb-1">
                  Task Type
                </label>
                <select
                  value={selectedTaskType}
                  onChange={(e) => setSelectedTaskType(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                >
                  <option value="">All Types</option>
                  {taskTypes.map((t) => (
                    <option key={t.type} value={t.type}>
                      {TASK_TYPE_LABELS[t.type] || t.type} ({t.count})
                    </option>
                  ))}
                </select>
              </div>

              {/* Sort By */}
              <div className="min-w-[150px]">
                <label className="block text-sm text-gray-400 mb-1">
                  Sort By
                </label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                >
                  {SORT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Sort Order */}
              <div className="min-w-[120px]">
                <label className="block text-sm text-gray-400 mb-1">
                  Order
                </label>
                <select
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as "asc" | "desc")}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                >
                  <option value="desc">High to Low</option>
                  <option value="asc">Low to High</option>
                </select>
              </div>

              {/* Min Reputation */}
              <div className="min-w-[120px]">
                <label className="block text-sm text-gray-400 mb-1">
                  Min Reputation
                </label>
                <input
                  type="number"
                  min="0"
                  max="1000"
                  placeholder="0"
                  value={minReputation}
                  onChange={(e) =>
                    setMinReputation(e.target.value ? Number(e.target.value) : "")
                  }
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              {/* Verified Only */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="verified"
                  checked={verifiedOnly}
                  onChange={(e) => setVerifiedOnly(e.target.checked)}
                  className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-purple-600 focus:ring-purple-500"
                />
                <label htmlFor="verified" className="text-sm text-gray-300">
                  Verified only
                </label>
              </div>
            </div>
          </div>

          {/* Results summary */}
          <div className="flex items-center justify-between mb-4">
            <p className="text-gray-400">
              {loading
                ? "Loading..."
                : `Showing ${agents.length} of ${pagination.total} agents`}
            </p>
          </div>

          {/* Error State */}
          {error && (
            <div className="bg-red-900/50 border border-red-700 rounded-lg p-4 mb-8 text-center">
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
              <div className="text-6xl mb-4">🔍</div>
              <h3 className="text-xl font-semibold mb-2">No agents found</h3>
              <p className="text-gray-400 mb-4">
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
                className="text-purple-400 hover:text-purple-300 underline"
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
                className="px-4 py-2 bg-gray-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-600"
              >
                Previous
              </button>
              <span className="text-gray-400">
                Page {Math.floor(pagination.offset / pagination.limit) + 1} of{" "}
                {Math.ceil(pagination.total / pagination.limit)}
              </span>
              <button
                onClick={() => handlePageChange(pagination.offset + pagination.limit)}
                disabled={!pagination.hasMore}
                className="px-4 py-2 bg-gray-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-600"
              >
                Next
              </button>
            </div>
          )}
        </main>

        {/* Footer */}
        <footer className="border-t border-gray-800 py-8 mt-12">
          <div className="max-w-7xl mx-auto px-4 text-center text-gray-500 text-sm">
            <p>
              Want to list your agent?{" "}
              <Link href="/agents/register" className="text-purple-400 hover:underline">
                Register now
              </Link>
            </p>
          </div>
        </footer>
      </div>
    </>
  );
}
