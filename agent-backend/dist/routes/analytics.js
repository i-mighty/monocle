import { Router } from "express";
import { query } from "../db/client.js";
const router = Router();
// Usage analytics: tokens used and costs by agent
router.get("/usage", async (_req, res) => {
    try {
        const { rows } = await query(`select 
        callee_agent_id as agent_id, 
        count(*) as calls, 
        sum(tokens_used) as total_tokens,
        sum(cost_lamports) as total_cost_lamports
       from tool_usage 
       group by callee_agent_id 
       order by total_cost_lamports desc 
       limit 50`);
        res.json(rows || []);
    }
    catch (error) {
        console.error("Error fetching usage:", error);
        res.json([]);
    }
});
// Settlement receipts
router.get("/receipts", async (_req, res) => {
    try {
        const { rows } = await query(`select 
        id, 
        from_agent_id, 
        to_agent_id, 
        gross_lamports, 
        platform_fee_lamports, 
        net_lamports,
        tx_signature, 
        status, 
        created_at
       from settlements 
       order by created_at desc 
       limit 100`);
        res.json(rows || []);
    }
    catch (error) {
        console.error("Error fetching receipts:", error);
        res.json([]);
    }
});
// Total platform revenue
router.get("/earnings", async (_req, res) => {
    try {
        const { rows } = await query("select coalesce(sum(fee_lamports), 0) as total_fees_lamports from platform_revenue");
        res.json(rows?.[0] || { total_fees_lamports: 0 });
    }
    catch (error) {
        console.error("Error fetching earnings:", error);
        res.status(500).json({ total_fees_lamports: 0, error: "Failed to fetch earnings" });
    }
});
// Agent earnings (as callee)
router.get("/earnings/by-agent", async (_req, res) => {
    try {
        const { rows } = await query(`select 
        to_agent_id as agent_id, 
        sum(net_lamports) as total_received_lamports, 
        count(*) as settlement_count 
       from settlements 
       where status = 'confirmed'
       group by to_agent_id 
       order by total_received_lamports desc 
       limit 50`);
        res.json(rows || []);
    }
    catch (error) {
        console.error("Error fetching earnings by agent:", error);
        res.status(500).json([]);
    }
});
// Platform revenue by settlement
router.get("/platform-revenue", async (_req, res) => {
    try {
        const { rows } = await query(`select 
        coalesce(sum(fee_lamports), 0) as total_fees_lamports,
        count(*) as settlement_count
       from platform_revenue`);
        res.json(rows?.[0] || { total_fees_lamports: 0, settlement_count: 0 });
    }
    catch (error) {
        console.error("Error fetching platform revenue:", error);
        res.status(500).json({ total_fees_lamports: 0, settlement_count: 0 });
    }
});
export default router;
//# sourceMappingURL=analytics.js.map