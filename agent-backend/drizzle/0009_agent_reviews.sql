-- Reviews, restricted to agents that actually paid.
--
-- A marketplace review is only worth reading if writing one costs something.
-- Anybody can type five stars; only a customer can have transferred lamports
-- for the work first. So payment is the eligibility rule, and it is enforced
-- against recorded evidence — a tool_usage row or an x402 payment — rather than
-- against a claim in the request.
--
-- This replaces nothing, because nothing was there. agent-reputation/ has a
-- POST /reviews backed by a JSON file, no authentication, a reviewer id the
-- browser makes up (`user-${Date.now()}`), and a default base URL of
-- localhost:3004 that is not deployed — so the dashboard's review page has been
-- posting into the void. A trust surface attached to money needs to live where
-- the money is recorded.
--
-- ONE REVIEW PER PAIR, enforced by the primary key rather than by convention.
-- Without it a single buyer can post a hundred and drown the rest; with it, a
-- second submission edits the first, which is also what someone wants after
-- more experience with the agent.
--
-- The evidence columns are frozen at submission on purpose. paid_lamports and
-- calls_at_review say what this reviewer had actually bought when they formed
-- the opinion, which is the difference between "one small call" and "two
-- thousand over six months". Recomputing them later would rewrite the context
-- of an old review.

create table if not exists agent_reviews (
  id                uuid primary key default gen_random_uuid(),

  -- Subject and author. Both cascade: a review of a deleted agent, or by one,
  -- has no subject or no provenance, and an unverifiable review is worse than
  -- no review.
  agent_id          text not null references agents(id) on delete cascade,
  reviewer_agent_id text not null references agents(id) on delete cascade,

  rating            smallint not null,
  comment           text,

  -- How the reviewer earned the right to be here: 'metered' (a tool_usage row)
  -- or 'x402' (an on-chain payment to this agent's wallet).
  basis             text not null,
  -- The tool_usage id or transaction signature that proved it. Kept so a
  -- disputed review can be checked against the payment it claims.
  evidence_ref      text,

  paid_lamports     bigint,
  calls_at_review   integer,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint agent_reviews_rating_check check (rating between 1 and 5),
  constraint agent_reviews_basis_check check (basis in ('metered', 'x402')),
  -- An agent cannot review itself. Cheap to state here, and then it is true
  -- regardless of which code path writes.
  constraint agent_reviews_not_self check (agent_id <> reviewer_agent_id)
);
--> statement-breakpoint

create unique index if not exists agent_reviews_one_per_pair
  on agent_reviews (agent_id, reviewer_agent_id);
--> statement-breakpoint

-- The read path is "show me this agent's reviews, newest first".
create index if not exists idx_agent_reviews_agent
  on agent_reviews (agent_id, created_at desc);
--> statement-breakpoint

create index if not exists idx_agent_reviews_reviewer
  on agent_reviews (reviewer_agent_id);
