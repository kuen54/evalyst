# syntax=docker/dockerfile:1

# ---- deps ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build, then strip dev deps so the runner stage carries only what
# `next start` actually needs at runtime — smaller image surface.
RUN npm run build && npm prune --omit=dev

# ---- runner ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# next start 需要 .next / public / node_modules / package.json + src/lib/seeds/（seed 运行时按路径读）
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/src/lib/seeds ./src/lib/seeds
# skills served by /api/skills/[name] — used by AgentHintBanner download links
COPY --from=builder /app/.claude/skills ./.claude/skills

# 运行时数据目录（实验 / 结果 / 数据集 / llm-config），通过 volume 挂载持久化
RUN mkdir -p /app/data && chown -R node:node /app
VOLUME /app/data

# Drop privileges — node:20-alpine ships with a built-in `node` user (uid 1000).
# Avoids running the long-lived next start process as root.
USER node

EXPOSE 3000
CMD ["npx", "next", "start"]
