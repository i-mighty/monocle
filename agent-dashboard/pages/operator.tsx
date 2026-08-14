/**
 * OPERATOR CONSOLE
 *
 * Monocle's own view of Monocle: who is on the platform, what they are doing,
 * what they are earning, and what we are earning.
 *
 * Deliberately separate from /admin, which is router analytics — a different
 * question (how is the AI routing performing) with a different audience. Merging
 * them would produce one page nobody can scan.
 *
 * Every tab is redundantly gated. The server refuses at the level each route
 * needs, and this only decides what to draw: a viewer is not offered the Money
 * or Operators tabs, and would be refused if they typed the URL anyway.
 */

import { useEffect, useState } from "react";
import Layout from "../components/Layout";
import RequireAdmin from "../components/RequireAdmin";
import { getMe } from "../lib/auth-api";
import {
  AdminRole,
  Operator,
  OperatorAgent,
  OperatorCall,
  OperatorError,
  PlatformMoney,
  getOperatorAgents,
  getOperatorCalls,
  getOperators,
  getPlatformMoney,
  setOperatorRole,
} from "../lib/operator-api";

type Tab = "agents" | "calls" | "money" | "operators";

const RANK: Record<AdminRole, number> = { viewer: 1, admin: 2, owner: 3 };

/** Lamports are unreadable at a glance; SOL is the unit people reason in. */
function sol(lamports: number | undefined): string {
  if (lamports === undefined) return "—";
  if (lamports === 0) return "0";
  const s = lamports / 1_000_000_000;
  if (s >= 0.001) return `${s.toFixed(4)} SOL`;
  return `${lamports.toLocaleString()} lam`;
}

function when(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString();
}

const card = "bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-5";
const th = "text-left px-3 py-2 text-zinc-500 text-xs font-medium whitespace-nowrap";
const td = "px-3 py-3 text-sm text-white align-top";

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className={card}>
      <div className="text-zinc-500 text-xs mb-1">{label}</div>
      <div className={`text-2xl font-bold ${accent ?? "text-white"}`}>{value}</div>
      {sub && <div className="text-zinc-600 text-xs mt-1">{sub}</div>}
    </div>
  );
}

function Empty({ what }: { what: string }) {
  return <div className="text-zinc-600 text-sm text-center py-10">No {what} yet.</div>;
}

// ─── Agents ──────────────────────────────────────────────────────────────────

