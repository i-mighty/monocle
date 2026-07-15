-- =============================================================================
-- ARENA TABLES (additive — safe to run alongside the existing schema)
-- =============================================================================
-- Audit trail for the TxLINE Agent-vs-Agent Arena. The engine keeps
-- authoritative state in memory and appends here best-effort, so these tables
-- being absent never breaks the live loop. Apply with:
--   psql "$DATABASE_URL" -f src/db/arena.sql

create table if not exists arena_agents (
  id text primary key,
  name text not null,
  sol_name text,
  strategy text not null,
  wallet_pubkey text,
  starting_bankroll_lamports bigint not null default 0,
  balance_lamports bigint not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists arena_signals (
  id uuid primary key,
  strategy text not null,
  fixture_id bigint not null,
  selection text not null,           -- HOME | DRAW | AWAY
  entry_prob double precision not null,
  move double precision not null,    -- consensus move that triggered the signal
  confidence double precision not null,
  reason text,
  acted boolean not null default false,
  created_at timestamptz default now()
);

create table if not exists arena_positions (
  id uuid primary key,
  agent_id text not null,
  strategy text not null,
  fixture_id bigint not null,
  selection text not null,
  stake_lamports bigint not null,
  entry_prob double precision not null,
  entry_odds double precision not null,
  shares double precision not null,
  status text not null default 'open',           -- open | settled
  mark_prob double precision not null,
  unrealized_pnl_lamports bigint not null default 0,
  realized_pnl_lamports bigint not null default 0,
  won boolean,
  reason text,
  confidence double precision,
  opened_at timestamptz default now(),
  settled_at timestamptz
);

create table if not exists arena_settlements (
  id uuid primary key,
  fixture_id bigint not null,
  agent_id text not null,
  net_pnl_lamports bigint not null,
  gross_winnings_lamports bigint not null default 0,
  positions_settled integer not null default 0,
  tx_signature text,                 -- devnet tx sig, null for internal-only
  on_chain boolean not null default false,
  status text not null default 'settled_internal', -- confirmed | settled_internal | failed
  error text,
  created_at timestamptz default now()
);

create index if not exists idx_arena_signals_fixture on arena_signals(fixture_id, created_at desc);
create index if not exists idx_arena_signals_strategy on arena_signals(strategy, created_at desc);
create index if not exists idx_arena_positions_agent on arena_positions(agent_id, status);
create index if not exists idx_arena_positions_fixture on arena_positions(fixture_id);
create index if not exists idx_arena_settlements_agent on arena_settlements(agent_id, created_at desc);
create index if not exists idx_arena_settlements_fixture on arena_settlements(fixture_id);
