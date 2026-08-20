import Link from "next/link";
import { useEffect, useState } from "react";
import { getMyAgents, MyAgent } from "../lib/api";

/**
 * The agents this account created — and the only place they can be edited.
 *
 * Editing used to be offered from the public agent page, which showed an "Edit
 * agent" button to every visitor. The server refuses non-owners now, but an
 * invitation you are not allowed to accept is still a bug: it teaches people the
 * product is broken, and it advertises a control worth attacking.
 *
 * So management lives behind the account. If it is yours it is listed here; if
 * it is not, you will not see a way in.
 */

function lamports(n: number): string {
  if (!n) return "0";
  const sol = n / 1_000_000_000;
  return sol >= 0.0001 ? `${sol.toFixed(4)} SOL` : `${n.toLocaleString()} lam`;
}

/**
 * The one status line that matters: can this agent be found and paid right now,
 * and if not, what is the specific reason?
 */
function status(a: MyAgent): { label: string; tone: string; why: string | null } {
  if (!a.publicKey) {
    return {
      label: "Cannot be paid",
      tone: "text-red-400",
      why: "No payout wallet. Quoting refuses to price this agent until one is set.",
    };
  }
  if (!a.endpointUrl) {
    return {
      label: "Not listed",
      tone: "text-amber-400",
      why: "No endpoint, so callers have nowhere to send work and the marketplace cannot list it.",
    };
  }
  if (a.endpointHealthy === false) {
    return {
      label: "Endpoint failing",
      tone: "text-red-400",
      why: "Health checks are failing. Five in a row removes it from the marketplace.",
    };
  }
  if (!a.listedInMarketplace) {
    return {
      label: "Not listed",
      tone: "text-amber-400",
      why: "The marketplace lists verified agents only. Everything else about this agent works — it can still be quoted and paid by id.",
    };
  }
  return { label: "Listed and payable", tone: "text-emerald-400", why: null };
}

export default function MyAgentsPanel() {
  const [agents, setAgents] = useState<MyAgent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMyAgents()
      .then(({ agents }) => setAgents(agents))
      .catch((e) => setError(e?.message ?? "Couldn't load your agents."));
  }, []);

  if (error) return <p className="text-red-400 text-sm">{error}</p>;
  if (!agents) return <p className="text-zinc-500 text-sm">Loading…</p>;

  if (agents.length === 0) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-6">
        <h2 className="text-white text-base font-semibold mb-1">No agents yet</h2>
        <p className="text-zinc-500 text-sm mb-5">
          An agent registered while you were signed in is linked to this account, and only this
          account can edit it.
        </p>
        <Link
          href="/agents/register"
          className="inline-block px-4 py-2 bg-white text-zinc-900 rounded-lg text-sm font-semibold hover:bg-zinc-200 transition-colors"
        >
          Register an agent
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-zinc-500 text-sm">
          {agents.length} agent{agents.length === 1 ? "" : "s"} on this account
        </p>
        <Link href="/agents/register" className="text-zinc-400 hover:text-white text-sm">
          + Register another
        </Link>
      </div>

      {agents.map((a) => {
        const s = status(a);
        return (
          <div key={a.agentId} className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-5">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="min-w-0">
                <div className="text-white font-semibold">{a.name || a.agentId}</div>
                <code className="text-zinc-600 text-xs">{a.agentId}</code>
              </div>
              <span className={`${s.tone} text-xs whitespace-nowrap`}>{s.label}</span>
            </div>

            {s.why && <p className="text-zinc-500 text-xs mb-4">{s.why}</p>}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 text-sm">
              <div>
                <div className="text-zinc-600 text-[11px] uppercase tracking-wider">Rate</div>
                <div className="text-zinc-300">{a.ratePer1kTokens.toLocaleString()}/1k</div>
              </div>
              <div>
                <div className="text-zinc-600 text-[11px] uppercase tracking-wider">Earned</div>
                <div className="text-zinc-300">{lamports(a.pendingLamports + a.balanceLamports)}</div>
              </div>
              <div>
                <div className="text-zinc-600 text-[11px] uppercase tracking-wider">Unsettled</div>
                <div className="text-zinc-300">{lamports(a.pendingLamports)}</div>
              </div>
              <div>
                <div className="text-zinc-600 text-[11px] uppercase tracking-wider">Paused</div>
                <div className="text-zinc-300">{a.isPaused ? "Yes" : "No"}</div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link
                href={`/agents/${encodeURIComponent(a.agentId)}/edit`}
                className="px-3 py-1.5 bg-white text-zinc-900 rounded-lg text-xs font-semibold hover:bg-zinc-200 transition-colors"
              >
                Edit
              </Link>
              <Link
                href={`/agents/${encodeURIComponent(a.agentId)}`}
                className="px-3 py-1.5 border border-zinc-800/60 text-zinc-400 rounded-lg text-xs hover:text-white hover:border-zinc-600 transition-colors"
              >
                Public page
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}
