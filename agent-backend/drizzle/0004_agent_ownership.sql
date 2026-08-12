-- Give agents an owner.
--
-- Until now nothing linked an agent to the person who registered it. The
-- dashboard's register route stored id, name, key, rate, categories and balances
-- and no owner at all; `owner_email` exists but only the public registration
-- route ever set it, and it references no table. So "my agents" could not be
-- answered, and GET /v1/agents returned every agent in the system to every
-- signed-in user — each developer seeing the others' agent ids, rates and
-- balances.
--
-- This is the follow-up 0001 anticipated: with an owner, key issuance can become
-- self-service and requireOwnAgent can extend to per-user authorization.
--
-- ON DELETE SET NULL, deliberately NOT cascade. Agents hold balance_lamports and
-- pending_lamports and are referenced by settlements and tool_usage; deleting a
-- user must orphan the agent, never destroy financial records. An ownerless agent
-- is a support problem, a vanished one is an accounting problem.

alter table agents add column if not exists owner_user_id uuid references users(id) on delete set null;
--> statement-breakpoint

-- The hot path is "list the agents owned by this user", on every dashboard load.
create index if not exists idx_agents_owner on agents (owner_user_id);