function AgentsTab() {
  const [rows, setRows] = useState<OperatorAgent[]>([]);
  const [money, setMoney] = useState(false);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getOperatorAgents(200)
      .then((d) => {
        setRows(d.agents);
        setMoney(d.moneyVisible);
        setTotal(d.pagination.total);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-zinc-600 text-sm py-10">Loading…</div>;
  if (err) return <div className="text-red-400 text-sm py-6">{err}</div>;
  if (rows.length === 0) return <Empty what="agents registered" />;

  return (
    <>
      <div className="text-zinc-500 text-xs mb-3">{total} registered</div>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-800/60">
              <th className={th}>Agent</th>
              <th className={th}>Owner</th>
              <th className={th}>Endpoint</th>
              <th className={th}>Rate</th>
              <th className={th}>Served</th>
              <th className={th}>Made</th>
              {money && <th className={th}>Earned</th>}
              {money && <th className={th}>Pending</th>}
              {money && <th className={th}>Direct (x402)</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.agentId} className="border-b border-zinc-800/40">
                <td className={td}>
                  <code className="text-zinc-300">{a.agentId}</code>
                  {a.name && <div className="text-zinc-600 text-xs">{a.name}</div>}
                  {a.isPaused && <span className="text-amber-500 text-xs">paused</span>}
                </td>
                <td className={td}>
                  {a.ownerEmail ? (
                    <span className="text-zinc-400 text-xs">{a.ownerEmail}</span>
                  ) : (
                    <span className="text-amber-500/70 text-xs">unclaimed</span>
                  )}
                </td>
                <td className={td}>
                  {a.endpoint.url ? (
                    <>
                      <span
                        className={
                          a.endpoint.listedInMarketplace
                            ? "text-emerald-500 text-xs"
                            : a.endpoint.isActive
                            ? "text-amber-500 text-xs"
                            : "text-red-500 text-xs"
                        }
                      >
                        {a.endpoint.listedInMarketplace
                          ? "healthy"
                          : a.endpoint.isActive
                          ? `failing (${a.endpoint.consecutiveFailures})`
                          : "deactivated"}
                      </span>
                      <div className="text-zinc-600 text-[11px] break-all">{a.endpoint.url}</div>
                      {a.endpoint.lastError && (
                        <div className="text-red-400/70 text-[11px]">{a.endpoint.lastError}</div>
                      )}
                    </>
                  ) : (
                    <span className="text-zinc-600 text-xs">none</span>
                  )}
                </td>
                <td className={td}>{a.ratePer1kTokens.toLocaleString()}</td>
                <td className={td}>{a.callsServed.toLocaleString()}</td>
                <td className={td}>{a.callsMade.toLocaleString()}</td>
                {money && <td className={td}>{sol(a.earnedLamports)}</td>}
                {money && <td className={td}>{sol(a.pendingLamports)}</td>}
                {money && <td className={td}>{sol(a.directLamports)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {money && (
        <p className="text-zinc-600 text-xs mt-3">
          <strong>Earned</strong> is charged through metering and settles to the agent&apos;s wallet.{" "}
          <strong>Direct</strong> is paid straight to that wallet over x402 and never touches
          Monocle — attributed by the agent&apos;s current payout address.
        </p>
      )}
    </>
  );
}

// ─── Calls ───────────────────────────────────────────────────────────────────

function CallsTab() {
  const [rows, setRows] = useState<OperatorCall[]>([]);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getOperatorCalls(100)
      .then((d) => {
        setRows(d.calls);
        setTotal(d.pagination.total);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-zinc-600 text-sm py-10">Loading…</div>;
  if (err) return <div className="text-red-400 text-sm py-6">{err}</div>;
  if (rows.length === 0) return <Empty what="calls recorded" />;

  return (
    <>
      <div className="text-zinc-500 text-xs mb-3">{total.toLocaleString()} calls, newest first</div>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-800/60">
              <th className={th}>When</th>
              <th className={th}>Caller</th>
              <th className={th}>Callee</th>
              <th className={th}>Tool</th>
              <th className={th}>Tokens</th>
              <th className={th}>Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-b border-zinc-800/40">
                <td className={td}>
                  <span className="text-zinc-500 text-xs">{when(c.createdAt)}</span>
                </td>
                <td className={td}>
                  <code className="text-zinc-400 text-xs">{c.callerAgentId}</code>
                </td>
                <td className={td}>
                  <code className="text-zinc-300 text-xs">{c.calleeAgentId}</code>
                </td>
                <td className={td}>
                  <span className="bg-zinc-800 px-2 py-0.5 rounded text-xs text-zinc-400">
                    {c.toolName}
                  </span>
                </td>
                <td className={td}>{c.tokensUsed.toLocaleString()}</td>
                <td className={td}>{c.costLamports.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── Money ───────────────────────────────────────────────────────────────────

function MoneyTab() {
  const [m, setM] = useState<PlatformMoney | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getPlatformMoney()
      .then(setM)
      .catch((e) => setErr(e.message));
  }, []);

  if (err) return <div className="text-red-400 text-sm py-6">{err}</div>;
  if (!m) return <div className="text-zinc-600 text-sm py-10">Loading…</div>;

  const throughput = m.metered.volumeLamports + m.direct.volumeLamports;

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Stat
          label="Monocle revenue"
          value={sol(m.platformRevenueLamports)}
          sub={`${m.settlement.count} settlements`}
          accent="text-emerald-400"
        />
        <Stat
          label="Paid out to agents"
          value={sol(m.settlement.netLamports)}
          sub={`${sol(m.pendingToAgentsLamports)} still owed`}
        />
        <Stat label="Total throughput" value={sol(throughput)} sub="metered + direct" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className={card}>
          <h3 className="text-white font-semibold mb-1 text-sm">Metered — we earn on this</h3>
          <p className="text-zinc-500 text-xs mb-4">
            Calls billed through Monocle. Settled on-chain to the agent, minus our fee.
          </p>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-zinc-500">Calls</span>
            <span className="text-white">{m.metered.calls.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-zinc-500">Volume</span>
            <span className="text-white">{sol(m.metered.volumeLamports)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-zinc-500">Our fee</span>
            <span className="text-emerald-400">{sol(m.settlement.feeLamports)}</span>
          </div>
        </div>

        <div className={card}>
          <h3 className="text-white font-semibold mb-1 text-sm">Direct x402 — we earn nothing</h3>
          <p className="text-zinc-500 text-xs mb-4">
            Caller pays the callee&apos;s wallet on-chain. The money never touches Monocle, so no
            fee is taken.
          </p>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-zinc-500">Payments</span>
            <span className="text-white">{m.direct.payments.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-zinc-500">Volume</span>
            <span className="text-white">{sol(m.direct.volumeLamports)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-zinc-500">Our fee</span>
            <span className="text-amber-500">0</span>
          </div>
        </div>
      </div>

      {m.monetisedShare !== null && (
        <div className="bg-amber-950/30 border border-amber-900/40 rounded-xl p-4 mt-4">
          <p className="text-amber-200/90 text-sm">
            <strong>{(m.monetisedShare * 100).toFixed(1)}%</strong> of throughput is monetised. The
            rest moves over x402, which carries no fee today — a pricing decision that has not been
            made yet, rather than a leak.
          </p>
        </div>
      )}
    </>
  );
}

// ─── Operators ───────────────────────────────────────────────────────────────

function OperatorsTab({ me }: { me: string | null }) {
  const [rows, setRows] = useState<Operator[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AdminRole>("viewer");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () =>
    getOperators()
      .then((d) => setRows(d.operators))
      .catch((e) => setErr(e.message));

  useEffect(() => {
    load();
  }, []);

  async function apply(targetEmail: string, next: AdminRole | null) {
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const r = await setOperatorRole(targetEmail, next);
      setNotice(
        next
          ? `${r.email} is now ${next}.`
          : `${r.email} no longer has operator access.`
      );
      setEmail("");
      await load();
    } catch (e) {
      setErr(e instanceof OperatorError ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className={`${card} mb-6`}>
        <h3 className="text-white font-semibold text-sm mb-1">Add an operator</h3>
        <p className="text-zinc-500 text-xs mb-4">
          The account must already exist — they sign up first, then you grant access.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="person@example.com"
            className="flex-1 px-4 py-2.5 bg-zinc-950 border border-zinc-800/60 rounded-lg text-white text-sm focus:outline-none focus:border-zinc-600"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as AdminRole)}
            className="bg-zinc-950 border border-zinc-800/60 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-zinc-600"
          >
            <option value="viewer">viewer — agents and calls</option>
            <option value="admin">admin — and money</option>
            <option value="owner">owner — and operators</option>
          </select>
          <button
            onClick={() => apply(email.trim(), role)}
            disabled={busy || !email.trim()}
            className="px-5 py-2.5 bg-white text-zinc-900 rounded-lg text-sm font-semibold hover:bg-zinc-200 disabled:opacity-50 transition-colors"
          >
            {busy ? "Saving…" : "Grant"}
          </button>
        </div>
      </div>

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-800/60">
              <th className={th}>Email</th>
              <th className={th}>Level</th>
              <th className={th}>Last seen</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} className="border-b border-zinc-800/40">
                <td className={td}>
                  {o.email}
                  {o.email === me && <span className="text-zinc-600 text-xs"> (you)</span>}
                </td>
                <td className={td}>
                  <select
                    value={o.role}
                    disabled={busy}
                    onChange={(e) => apply(o.email!, e.target.value as AdminRole)}
                    className="bg-zinc-950 border border-zinc-800/60 rounded-md px-2 py-1 text-white text-xs"
                  >
                    <option value="viewer">viewer</option>
                    <option value="admin">admin</option>
                    <option value="owner">owner</option>
                  </select>
                </td>
                <td className={td}>
                  <span className="text-zinc-500 text-xs">{when(o.lastSeenAt)}</span>
                </td>
                <td className={td}>
                  <button
                    onClick={() => apply(o.email!, null)}
                    disabled={busy}
                    className="text-red-400/80 hover:text-red-400 text-xs disabled:opacity-50"
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {err && <p className="text-red-400 mt-4 text-sm">{err}</p>}
      {notice && <p className="text-emerald-400 mt-4 text-sm">{notice}</p>}

      <p className="text-zinc-600 text-xs mt-4">
        Changes take effect on the person&apos;s next request — the role is read from the database
        every time, not carried in their session.
      </p>
    </>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function OperatorConsole() {
  const [tab, setTab] = useState<Tab>("agents");
  const [role, setRole] = useState<AdminRole | null>(null);
  const [me, setMe] = useState<string | null>(null);

  useEffect(() => {
    getMe()
      .then((u) => {
        setRole((u?.adminRole as AdminRole) ?? null);
        setMe(u?.email ?? null);
      })
      .catch(() => setRole(null));
  }, []);

  const rank = role ? RANK[role] : 0;
  const tabs: { id: Tab; label: string; min: number }[] = [
    { id: "agents", label: "Agents", min: 1 },
    { id: "calls", label: "Calls", min: 1 },
    { id: "money", label: "Money", min: 2 },
    { id: "operators", label: "Operators", min: 3 },
  ];
  const visible = tabs.filter((t) => rank >= t.min);

  return (
    <Layout title="Operator console">
      <RequireAdmin>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-white">Operator console</h1>
            <span className="text-zinc-500 text-xs">
              Monocle&apos;s view of every account{role ? ` · you are ${role}` : ""}
            </span>
          </div>
        </div>

        <div className="flex gap-2 mb-6 border-b border-zinc-800/60">
          {visible.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm transition-colors -mb-px border-b-2 ${
                tab === t.id
                  ? "border-white text-white font-medium"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* A viewer landing on a tab they cannot see (role changed under them)
            falls back rather than rendering a panel of 403s. */}
        {tab === "agents" && <AgentsTab />}
        {tab === "calls" && <CallsTab />}
        {tab === "money" && (rank >= 2 ? <MoneyTab /> : <Empty what="access to financials" />)}
        {tab === "operators" &&
          (rank >= 3 ? <OperatorsTab me={me} /> : <Empty what="access to operator management" />)}
      </RequireAdmin>
    </Layout>
  );
}
