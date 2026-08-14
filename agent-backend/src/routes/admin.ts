/**
 * OPERATOR CONSOLE
 *
 * What Monocle's own staff need to answer four questions: who is on the
 * platform, what are they doing, what are they earning, and what are we earning.
 *
 * Every route here reads across all accounts, so every route is gated — at the
 * level its data deserves rather than one bar for the file:
 *
 *   viewer   the roster and the call log. Operations, no money.
 *   admin    the above, plus earnings, settlements and platform revenue.
 *   owner    the above, plus handing out and taking back operator access.
 *
 * The roster is mounted at "viewer" and redacts its money columns for viewers,
 * rather than existing twice. One query, one shape, one place where the
 * redaction happens.
 */

import { Router } from "express";
import { query } from "../db/client";
import { requireAdmin } from "../middleware/requireAdmin";
import { asyncHandler, sendSuccess, AppError, ErrorCodes } from "../errors";
import { ADMIN_ROLES, AdminRole, hasAdminLevel } from "../services/authService";
import { isValidEmail, normalizeEmail } from "../services/emailService";

const router = Router();

const n = (v: unknown): number => Number(v ?? 0);

// ===========================================================================
// MONEY
// ===========================================================================

/**
 * GET /v1/admin/money
 *
 * What the platform earned, and what flowed through it.
 *
 * The distinction this endpoint exists to make: Monocle earns a fee only on
 * SETTLED usage. Under x402 the caller transfers straight to the callee's
 * wallet, so those payments never touch our books and carry no fee — they are
 * volume, not revenue. Reporting one number for "money" would hide that the
 * headline payment rail currently earns the company nothing, which is a pricing
 * decision nobody has made yet rather than a bug.
 */
router.get(
  "/money",
  requireAdmin("admin"),
  asyncHandler(async (_req, res) => {
    const [revenue, settled, metered, direct, unsettled] = await Promise.all([
      query(`select coalesce(sum(fee_lamports), 0) as fees, count(*)::int as n from platform_revenue`),
      query(
        `select coalesce(sum(gross_lamports), 0) as gross,
                coalesce(sum(net_lamports), 0)   as net,
                coalesce(sum(platform_fee_lamports), 0) as fees,
                count(*)::int as n
           from settlements
          where status in ('confirmed', 'settled_internal')`
      ),
      query(
        `select count(*)::int as calls, coalesce(sum(cost_lamports), 0) as volume from tool_usage`
      ),
      query(
        `select count(*)::int as payments, coalesce(sum(amount_lamports), 0) as volume from x402_payments`
      ),
      query(`select coalesce(sum(pending_lamports), 0) as pending from agents`),
    ]);

    const feesEarned = n(revenue.rows[0].fees);
    const directVolume = n(direct.rows[0].volume);

    sendSuccess(res, {
      // What Monocle has actually earned. One number, and it is this one.
      platformRevenueLamports: feesEarned,

      settlement: {
        count: n(settled.rows[0].n),
        grossLamports: n(settled.rows[0].gross),
        // Paid out to agents.
        netLamports: n(settled.rows[0].net),
        feeLamports: n(settled.rows[0].fees),
      },

      metered: {
        calls: n(metered.rows[0].calls),
        volumeLamports: n(metered.rows[0].volume),
      },

      // Agent-to-agent payments that bypassed us entirely.
      direct: {
        payments: n(direct.rows[0].payments),
        volumeLamports: directVolume,
        feeLamports: 0,
        note:
          "x402 payments move directly from caller to callee on-chain. Monocle takes no fee on these today.",
      },

      // Earned by agents, not yet paid out — money the platform is holding.
      pendingToAgentsLamports: n(unsettled.rows[0].pending),

      // Stated rather than inferred: the share of throughput we monetise.
      monetisedShare:
        directVolume + n(metered.rows[0].volume) > 0
          ? n(metered.rows[0].volume) / (directVolume + n(metered.rows[0].volume))
          : null,
    });
  })
);

// ===========================================================================
// AGENTS
// ===========================================================================

/**
 * GET /v1/admin/agents
 *
 * Every registered agent, with what it has done and what it has made.
 *
 * Four money columns rather than one, because they answer different questions
 * and summing them would double-count:
 *
 *   earnedLamports    charged for work served, via metering
 *   settledLamports   of that, actually paid out on-chain
 *   pendingLamports   of that, still owed
 *   directLamports    paid straight to its wallet over x402, never on our books
 */
