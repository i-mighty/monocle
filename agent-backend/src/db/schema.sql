-- Drop existing tables (safe for development)
drop table if exists platform_revenue cascade;
drop table if exists settlements cascade;
drop table if exists tool_usage cascade;
drop table if exists payments cascade;
drop table if exists api_keys cascade;
drop table if exists developer_usage cascade;
drop table if exists agents cascade;

-- =============================================================================
-- AGENTS TABLE: Agent pricing & balance tracking
-- =============================================================================
create table if not exists agents (
  id text primary key,
  name text,
  public_key text unique,

  -- Pricing: fixed rate per 1,000 tokens (agent-defined, immutable at execution)
  rate_per_1k_tokens bigint not null default 1000,

  -- Balances: integer-only (lamports), no floating-point
  balance_lamports bigint not null default 0,
  pending_lamports bigint not null default 0,

  created_at timestamptz default now()
);

-- API Keys for authentication
create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  developer_id text not null,
  key text not null unique,
  created_at timestamptz default now()
);

-- =============================================================================
-- TOOL_USAGE: Immutable execution ledger (append-only, auditable, replayable)
-- =============================================================================
create table if not exists tool_usage (
  id uuid primary key default gen_random_uuid(),

  caller_agent_id text not null,
  callee_agent_id text not null,

  tool_name text not null,
  tokens_used integer not null,

  -- Price frozen at execution time (prevents retroactive disputes)
  rate_per_1k_tokens bigint not null,
  cost_lamports bigint not null,

  created_at timestamptz default now()
);

-- =============================================================================
-- SETTLEMENTS: On-chain transaction tracking
-- =============================================================================
create table if not exists settlements (
  id uuid primary key default gen_random_uuid(),

  from_agent_id text not null,
  to_agent_id text not null,

  -- Amounts in lamports (integer-only)
  gross_lamports bigint not null,
  platform_fee_lamports bigint not null,
  net_lamports bigint not null,

  -- Solana transaction tracking
  tx_signature text unique,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'failed')),

  created_at timestamptz default now()
);

-- =============================================================================
-- PLATFORM_REVENUE: Fee accounting
-- =============================================================================
create table if not exists platform_revenue (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references settlements(id),
  fee_lamports bigint not null,
  created_at timestamptz default now()
);

-- =============================================================================
-- INDEXES: Optimized query paths
-- =============================================================================
create index idx_tool_usage_caller on tool_usage(caller_agent_id);
create index idx_tool_usage_callee on tool_usage(callee_agent_id);
create index idx_tool_usage_created_at on tool_usage(created_at desc);

create index idx_settlements_from on settlements(from_agent_id);
create index idx_settlements_to on settlements(to_agent_id);
create index idx_settlements_status on settlements(status);
create index idx_settlements_created_at on settlements(created_at desc);

create index idx_platform_revenue_settlement on platform_revenue(settlement_id);
create index idx_platform_revenue_created_at on platform_revenue(created_at desc);

create index idx_api_keys_key on api_keys(key);


