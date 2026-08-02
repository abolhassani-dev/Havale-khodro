# ---- dependencies ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ---- runtime ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Run as a non-root user: a container breakout should not land on root.
RUN addgroup -g 1001 -S nodejs && adduser -S app -u 1001

COPY --from=deps /app/node_modules ./node_modules
COPY --chown=app:nodejs . .

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
