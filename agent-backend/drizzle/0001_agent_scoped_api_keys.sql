-- Agent-scoped API keys: give a key an identity so money can be bound to it.
--
-- Today there is one working credential — the shared platform key — and it
-- authenticates as "the platform", never as anybody in particular. callerId is
-- just a claim in the request body, so any key holder can bill any agent.
--
-- Per-agent keys were already designed: routes/agents.ts register/public mints an
-- `mk_...` key, tells the user to store it, and inserts it into api_keys with
-- columns key_hash / agent_id / name / scopes / is_active — none of which exist
-- on that table. It has (id, developer_id, key, created_at), so that INSERT
-- throws and public registration has never completed. This migration creates the
-- columns the code is already written against.
--
-- Idempotent and additive: nothing is enforced by this migration alone.

alter table api_keys add column if not exists key_hash  text;
--> statement-breakpoint
alter table api_keys add column if not exists agent_id  text references agents(id) on delete cascade;
--> statement-breakpoint
alter table api_keys add column if not exists name      text;
--> statement-breakpoint
alter table api_keys add column if not exists scopes    text;
--> statement-breakpoint
alter table api_keys add column if not exists is_active boolean not null default true;
--> statement-breakpoint
alter table api_keys add column if not exists last_used_at timestamptz;
--> statement-breakpoint
alter table api_keys add column if not exists revoked_at   timestamptz;
--> statement-breakpoint

-- The original table was built for plaintext developer keys: developer_id and key
-- are NOT NULL, and agent keys supply neither (we store a hash, never the key).
-- Both must become optional or the insert the code already performs cannot land.
alter table api_keys alter column developer_id drop not null;
--> statement-breakpoint
alter table api_keys alter column key drop not null;
--> statement-breakpoint

-- A key must identify *something*, or it authenticates as nobody and the
-- ownership checks have nothing to compare against.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'api_keys_identifies_someone') then
    alter table api_keys
      add constraint api_keys_identifies_someone
      check (agent_id is not null or developer_id is not null);
  end if;
end $$;
--> statement-breakpoint

-- Hash lookup must be unique and fast: this is the hot path for every
-- authenticated request. Partial, because legacy plaintext rows have no hash.
create unique index if not exists api_keys_key_hash_unique on api_keys (key_hash)
  where key_hash is not null;
--> statement-breakpoint
create index if not exists idx_api_keys_agent on api_keys (agent_id);
