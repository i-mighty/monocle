const base = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

export async function fetchJson(path: string, init?: RequestInit) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const getUsage = () => fetchJson("/dashboard/usage");
export const getReceipts = () => fetchJson("/pay");
export const getToolLogs = () => fetchJson("/meter/logs");
export const getEarnings = () => fetchJson("/dashboard/earnings");
export const getEarningsByAgent = () => fetchJson("/dashboard/earnings/by-agent");

