/**
 * Fail the build if a credential-shaped value is exposed via NEXT_PUBLIC_.
 *
 * Next.js inlines every `process.env.NEXT_PUBLIC_*` it finds into the client
 * bundle at build time. That is the point of the prefix — and it means naming a
 * secret with it ships the secret to every visitor's browser.
 *
 * This is not hypothetical. Three of these existed here:
 *
 *   NEXT_PUBLIC_MONOCLE_API_KEY   read by ChatPage and X402Badge; only ever held
 *                                 a placeholder, and its value is in git history
 *   NEXT_PUBLIC_ADMIN_API_KEY     last-resort fallback in lib/admin-api.ts, so
 *                                 setting it to make the admin page work would
 *                                 have published the operator's admin key
 *   NEXT_PUBLIC_BACKEND_URL       not a credential, but setting it strips the
 *                                 session cookie and the server-side key from
 *                                 every request — hence the URL allowance below
 *
 * None leaked, but each was one line of configuration away. The pattern is the
 * hazard, so the pattern is what gets blocked.
 *
 * Runs from next.config.js, which every build loads — including
 * `opennextjs-cloudflare build`, which invokes Next directly and so never fires
 * npm's prebuild hook. Also available as `npm run lint:env`.
 */

const fs = require("fs");
const path = require("path");

/** Names that read as a credential. */
const SECRET_SHAPED = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|AUTH)/i;

/**
 * Names that contain a banned word but are legitimately public.
 * Keep this list short and justify each entry — it is the escape hatch that
 * makes the rule ignorable.
 */
const ALLOWED = new Set([
  // A publishable key is designed to be public; that is what "publishable" means.
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
]);

const SOURCE_DIRS = ["pages", "components", "lib", "hooks", "utils"];
const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SOURCE_EXT.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

function findInSources(root) {
  const hits = [];
  for (const dir of SOURCE_DIRS) {
    for (const file of walk(path.join(root, dir))) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        // Skip comments — this file's own documentation names these variables.
        const code = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
        const m = code.match(/process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g);
        if (!m) return;
        for (const raw of m) {
          const name = raw.replace("process.env.", "");
          if (ALLOWED.has(name) || !SECRET_SHAPED.test(name)) continue;
          hits.push({ where: `${path.relative(root, file)}:${i + 1}`, name });
        }
      });
    }
  }
  return hits;
}

function findInEnvFiles(root) {
  const hits = [];
  for (const f of [".env", ".env.local", ".env.production", "env.sample"]) {
    const full = path.join(root, f);
    if (!fs.existsSync(full)) continue;
    fs.readFileSync(full, "utf8")
      .split("\n")
      .forEach((line, i) => {
        const t = line.trim();
        if (!t || t.startsWith("#")) return;
        const m = t.match(/^(NEXT_PUBLIC_[A-Z0-9_]+)\s*=/);
        if (!m) return;
        const name = m[1];
        if (ALLOWED.has(name) || !SECRET_SHAPED.test(name)) return;
        hits.push({ where: `${f}:${i + 1}`, name });
      });
  }
  return hits;
}

function checkPublicEnv({ root = process.cwd(), throwOnViolation = true } = {}) {
  const hits = [...findInSources(root), ...findInEnvFiles(root)];
  if (hits.length === 0) return [];

  const lines = [
    "",
    "  Credential-shaped NEXT_PUBLIC_ variable(s) found:",
    "",
    ...hits.map((h) => `    ${h.name}   (${h.where})`),
    "",
    "  NEXT_PUBLIC_ values are inlined into the client bundle, so this ships the",
    "  value to every visitor's browser.",
    "",
    "  Read it server-side instead (an unprefixed name, used in an API route or",
    "  pages/api/proxy), or rename it if it genuinely is not a secret. If it is",
    "  public by design, add it to ALLOWED in scripts/check-public-env.js with a",
    "  reason.",
    "",
  ].join("\n");

  if (throwOnViolation) throw new Error(lines);
  console.error(lines);
  return hits;
}

module.exports = { checkPublicEnv };

// Direct invocation: `node scripts/check-public-env.js`
if (require.main === module) {
  try {
    checkPublicEnv({ root: path.join(__dirname, "..") });
    console.log("check-public-env: no credential-shaped NEXT_PUBLIC_ variables found");
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
