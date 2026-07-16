-- =============================================================================
-- EMAIL LOGIN + KYC MIGRATION
-- =============================================================================
-- Adds email/password login as a second auth method alongside SIWS wallet
-- login, plus an email-verification (light KYC) signal that gates sensitive
-- actions (settlement, withdrawal, agent registration).
--
-- Safe to run against an existing database: every statement is idempotent
-- (ADD COLUMN IF NOT EXISTS / CREATE ... IF NOT EXISTS).
--
-- Apply with:  psql "$DATABASE_URL" -f src/db/migrate-email-kyc.sql
-- =============================================================================

-- --- users: email/password + verification state -----------------------------
alter table users add column if not exists email           text;
alter table users add column if not exists password_hash   text;         -- pbkdf2 "salt:hash", null for wallet-only users
alter table users add column if not exists email_verified_at timestamptz; -- non-null once the email is confirmed

-- The table was created wallet-first, so wallet_pubkey was NOT NULL. Email-only
-- accounts have no wallet, so that constraint has to go or /auth/register can
-- never insert a row. (unique still permits many NULLs in Postgres.)
alter table users alter column wallet_pubkey drop not null;

-- ...but an account still has to be reachable by *something*. Guard against
-- rows with neither identifier. Existing rows all predate email and have a
-- wallet, so this is satisfiable on a live table.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'users_wallet_or_email') then
    alter table users
      add constraint users_wallet_or_email
      check (wallet_pubkey is not null or email is not null);
  end if;
end $$;

-- Case-insensitive uniqueness for email. Multiple NULLs are allowed (wallet-only
-- users have no email), but two accounts can't share the same address.
create unique index if not exists users_email_lower_unique on users (lower(email))
  where email is not null;

-- --- email_verifications: one-time codes -------------------------------------
-- One row per verification attempt. The plaintext code is never stored; we keep
-- a sha256 hash and compare in constant time. Codes are single-use and expire.
create table if not exists email_verifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  email       text not null,              -- the address being verified (lowercased)
  code_hash   text not null,              -- sha256 of the 6-digit code
  purpose     text not null default 'verify_email',
  attempts    integer not null default 0, -- failed confirmations against this code
  consumed_at timestamptz,                -- non-null once successfully used
  expires_at  timestamptz not null,       -- typically 15 min from issue
  created_at  timestamptz not null default now()
);

create index if not exists idx_email_verifications_user    on email_verifications(user_id);
create index if not exists idx_email_verifications_expires on email_verifications(expires_at);
