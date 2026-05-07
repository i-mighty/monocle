FROM node:20-alpine AS builder

WORKDIR /app

# Build-time public env. NEXT_PUBLIC_* values get inlined into the JS
# bundle, so NEVER list secrets here — only URLs that are safe to expose.
# All authenticated calls now go via /api/proxy/* which runs server-side.
ARG NEXT_PUBLIC_BACKEND_URL
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_MONOCLE_API_URL
ARG NEXT_PUBLIC_REPUTATION_URL
ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_MONOCLE_API_URL=$NEXT_PUBLIC_MONOCLE_API_URL \
    NEXT_PUBLIC_REPUTATION_URL=$NEXT_PUBLIC_REPUTATION_URL

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
COPY types ./types
COPY public ./public

# Build Next.js
RUN npm run build

# Production image
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000

# Copy standalone build
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000

CMD ["node", "server.js"]
