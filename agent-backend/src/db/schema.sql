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

  -- Budget guardrails
  max_cost_per_call bigint,
  daily_spend_cap bigint,
  is_paused text not null default 'false',
  allowed_callees text,

  -- Reputation & Trust fields
  reputation_score integer not null default 500,
  verified_status text not null default 'unverified',
  verified_at timestamptz,
  verified_by text,
  
  -- Agent profile
  bio text,
  website_url text,
  logo_url text,
  categories text,
  version text not null default '1.0.0',
  owner_email text,
  support_url text,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- =============================================================================
-- TOOLS TABLE: Per-tool pricing and metadata configuration
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

  -- Enhanced metadata
  version text not null default '1.0.0',
  category text,
  input_schema text,
  output_schema text,
  examples_json text,
  avg_tokens_per_call integer,
  max_tokens_per_call integer,
  docs_url text,
  is_deprecated text not null default 'false',
  deprecation_message text,
  deprecated_at timestamptz,
  total_calls bigint not null default 0,
  total_tokens_processed bigint not null default 0,
  last_called_at timestamptz,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  -- Unique constraint: one tool name per agent
  unique(agent_id, name)
);

-- =============================================================================
-- AGENT_AUDITS: Verification and audit trail
-- =============================================================================
create table if not exists agent_audits (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references agents(id) on delete cascade,
  
  audit_type text not null,
  result text not null default 'pending',
  
  auditor_id text,
  auditor_name text,
  auditor_type text not null default 'system',
  
  summary text,
  details_json text,
  evidence_url text,
  certificate_hash text,
  
  valid_from timestamptz default now(),
  valid_until timestamptz,
  
  score integer,
  notes text,
  
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- =============================================================================
-- AGENT_VERSION_HISTORY: Track changes over time
-- =============================================================================
create table if not exists agent_version_history (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references agents(id) on delete cascade,
  
  version text not null,
  change_type text not null,
  snapshot_json text not null,
  changes_json text,
  changed_by text,
  change_reason text,
  is_breaking_change text not null default 'false',
  migration_notes text,
  
  created_at timestamptz default now()
);

-- =============================================================================
-- AGENT_CAPABILITIES: Declared capabilities for discovery
-- =============================================================================
create table if not exists agent_capabilities (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references agents(id) on delete cascade,
  
  capability text not null,
  proficiency_level text not null default 'intermediate',
  is_verified text not null default 'false',
  verified_at timestamptz,
  metadata text,
  
  created_at timestamptz default now(),
  
  unique(agent_id, capability)
);

-- API Keys for authentication (Legacy - kept for backward compatibility)
create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  developer_id text not null,
  key text not null unique,
  created_at timestamptz default now()
);

-- =============================================================================
-- API_KEYS_V2: Enhanced API Keys with scopes, rate limits, and rotation
-- =============================================================================
create table if not exists api_keys_v2 (
  id uuid primary key default gen_random_uuid(),
  
  -- Developer/owner identification
  developer_id text not null,
  name text not null,  -- Human-readable key name (e.g., "Production Server")
  
  -- Key identification (prefix for lookups, hash for verification)
  key_prefix text not null,  -- First 8 chars for efficient lookup
  key_hash text not null,  -- PBKDF2 hash: salt$hash
  
  -- Authorization scopes
  scopes text not null default '["read:agents"]',  -- JSON array of scopes
  
  -- Rate limiting configuration
  rate_limit integer not null default 60,  -- Requests per minute
  rate_limit_burst integer not null default 10,  -- Burst allowance
  
  -- Expiration
  expires_at timestamptz,  -- Null = never expires
  
  -- Usage tracking
  last_used_at timestamptz,
  last_used_ip text,
  
  -- Status
  is_active boolean not null default true,
  
  -- Key rotation support
  version integer not null default 1,
  previous_key_hash text,  -- Previous hash for grace period
  rotated_at timestamptz,  -- When key was rotated
  
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Index for fast key lookup by prefix
create index idx_api_keys_v2_prefix on api_keys_v2(key_prefix);
create index idx_api_keys_v2_developer on api_keys_v2(developer_id);
create index idx_api_keys_v2_active on api_keys_v2(is_active) where is_active = true;

-- =============================================================================
-- RATE_LIMIT_BUCKETS: Persistent rate limit tracking (for Redis migration)
-- =============================================================================
create table if not exists rate_limit_buckets (
  id text primary key,  -- key:keyId or ip:address
  
  request_count integer not null default 0,
  burst_used integer not null default 0,
  window_start timestamptz not null default now(),
  window_end timestamptz not null,
  
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_rate_limit_window_end on rate_limit_buckets(window_end);

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
create index idx_tools_category on tools(category);
create index idx_tools_is_active on tools(is_active);

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

-- Agent Registry Enhancement indexes
create index idx_agent_audits_agent on agent_audits(agent_id);
create index idx_agent_audits_type on agent_audits(audit_type);
create index idx_agent_audits_result on agent_audits(result);
create index idx_agent_audits_valid_until on agent_audits(valid_until);

create index idx_agent_version_history_agent on agent_version_history(agent_id);
create index idx_agent_version_history_version on agent_version_history(version);
create index idx_agent_version_history_type on agent_version_history(change_type);
create index idx_agent_version_history_created on agent_version_history(created_at);

create index idx_agent_capabilities_agent on agent_capabilities(agent_id);
create index idx_agent_capabilities_capability on agent_capabilities(capability);

create index idx_agents_reputation on agents(reputation_score desc);
create index idx_agents_verified_status on agents(verified_status);

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

-- =============================================================================
-- ACTIVITY_LOGS: Structured audit trail for critical events
-- =============================================================================
create table if not exists activity_logs (
  id uuid primary key default gen_random_uuid(),
  
  -- Event classification
  event_type text not null,  -- identity_created, pricing_changed, tool_executed, etc.
  severity text not null default 'info',  -- info, warning, error, critical
  
  -- Who/what is involved
  agent_id text references agents(id),  -- Agent this event relates to
  actor_id text,  -- Who performed the action
  actor_type text not null default 'system',  -- agent, system, admin, api
  
  -- What was affected
  resource_type text,  -- agent, tool, payment, settlement, etc.
  resource_id text,  -- ID of the affected resource
  
  -- Action details
  action text not null,  -- e.g., "pricing.update", "tool.execute"
  description text not null,  -- Human-readable description
  metadata text,  -- JSON with additional context
  
  -- Request context
  ip_address text,
  user_agent text,
  request_id text,
  duration_ms integer,
  
  created_at timestamptz default now()
);

-- =============================================================================
-- ACTIVITY_LOGS INDEXES: Optimized for common queries
-- =============================================================================
create index idx_activity_logs_agent_id on activity_logs(agent_id);
create index idx_activity_logs_event_type on activity_logs(event_type);
create index idx_activity_logs_severity on activity_logs(severity);
create index idx_activity_logs_created_at on activity_logs(created_at desc);
create index idx_activity_logs_actor_id on activity_logs(actor_id);
create index idx_activity_logs_resource_type on activity_logs(resource_type);
create index idx_activity_logs_composite on activity_logs(agent_id, event_type, created_at desc);
