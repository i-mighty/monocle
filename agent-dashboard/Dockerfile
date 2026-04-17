FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./
COPY next-env.d.ts ./
COPY next.config.js* ./

# Install dependencies
RUN npm ci

# Copy source code and config
COPY tailwind.config.js ./
COPY postcss.config.js ./
COPY pages ./pages
COPY components ./components
COPY lib ./lib
COPY styles ./styles
COPY hooks ./hooks

# Build Next.js
RUN npm run build

# Production image
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy standalone build
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

CMD ["node", "server.js"]
