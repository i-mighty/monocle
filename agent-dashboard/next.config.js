/** @type {import('next').NextConfig} */
const { checkPublicEnv } = require("./scripts/check-public-env");

// Refuse to build if a credential-shaped value is exposed via NEXT_PUBLIC_.
//
// Deliberately here rather than in an npm `prebuild` hook: Cloudflare Workers
// Builds runs `opennextjs-cloudflare build`, which invokes Next directly and so
// never fires npm lifecycle scripts. next.config.js is loaded by every build and
// every dev server, which is the only place a check like this cannot be skipped
// by whoever is deploying.
//
// Throwing fails the build. That is the intent: a leaked key cannot be unshipped
// once the bundle is public, so this is worth stopping rather than warning about.
checkPublicEnv({ root: __dirname });

const nextConfig = {
  reactStrictMode: true,
};

module.exports = nextConfig;
