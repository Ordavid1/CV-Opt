# Multi-stage build for smaller image size
FROM node:18-alpine AS builder

WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies (including devDependencies for building)
RUN npm ci

# Copy source code
COPY . .

# Build the application if there's a build step
RUN npm run build --if-present

# Production stage
FROM node:18-alpine

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Copy application files from builder
COPY --from=builder --chown=nodejs:nodejs /usr/src/app .

# Set user
USER nodejs

# Environment variables
ENV PORT=8080
ENV NODE_ENV=production
ENV HOST=0.0.0.0

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
  CMD curl -f http://0.0.0.0:${PORT}/health || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "index.mjs"]