-- Email login + email-verification (KYC).
--
-- Custom migration: these tables are managed by raw SQL (src/db/schema.sql)
-- rather than src/db/schema.ts, so drizzle-kit cannot generate this diff itself.
--
-- Two audiences, both handled here:
--   * the existing production DB, where `users` was created by schema.sql and
--     wallet_pubkey is NOT NULL;
--   * a fresh DB built only from drizzle migrations, where the 0000 baseline
--     never created users/auth_nonces at all (they aren't in schema.ts).
-- Every statement is therefore idempotent and safe to re-run.

-- SIWS user + nonce tables. Already present in prod; created here so a
-- drizzle-only database isn't left without them.
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  wallet_pubkey text unique,
  sol_name text,
  display_name text,
  created_at timestamptz default now(),
  last_seen_at timestamptz default now()
);
--> statement-breakpoint
create index if not exists idx_users_wallet on users(wallet_pubkey);
--> statement-breakpoint
create index if not exists idx_users_sol_name on users(sol_name);
--> statement-breakpoint
create table if not exists auth_nonces (
  nonce text primary key,
  wallet_pubkey text not null,
  message text not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
--> statement-breakpoint
create index if not exists idx_auth_nonces_wallet on auth_nonces(wallet_pubkey);
--> statement-breakpoint
create index if not exists idx_auth_nonces_expires on auth_nonces(expires_at);
--> statement-breakpoint
alter table users add column if not exists email             text;
--> statement-breakpoint
alter table users add column if not exists password_hash     text;
--> statement-breakpoint
alter table users add column if not exists email_verified_at timestamptz;
--> statement-breakpoint
-- users was created wallet-first, so wallet_pubkey is NOT NULL on the existing
-- production table. Email-only accounts have no wallet, so /auth/register cannot
-- insert a row until this is dropped. (unique still permits many NULLs.)
alter table users alter column wallet_pubkey drop not null;
--> statement-breakpoint
-- Case-insensitive unique email; NULL for wallet-only accounts.
create unique index if not exists users_email_lower_unique on users (lower(email))
  where email is not null;
--> statement-breakpoint
-- An account must still be reachable by something. Existing rows all predate
-- email and carry a wallet, so this is satisfiable on a live table.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'users_wallet_or_email') then
    alter table users
      add constraint users_wallet_or_email
      check (wallet_pubkey is not null or email is not null);
  end if;
end $$;
--> statement-breakpoint
-- One-time verification codes: sha256-hashed at rest, single-use, expiring.
create table if not exists email_verifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  email       text not null,
  code_hash   text not null,
  purpose     text not null default 'verify_email',
  attempts    integer not null default 0,
  consumed_at timestamptz,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
--> statement-breakpoint
create index if not exists idx_email_verifications_user    on email_verifications(user_id);
--> statement-breakpoint
create index if not exists idx_email_verifications_expires on email_verifications(expires_at);
