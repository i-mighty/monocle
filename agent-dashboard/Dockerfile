FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./
COPY next-env.d.ts ./
COPY next.config.js* ./

# Install dependencies
RUN npm ci

# Copy source code
COPY pages ./pages
COPY components ./components
COPY lib ./lib

# Build Next.js
RUN npm run build

# Production image
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy built files
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/next-env.d.ts ./

EXPOSE 3000

CMD ["npm", "start"]
