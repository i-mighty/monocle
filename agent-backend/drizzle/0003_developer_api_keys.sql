-- Developer API keys (`Mon_...`): a key that names the human who owns it.
--
-- Until now a key could name an agent (0001's `agent_id`) or a free-text
-- `developer_id` that references no table. Neither fits the key a developer is
-- handed at the end of signup: that key belongs to a row in `users` — the same
-- identity the session cookie and the email-verification (KYC) gate already use.
--
-- Storing it as a real foreign key rather than reusing the untyped
-- `developer_id` column buys two things the text column cannot: the database
-- rejects a key pointing at a user that does not exist, and deleting a user
-- takes their keys with them instead of leaving live credentials behind.
--
-- Only the sha256 digest of the key is ever stored (see hashAgentKey in
-- securityService); `key` stays null for these rows, exactly as it does for
-- agent keys. There is no path back from a stored row to the original key,
-- which is why the UI regenerates rather than reveals.
--
-- Idempotent and additive, matching 0001.

alter table api_keys add column if not exists user_id uuid references users(id) on delete cascade;
--> statement-breakpoint

-- 0001 added a check that a key must name an agent or a developer. A developer
-- key names a *user*, which is neither, so every insert below would be rejected.
-- Widen the constraint rather than drop it: the point of the check is that a key
-- naming nobody cannot be authorised to move anybody's money, and that still holds.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'api_keys_identifies_someone') then
    alter table api_keys drop constraint api_keys_identifies_someone;
  end if;
  alter table api_keys
    add constraint api_keys_identifies_someone
    check (agent_id is not null or developer_id is not null or user_id is not null);
end $$;
--> statement-breakpoint

create index if not exists idx_api_keys_user on api_keys (user_id);
--> statement-breakpoint

-- One *active* key per developer, enforced by the database rather than by
-- application code remembering to revoke first. Regeneration revokes the old row
-- and inserts a new one; if the revoke were ever skipped or lost to a partial
-- failure, this index turns a silently-accumulating set of live credentials into
-- a failed insert.
--
-- Partial on purpose: revoked rows stay as history, and agent/platform rows
-- (user_id is null) are untouched — `name` and `scopes` already exist from 0001,
-- so issuing a developer several named keys later needs no further migration,
-- just a wider index.
create unique index if not exists api_keys_one_active_per_user
  on api_keys (user_id)
  where user_id is not null and is_active and revoked_at is null;
