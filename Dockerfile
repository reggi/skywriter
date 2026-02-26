# Stage 1: Build application
FROM node:22-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production dependencies only
FROM node:22-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# Stage 3: Production image
FROM node:22-alpine
RUN apk add --no-cache git
WORKDIR /app
COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/pages ./pages
RUN mkdir -p uploads .git-repos
EXPOSE 3000
CMD ["node", "dist/cli/index.js", "host", "--migrate"]
