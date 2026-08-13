-- Bring wallet_audit_log under migration control.
--
-- The table has existed in production since before Drizzle: it was created by
-- schema.sql, which is what built that database, and both the payment paths in
-- routes/wallet.ts and the payout-wallet change in routes/agents.ts write to it.
-- It was never in a migration, so a database provisioned from ./drizzle alone
-- came up without it — and since PUT /agents/:id/payout-wallet commits the
-- wallet update and its audit row in one transaction, that environment would
-- fail every payout wallet change outright rather than merely lose the record.
--
-- This is therefore a catch-up, not a new table. `if not exists` makes it a
-- no-op against production, and the shape below is a faithful copy of what is
-- actually there (verified against the live column, index and constraint
-- definitions) so a fresh database and production do not quietly diverge.
--
-- Two properties worth stating, because both look like omissions:
--
--   agent_id has no foreign key. An audit trail must outlive what it audits —
--   deleting an agent must not erase the record of who re-pointed its payout
--   wallet, which is exactly the history someone doing that would want gone.
--
--   There is no unique constraint. Repeated actions on one agent are ordinary;
--   the log is append-only by convention, and nothing here should collapse two
--   genuine events into one.

create table if not exists wallet_audit_log (
  id            uuid primary key default gen_random_uuid(),
  agent_id      text not null,
  -- Free text rather than an enum: writers span payments, settlement, tool
  -- execution and wallet administration, and a new event type should never
  -- require a migration before it can be recorded.
  action        text not null,
  counterparty  text,
  amount        bigint,
  -- JSON, stored as text to match production. Per-action payload: for
  -- payout_wallet_changed that is the previous and new address, who changed it,
  -- whether an emailed code was required, and what was pending at the time.
  details       text,
  tx_signature  text,
  created_at    timestamptz default now()
);
--> statement-breakpoint

-- Reads are "this agent's history", newest first.
create index if not exists idx_wallet_audit_agent on wallet_audit_log (agent_id);
--> statement-breakpoint

create index if not exists idx_wallet_audit_action on wallet_audit_log (action);
--> statement-breakpoint

create index if not exists idx_wallet_audit_created on wallet_audit_log (created_at desc);
