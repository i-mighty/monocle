-- Drop existing tables (safe for development)
drop table if exists payments cascade;
drop table if exists tool_calls cascade;
drop table if exists api_keys cascade;
drop table if exists developer_usage cascade;
drop table if exists agents cascade;

-- Agents table
create table if not exists agents (
  id text primary key,
  public_key text not null unique,
  created_at timestamptz default now()
);

-- API Keys for authentication
create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  developer_id text not null,
  key text not null unique,
  created_at timestamptz default now()
);

-- Tool call logs (usage metering)
create table if not exists tool_calls (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null,
  tool_name text not null,
  tokens_used numeric not null default 0,
  cost numeric not null default 0,
  payload jsonb,
  timestamp timestamptz default now()
);

-- Micropayment transactions
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  sender text not null,
  receiver text not null,
  amount numeric not null,
  tx_signature text unique,
  timestamp timestamptz default now()
);

-- Developer usage aggregation
create table if not exists developer_usage (
  id uuid primary key default gen_random_uuid(),
  developer_id text not null unique,
  calls integer default 0,
  spend numeric default 0,
  earnings numeric default 0,
  updated_at timestamptz default now()
);

-- Indexes for common queries
create index idx_tool_calls_agent_id on tool_calls(agent_id);
create index idx_tool_calls_timestamp on tool_calls(timestamp desc);
create index idx_payments_sender on payments(sender);
create index idx_payments_receiver on payments(receiver);
create index idx_payments_timestamp on payments(timestamp desc);
create index idx_api_keys_key on api_keys(key);


