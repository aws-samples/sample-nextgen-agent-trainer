# Multi-stage build for smaller production image (AWS ECS best practice)
# Reference: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/security-tasks-containers.html
FROM --platform=linux/amd64 node:22-alpine AS builder

# Patch OS-level vulnerabilities in builder stage
RUN apk upgrade --no-cache

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production stage - minimal image following AWS ECS security best practices
FROM --platform=linux/amd64 node:22-alpine AS production

# Set NODE_ENV for production optimizations
ENV NODE_ENV=production

# Patch all OS-level vulnerabilities and install runtime dependencies
# dumb-init: proper signal handling for graceful shutdown (ECS SIGTERM)
# curl: required for container health checks
RUN apk upgrade --no-cache && \
    apk add --no-cache curl dumb-init

# Remove setuid/setgid binaries to prevent privilege escalation (AWS best practice)
RUN find / -xdev -perm /6000 -type f -exec chmod a-s {} \; 2>/dev/null || true

# Create non-root user for security (AWS ECS best practice)
# Running as root expands attack surface - always use non-root user
# Note: node:22-alpine already has 'node' user with uid/gid 1000, so we use different ids
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

WORKDIR /app

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn*

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Change ownership to non-root user
RUN chown -R nodejs:nodejs /app

# Switch to non-root user (AWS ECS best practice)
USER nodejs

# Expose the application port
EXPOSE 3000

# ECS health check - used by ECS agent for container health monitoring
# Note: ECS task definition health checks take precedence if configured
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Use dumb-init as PID 1 to handle signals properly (AWS ECS best practice)
# Ensures graceful shutdown when ECS sends SIGTERM during deployments/scaling
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
