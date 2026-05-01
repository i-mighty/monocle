FROM node:20-alpine AS builder

WORKDIR /app

# Build-time public env (Railway forwards service vars when ARG names match)
ARG NEXT_PUBLIC_BACKEND_URL
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_MONOCLE_API_URL
ARG NEXT_PUBLIC_MONOCLE_API_KEY
ARG NEXT_PUBLIC_REPUTATION_URL
ARG NEXT_PUBLIC_ADMIN_API_KEY
ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_MONOCLE_API_URL=$NEXT_PUBLIC_MONOCLE_API_URL \
    NEXT_PUBLIC_MONOCLE_API_KEY=$NEXT_PUBLIC_MONOCLE_API_KEY \
    NEXT_PUBLIC_REPUTATION_URL=$NEXT_PUBLIC_REPUTATION_URL \
    NEXT_PUBLIC_ADMIN_API_KEY=$NEXT_PUBLIC_ADMIN_API_KEY

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

EXPOSE 3000

CMD ["node", "server.js"]
