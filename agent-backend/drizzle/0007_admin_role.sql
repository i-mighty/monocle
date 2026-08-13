-- Give Monocle operators a real role.
--
-- Until now "admin" meant one of two things, neither of which was a role:
--
--   ADMIN_API_KEY — a shared server-to-server secret, unset on this deployment,
--   so every route behind it answered 503. Fine for a machine, useless for a
--   person, and nothing to attribute an action to afterwards.
--
--   admin_users — a parallel identity table with its own password_hash, wired to
--   nothing the dashboard uses. Signing in to it was never possible from the app.
--
-- Meanwhile /admin in the dashboard was reachable by ANY signed-in user, because
-- the only check was whether a session cookie existed. There was no way to say
-- "this account is an operator", so nothing could ask.
--
-- This says it, on the account people already sign in with. One boolean beats a
-- second login: no separate password to leak, no second identity to keep in step
-- with the first, and the audit trail already keyed by user id keeps working.
--
-- Deliberately NOT a role enum. There is exactly one privilege level today —
-- can see everyone's data — and inventing a hierarchy before a second level
-- exists means guessing at it. `is_admin` becomes `role` the day that changes.
--
-- Defaults to false, so the migration grants nobody anything. The first operator
-- is granted explicitly (scripts/grant-admin.js), which is the safe direction:
-- forgetting to run it leaves the console dark, not open.

alter table users add column if not exists is_admin boolean not null default false;
--> statement-breakpoint

-- Partial: admins are a handful of rows in a growing table, and every lookup
-- asks for the true side.
create index if not exists idx_users_admin on users (is_admin) where is_admin = true;
