export function apiKeyAuth(req, res, next) {
    const provided = req.header("x-api-key");
    const expected = process.env.AGENTPAY_API_KEY;
    if (!expected)
        return res.status(500).json({ error: "API key not configured" });
    if (provided !== expected)
        return res.status(401).json({ error: "Unauthorized" });
    return next();
}
//# sourceMappingURL=apiKeyAuth.js.map