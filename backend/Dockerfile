# ---- dependencies ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
# The Prisma CLI is a runtime dependency here rather than a dev one, because the
# container applies its own migrations on start and therefore needs the CLI in
# the image.
RUN npm ci --omit=dev

# ---- runtime ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Run as a non-root user: a container breakout should not land on root.
RUN addgroup -g 1001 -S nodejs && adduser -S app -u 1001

COPY --from=deps /app/node_modules ./node_modules
COPY --chown=app:nodejs . .

# Generated at build time so the first request does not pay for it, and so a
# schema the client does not match fails the build instead of production.
RUN npx prisma generate && chmod +x docker/entrypoint.sh && chown -R app:nodejs /app

USER app
EXPOSE 3000

# Aimed at the real health route. A healthcheck pointed at a path that does not
# exist reports the container unhealthy forever, and whoever meets that first
# spends an hour looking for a fault in the application.
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/v1/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["./docker/entrypoint.sh"]
CMD ["node", "server.js"]
