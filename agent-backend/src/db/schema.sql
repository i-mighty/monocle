-- Drop existing tables (safe for development)
drop table if exists platform_revenue cascade;
drop table if exists settlements cascade;
drop table if exists tool_usage cascade;
drop table if exists tools cascade;
drop table if exists payments cascade;
drop table if exists api_keys cascade;
drop table if exists developer_usage cascade;
drop table if exists x402_payments cascade;
drop table if exists messages cascade;
drop table if exists conversations cascade;
drop table if exists agent_blocks cascade;
drop table if exists agent_follows cascade;
drop table if exists agents cascade;

-- =============================================================================
-- AGENTS TABLE: Agent registration & balance tracking
-- =============================================================================
create table if not exists agents (
  id text primary key,
  name text,
  public_key text unique,

  -- Default rate per 1,000 tokens (used when tool doesn't specify its own rate)
  default_rate_per_1k_tokens bigint not null default 1000,

  -- Balances: integer-only (lamports), no floating-point
  balance_lamports bigint not null default 0,
  pending_lamports bigint not null default 0,

  created_at timestamptz default now()
);

-- =============================================================================
-- TOOLS TABLE: Per-tool pricing configuration
-- =============================================================================
create table if not exists tools (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references agents(id) on delete cascade,

  -- Tool identification
  name text not null,
  description text,

  -- Per-tool pricing (overrides agent default)
  rate_per_1k_tokens bigint not null,

  -- Tool metadata
  is_active text not null default 'true',

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  -- Unique constraint: one tool name per agent
  unique(agent_id, name)
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

  -- Tool reference (nullable for backward compatibility)
  tool_id uuid references tools(id),
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
-- X402_PAYMENTS: HTTP 402 payment tracking
-- =============================================================================
create table if not exists x402_payments (
  id uuid primary key default gen_random_uuid(),
  
  -- Payment identification
  tx_signature text unique not null,
  nonce text unique not null,
  
  -- Parties
  payer_wallet text not null,
  recipient_wallet text not null,
  
  -- Amount in lamports
  amount_lamports bigint not null,
  
  -- Associated resource/execution
  resource_id text,
  execution_id uuid references tool_usage(id),
  
  -- Verification status
  verified_at timestamptz,
  network text not null default 'solana-devnet',
  
  created_at timestamptz default now()
);

-- =============================================================================
-- INDEXES: Optimized query paths
-- =============================================================================
create index idx_tools_agent_id on tools(agent_id);

create index idx_tool_usage_caller on tool_usage(caller_agent_id);
create index idx_tool_usage_callee on tool_usage(callee_agent_id);
create index idx_tool_usage_tool_id on tool_usage(tool_id);
create index idx_tool_usage_created_at on tool_usage(created_at desc);

create index idx_settlements_from on settlements(from_agent_id);
create index idx_settlements_to on settlements(to_agent_id);
create index idx_settlements_status on settlements(status);
create index idx_settlements_created_at on settlements(created_at desc);

create index idx_platform_revenue_settlement on platform_revenue(settlement_id);
create index idx_platform_revenue_created_at on platform_revenue(created_at desc);

create index idx_api_keys_key on api_keys(key);

create index idx_x402_payments_signature on x402_payments(tx_signature);
create index idx_x402_payments_nonce on x402_payments(nonce);
create index idx_x402_payments_payer on x402_payments(payer_wallet);
create index idx_x402_payments_created_at on x402_payments(created_at desc);

-- =============================================================================
-- CONVERSATIONS: Consent-based agent-to-agent messaging
-- =============================================================================
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),

  -- Participants
  initiator_agent_id text not null references agents(id) on delete cascade,
  receiver_agent_id text not null references agents(id) on delete cascade,

  -- Consent workflow: pending → approved | rejected | blocked
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'blocked')),

  -- Initial request message (shown to receiver before approval)
  request_message text not null,

  -- Metadata
  last_message_at timestamptz,
  initiator_unread_count integer not null default 0,
  receiver_unread_count integer not null default 0,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  -- One conversation per agent pair
  unique(initiator_agent_id, receiver_agent_id)
);

-- =============================================================================
-- MESSAGES: Private messages within conversations
-- =============================================================================
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),

  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_agent_id text not null references agents(id) on delete cascade,

  -- Message content
  content text not null,

  -- Optional: flag for messages that need human review
  needs_human_input text not null default 'false',

  -- Read status
  is_read text not null default 'false',

  created_at timestamptz default now()
);

-- =============================================================================
-- AGENT_BLOCKS: Track blocked agent pairs
-- =============================================================================
create table if not exists agent_blocks (
  id uuid primary key default gen_random_uuid(),

  blocker_agent_id text not null references agents(id) on delete cascade,
  blocked_agent_id text not null references agents(id) on delete cascade,

  created_at timestamptz default now(),

  unique(blocker_agent_id, blocked_agent_id)
);

-- =============================================================================
-- AGENT_FOLLOWS: Social following for discovery
-- =============================================================================
create table if not exists agent_follows (
  id uuid primary key default gen_random_uuid(),

  follower_agent_id text not null references agents(id) on delete cascade,
  following_agent_id text not null references agents(id) on delete cascade,

  created_at timestamptz default now(),

  unique(follower_agent_id, following_agent_id)
);

-- =============================================================================
-- MESSAGING INDEXES
-- =============================================================================
create index idx_conversations_initiator on conversations(initiator_agent_id);
create index idx_conversations_receiver on conversations(receiver_agent_id);
create index idx_conversations_status on conversations(status);
create index idx_conversations_last_message on conversations(last_message_at desc);

create index idx_messages_conversation on messages(conversation_id);
create index idx_messages_sender on messages(sender_agent_id);
create index idx_messages_created_at on messages(created_at);

create index idx_agent_blocks_blocker on agent_blocks(blocker_agent_id);
create index idx_agent_blocks_blocked on agent_blocks(blocked_agent_id);

create index idx_agent_follows_follower on agent_follows(follower_agent_id);
create index idx_agent_follows_following on agent_follows(following_agent_id);
