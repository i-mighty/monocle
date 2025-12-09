create table if not exists agents (
  id text primary key,
  public_key text not null,
  created_at timestamptz default now()
);

create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  developer_id text not null,
  key text not null unique,
  created_at timestamptz default now()
);

create table if not exists tool_calls (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references agents(id),
  tool_name text not null,
  cost numeric not null default 0,
  payload jsonb,
  timestamp timestamptz default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  sender text not null,
  receiver text not null,
  amount numeric not null,
  tx_signature text,
  timestamp timestamptz default now()
);

create table if not exists developer_usage (
  id uuid primary key default gen_random_uuid(),
  developer_id text not null,
  calls integer default 0,
  spend numeric default 0,
  earnings numeric default 0
);

