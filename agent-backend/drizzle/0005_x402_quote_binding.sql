-- Bind an x402 payment to the agent it is meant to pay.
--
-- POST /x402/quote issued a nonce and a recipient wallet and stored neither, and
-- the recipient it quoted was always PLATFORM_WALLET. POST /x402/verify then
-- received only { signature, payer, amount, nonce } — nothing naming the payee —
-- so it verified against that same platform wallet. Every x402 payment therefore
-- went to Monocle, which makes it a paywall rather than agent-to-agent commerce.
--
-- Paying the callee instead needs verification to know WHICH agent was quoted.
-- Taking that from the verify request would let the payer nominate the payee
-- after the fact; taking it from the quote fixes it at the moment the price was
-- offered, which is the only point where the payee is authoritative.
--
-- The nonce is that link. It is already unique per quote and already travels with
-- the payment, so it is the natural key.
--
-- Deliberately separate from pricing_quotes, which prices a tool call. This
-- records where money must land. Conflating them would mean every price lookup
-- carried payment-routing semantics it does not need.

create table if not exists x402_quotes (
  nonce             text primary key,
  callee_agent_id   text not null references agents(id) on delete cascade,
  -- Copied, not joined at verify time: the agent's payout wallet may change, and
  -- a payment must be judged against the address that was actually quoted.
  recipient_wallet  text not null,
  amount_lamports   bigint not null,
  tool_name         text,
  caller_agent_id   text,
  expires_at        timestamptz not null,
  created_at        timestamptz not null default now()
);
--> statement-breakpoint

-- Expired quotes are swept, and verification checks expiry on the hot path.
create index if not exists idx_x402_quotes_expires on x402_quotes (expires_at);
--> statement-breakpoint

create index if not exists idx_x402_quotes_callee on x402_quotes (callee_agent_id);