router.get(
  "/agents",
  requireAdmin("viewer"),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Number(req.query.offset) || 0;

    const result = await query(
      `select a.id, a.name, a.owner_email, a.owner_user_id, a.public_key,
              a.default_rate_per_1k_tokens, a.balance_lamports, a.pending_lamports,
              a.is_paused, a.created_at,
              e.endpoint_url, e.is_healthy, e.is_active, e.consecutive_failures,
              e.last_check_at, e.last_check_error,
              coalesce(served.calls, 0)  as calls_served,
              coalesce(served.earned, 0) as earned_lamports,
              coalesce(made.calls, 0)    as calls_made,
              coalesce(made.spent, 0)    as spent_lamports,
              coalesce(paid.settled, 0)  as settled_lamports,
              coalesce(x.direct, 0)      as direct_lamports
         from agents a
         left join agent_endpoints e on e.agent_id = a.id
         left join (
           select callee_agent_id, count(*)::int as calls, sum(cost_lamports) as earned
             from tool_usage group by callee_agent_id
         ) served on served.callee_agent_id = a.id
         left join (
           select caller_agent_id, count(*)::int as calls, sum(cost_lamports) as spent
             from tool_usage group by caller_agent_id
         ) made on made.caller_agent_id = a.id
         left join (
           select to_agent_id, sum(net_lamports) as settled
             from settlements where status in ('confirmed', 'settled_internal')
             group by to_agent_id
         ) paid on paid.to_agent_id = a.id
         left join (
           -- x402 records a wallet, not an agent: the payment went to an address.
           -- Joining on the CURRENT payout wallet is therefore approximate — if an
           -- owner re-points it, earlier payments stop being attributed here. The
           -- wallet_audit_log is the record of when that happened.
           select recipient_wallet, sum(amount_lamports) as direct
             from x402_payments group by recipient_wallet
         ) x on x.recipient_wallet = a.public_key
        order by a.created_at desc
        limit $1 offset $2`,
      [limit, offset]
    );

    const total = n((await query(`select count(*)::int as c from agents`)).rows[0].c);
    const canSeeMoney = hasAdminLevel(req.user?.adminRole, "admin");

    sendSuccess(res, {
      agents: result.rows.map((r: any) => ({
        agentId: r.id,
        name: r.name,
        ownerEmail: r.owner_email,
        claimed: !!r.owner_user_id,
        payoutWallet: r.public_key,
        ratePer1kTokens: n(r.default_rate_per_1k_tokens),
        isPaused: r.is_paused === true,
        createdAt: r.created_at,
        endpoint: {
          url: r.endpoint_url,
          isHealthy: r.is_healthy === true,
          isActive: r.is_active === true,
          consecutiveFailures: n(r.consecutive_failures),
          lastCheckAt: r.last_check_at,
          lastError: r.last_check_error,
          listedInMarketplace: r.is_healthy === true && r.is_active === true,
        },
        callsServed: n(r.calls_served),
        callsMade: n(r.calls_made),
        // Redacted for viewers. Absent rather than zeroed: a zero would be a
        // lie, and the UI can tell "not allowed to see" from "nothing there".
        ...(canSeeMoney
          ? {
              earnedLamports: n(r.earned_lamports),
              spentLamports: n(r.spent_lamports),
              settledLamports: n(r.settled_lamports),
              pendingLamports: n(r.pending_lamports),
              balanceLamports: n(r.balance_lamports),
              directLamports: n(r.direct_lamports),
            }
          : {}),
      })),
      pagination: { total, limit, offset, hasMore: offset + result.rows.length < total },
      moneyVisible: canSeeMoney,
    });
  })
);

// ===========================================================================
// CALLS
// ===========================================================================

/**
 * GET /v1/admin/calls
 *
 * The call log across every agent, newest first. Optionally filtered to one
 * agent on either side of the transaction (?agentId=).
 *
 * Cost is included at viewer level deliberately: it is the price of one call,
 * already visible to both parties and on the agent's public rate card. The
 * aggregate — what an agent has made in total — is the operator-only part.
 */
