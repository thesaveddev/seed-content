# ── Stage 1: build web frontend ──
FROM node:22-alpine AS web-build
WORKDIR /app/web
COPY web/package.json web/package-lock.json* ./
RUN npm ci || npm install
COPY web/ ./
RUN npm run build

# ── Stage 2: build server ──
FROM node:22-alpine AS server-build
WORKDIR /app/server
COPY server/package.json server/package-lock.json* ./
RUN npm ci || npm install
COPY server/ ./
RUN npm run build

# ── Stage 3: production runtime ──
FROM node:22-alpine
WORKDIR /app

# Copy server source + node_modules + built output
COPY --from=server-build /app/server /app/server
# Copy built frontend into the location server/src/index.ts serves in production
COPY --from=web-build /app/web/dist /app/web/dist

ENV NODE_ENV=production
EXPOSE 3001

WORKDIR /app/server
CMD ["node", "dist/index.js"]
