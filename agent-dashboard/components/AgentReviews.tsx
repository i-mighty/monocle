import { useEffect, useState } from "react";
import { getMyAgents, MyAgent } from "../lib/api";
import {
  AgentReview,
  ReviewEligibility,
  ReviewSummary,
  checkReviewEligibility,
  getAgentReviews,
  submitReview,
} from "../lib/reviews-api";

/**
 * Reviews on an agent's public page.
 *
 * Only agents that paid may review, which shapes the whole component: the form
 * is not shown and then rejected, it is not shown at all unless one of your
 * agents has actually bought from this one. Being told the rule after writing a
 * paragraph is the worst version of enforcing it.
 *
 * Every review carries the spend behind it. A five-star from one small call and
 * one from two hundred calls should not look the same, and the reader should not
 * have to take the average on faith.
 */

function lamports(n: number): string {
  if (!n) return "0";
  const sol = n / 1_000_000_000;
  return sol >= 0.0001 ? `${sol.toFixed(4)} SOL` : `${n.toLocaleString()} lamports`;
}

function Stars({ n, size = "text-sm" }: { n: number; size?: string }) {
  return (
    <span className={`${size} tracking-tight`} aria-label={`${n} out of 5`}>
      <span className="text-amber-400">{"★".repeat(n)}</span>
      <span className="text-zinc-700">{"★".repeat(5 - n)}</span>
    </span>
  );
}

export default function AgentReviews({ agentId }: { agentId: string }) {
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [reviews, setReviews] = useState<AgentReview[]>([]);
  const [mine, setMine] = useState<MyAgent[]>([]);
  const [eligible, setEligible] = useState<{ agent: MyAgent; info: ReviewEligibility } | null>(null);
  const [checked, setChecked] = useState(false);

  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () =>
    getAgentReviews(agentId)
      .then((d) => {
        setSummary(d.summary);
        setReviews(d.reviews);
      })
      .catch(() => {
        /* an unreachable review list should not take the page down */
      });

  useEffect(() => {
    load();
  }, [agentId]);

  // Which of my agents, if any, has paid this one? The first that has is the one
  // offered — reviewing as a specific agent matters, so it is named in the form
  // rather than assumed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { agents } = await getMyAgents();
        if (cancelled) return;
        setMine(agents);
        for (const a of agents) {
          if (a.agentId === agentId) continue;
          const info = await checkReviewEligibility(agentId, a.agentId);
          if (cancelled) return;
          if (info.eligible) {
            setEligible({ agent: a, info });
            if (info.existingReview) {
              setRating(info.existingReview.rating);
              setComment(info.existingReview.comment ?? "");
            }
            break;
          }
        }
      } catch {
        /* signed out — no form, just the list */
      } finally {
        if (!cancelled) setChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  async function send() {
    if (!eligible) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await submitReview(agentId, {
        reviewerAgentId: eligible.agent.agentId,
        rating,
        comment: comment.trim() || undefined,
      });
      setNotice(eligible.info.existingReview ? "Your review was updated." : "Review posted.");
      await load();
      const info = await checkReviewEligibility(agentId, eligible.agent.agentId);
      setEligible({ agent: eligible.agent, info });
    } catch (e: any) {
      setError(e?.message ?? "Couldn't post that review.");
    } finally {
      setBusy(false);
    }
  }

  const card = "rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-6";

  return (
    <section className={`${card} mb-6`}>
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-sm font-semibold text-white">Reviews</h2>
        {summary && summary.count > 0 && (
          <div className="flex items-baseline gap-2">
            <Stars n={Math.round(summary.average ?? 0)} />
            <span className="text-zinc-400 text-sm">{summary.average?.toFixed(1)}</span>
            <span className="text-zinc-600 text-xs">
              from {summary.count} paying customer{summary.count === 1 ? "" : "s"}
            </span>
          </div>
        )}
      </div>
      <p className="text-zinc-500 text-sm mb-5">
        Written only by agents that paid this one for work. Nobody else can post here.
      </p>

      {/* The form, only for someone who qualifies. */}
      {eligible && (
        <div className="bg-zinc-950/60 border border-zinc-800/60 rounded-xl p-4 mb-5">
          <div className="text-zinc-400 text-xs mb-3">
            Reviewing as <code className="text-zinc-300">{eligible.agent.agentId}</code> —{" "}
            {eligible.info.message} {lamports(eligible.info.paidLamports)} paid.
          </div>

          <div className="flex items-center gap-1 mb-3">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setRating(n)}
                aria-label={`${n} star${n === 1 ? "" : "s"}`}
                className={`text-2xl leading-none transition-colors ${
                  n <= rating ? "text-amber-400" : "text-zinc-700 hover:text-zinc-500"
                }`}
              >
                ★
              </button>
            ))}
          </div>

          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="What was it like to work with this agent?"
            className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800/60 rounded-lg text-white text-sm mb-3 focus:outline-none focus:border-zinc-600"
          />

          <div className="flex items-center gap-2">
            <button
              onClick={send}
              disabled={busy}
              className="px-4 py-2 bg-white text-zinc-900 rounded-lg text-sm font-semibold hover:bg-zinc-200 disabled:opacity-50 transition-colors"
            >
              {busy ? "Posting…" : eligible.info.existingReview ? "Update review" : "Post review"}
            </button>
            {eligible.info.existingReview && (
              <span className="text-zinc-600 text-xs">You have already reviewed this agent.</span>
            )}
          </div>

          {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
          {notice && <p className="text-emerald-400 text-sm mt-3">{notice}</p>}
        </div>
      )}

      {/* Why there is no form — but only for someone with agents of their own,
          since anyone else has nothing to act on. */}
      {checked && !eligible && mine.length > 0 && (
        <p className="text-zinc-600 text-xs mb-5">
          None of your agents has paid this one, so you cannot review it yet.
        </p>
      )}

      {reviews.length === 0 ? (
        <p className="text-zinc-600 text-sm">No reviews yet.</p>
      ) : (
        <div className="space-y-4">
          {reviews.map((r) => (
            <div key={r.id} className="border-t border-zinc-800/40 pt-4 first:border-0 first:pt-0">
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <div className="flex items-baseline gap-2 min-w-0">
                  <Stars n={r.rating} />
                  <code className="text-zinc-400 text-xs truncate">{r.reviewerName || r.reviewerAgentId}</code>
                </div>
                <span className="text-zinc-600 text-[11px] whitespace-nowrap">
                  {new Date(r.createdAt).toLocaleDateString()}
                  {r.edited ? " · edited" : ""}
                </span>
              </div>
              {r.comment && <p className="text-zinc-300 text-sm mb-1.5">{r.comment}</p>}
              {/* The receipt behind the opinion. */}
              <p className="text-zinc-600 text-[11px]">
                Paid {lamports(r.paidLamports)} over {r.callsAtReview} call
                {r.callsAtReview === 1 ? "" : "s"} · {r.basis === "x402" ? "on-chain" : "metered"}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
