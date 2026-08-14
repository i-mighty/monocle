-- Turn the operator flag into graded roles.
--
-- 0007 added users.is_admin and said so explicitly: "There is exactly one
-- privilege level today — can see everyone's data — and inventing a hierarchy
-- before a second level exists means guessing at it. `is_admin` becomes `role`
-- the day that changes." That day is now: operators need to add other operators
-- without every one of them being able to read the platform's books.
--
-- Three levels, chosen around the two boundaries that actually matter here:
--
--   viewer  Agents, calls, endpoint health. Everything needed to answer "is the
--           platform working" and nothing that answers "what is it earning".
--           Support can hold this without seeing revenue.
--
--   admin   The above plus money: per-agent earnings, settlements, platform
--           revenue.
--
--   owner   The above plus granting and revoking operators. Held by the people
--           who would be accountable for handing someone else the books.
--
-- Nullable rather than a NOT NULL default of 'viewer': a role of null means "not
-- an operator at all", which is what almost every row is, and it keeps the
-- absence of access distinct from the lowest level of it.
--
-- No enum type. A check constraint is editable in one migration; adding a value
-- to a Postgres enum inside a transaction has historically been a special case,
-- and this list will change again.

alter table users add column if not exists admin_role text;
--> statement-breakpoint

alter table users drop constraint if exists users_admin_role_check;
--> statement-breakpoint

alter table users add constraint users_admin_role_check
  check (admin_role is null or admin_role in ('viewer', 'admin', 'owner'));
--> statement-breakpoint

-- Everyone who already had the boolean becomes an owner. There is exactly one
-- such account and it belongs to the founder, who must keep the ability to grant
-- roles — demoting them to 'admin' here would lock operator management out of
-- the product entirely, recoverable only by SSH.
update users set admin_role = 'owner' where is_admin = true and admin_role is null;
--> statement-breakpoint

create index if not exists idx_users_admin_role on users (admin_role) where admin_role is not null;
--> statement-breakpoint

-- is_admin is deliberately NOT dropped here.
--
-- getUserById selects it for every authenticated request, not just operator
-- ones, so removing the column while the previous build is still serving would
-- fail session lookups for every signed-in user during the gap between migration
-- and restart. Additive now, dropped in a later migration once no running code
-- reads it.
--
-- Until then the grant path writes both, so rolling the app back does not
-- silently strip someone's access.
