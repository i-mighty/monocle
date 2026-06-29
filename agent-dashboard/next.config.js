const { setupDevPlatform } = process.env.NODE_ENV === "development"
  ? require("@cloudflare/next-on-pages/next-dev")
  : { setupDevPlatform: () => {} };

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

if (process.env.NODE_ENV === "development") {
  setupDevPlatform().catch(console.error);
}

module.exports = nextConfig;