router.get(
  "/calls",
  requireAdmin("viewer"),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const agentId = typeof req.query.agentId === "string" ? req.query.agentId : null;

    const where = agentId ? `where caller_agent_id = $3 or callee_agent_id = $3` : ``;
    const params: any[] = agentId ? [limit, offset, agentId] : [limit, offset];

    const rows = await query(
      `select id, caller_agent_id, callee_agent_id, tool_name, tokens_used,
              rate_per_1k_tokens, cost_lamports, created_at
         from tool_usage
         ${where}
        order by created_at desc
        limit $1 offset $2`,
      params
    );

    const totalRow = await query(
      `select count(*)::int as c from tool_usage ${agentId ? "where caller_agent_id = $1 or callee_agent_id = $1" : ""}`,
      agentId ? [agentId] : []
    );

    sendSuccess(res, {
      calls: rows.rows.map((r: any) => ({
        id: r.id,
        callerAgentId: r.caller_agent_id,
        calleeAgentId: r.callee_agent_id,
        toolName: r.tool_name,
        tokensUsed: n(r.tokens_used),
        ratePer1kTokens: n(r.rate_per_1k_tokens),
        costLamports: n(r.cost_lamports),
        createdAt: r.created_at,
      })),
      pagination: {
        total: n(totalRow.rows[0].c),
        limit,
        offset,
        hasMore: offset + rows.rows.length < n(totalRow.rows[0].c),
      },
    });
  })
);

// ===========================================================================
// OPERATORS
// ===========================================================================

/** GET /v1/admin/operators — who holds operator access, and at what level. */
router.get(
  "/operators",
  requireAdmin("admin"),
  asyncHandler(async (_req, res) => {
    const rows = await query(
      `select id, email, admin_role, created_at, last_seen_at
         from users where admin_role is not null
        order by case admin_role when 'owner' then 0 when 'admin' then 1 else 2 end, email`
    );
    sendSuccess(res, {
      operators: rows.rows.map((r: any) => ({
        id: r.id,
        email: r.email,
        role: r.admin_role,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
      })),
      roles: ADMIN_ROLES,
    });
  })
);

/**
 * PUT /v1/admin/operators — grant, change, or revoke operator access.
 *
 * Body: { email, role: "viewer" | "admin" | "owner" | null }
 *
 * Owner only, because this is the route that hands somebody else the books.
 *
 * One invariant is enforced rather than trusted: the platform must always have
 * at least one owner. Without it the last owner can demote themselves and
 * operator management becomes unreachable from the product, recoverable only by
 * SSH into the database — which is exactly the situation this console was built
 * to end.
 */
router.put(
  "/operators",
  requireAdmin("owner"),
  asyncHandler(async (req, res) => {
    const { email, role } = req.body ?? {};

    if (!isValidEmail(email)) {
      throw new AppError(ErrorCodes.VALIDATION_INVALID_FORMAT, { field: "email" });
    }
    if (role !== null && !ADMIN_ROLES.includes(role)) {
      throw new AppError(
        ErrorCodes.VALIDATION_INVALID_FORMAT,
        { field: "role", allowed: [...ADMIN_ROLES, null] },
        `role must be one of ${ADMIN_ROLES.join(", ")}, or null to revoke`
      );
    }

    const target = await query(
      `select id, email, admin_role from users where lower(email) = lower($1)`,
      [normalizeEmail(email)]
    );
    if (target.rows.length === 0) {
      throw new AppError(
        ErrorCodes.AGENT_NOT_FOUND,
        { email: normalizeEmail(email) },
        "No account with that email. They need to sign up first."
      );
    }
    const current = target.rows[0];

    // Would this leave the platform with no owner?
    if (current.admin_role === "owner" && role !== "owner") {
      const owners = n(
        (await query(`select count(*)::int as c from users where admin_role = 'owner'`)).rows[0].c
      );
      if (owners <= 1) {
        throw new AppError(
          ErrorCodes.VALIDATION_INVALID_FORMAT,
          { owners },
          "This is the only owner. Promote somebody else to owner first, or operator access becomes unmanageable from the dashboard."
        );
      }
    }

    await query(
      // is_admin is written alongside admin_role while the boolean still exists
      // (see 0008): rolling the app back must not silently strip access.
      `update users set admin_role = $2, is_admin = $3 where id = $1`,
      [current.id, role, role !== null]
    );

    console.warn(
      `[admin] ${req.user?.email ?? "unknown"} set operator role for ${current.email}: ` +
        `${current.admin_role ?? "none"} -> ${role ?? "none"}`
    );

    sendSuccess(res, {
      email: current.email,
      previousRole: (current.admin_role as AdminRole | null) ?? null,
      role: (role as AdminRole | null) ?? null,
    });
  })
);

export default router;
