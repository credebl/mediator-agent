FROM node:22 AS base

RUN apt-get update && \
  apt-get upgrade -y && \
  npm install -g corepack@latest && \
  corepack enable && \
  apt-get clean && \
  rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . /app

RUN pnpm install --frozen-lockfile
RUN pnpm build

# Install jemalloc to help with memory fragmentation in long-running node processes
# See https://jemalloc.net/
RUN apt-get update && apt-get install -y --no-install-recommends \
    libjemalloc2 \
 && rm -rf /var/lib/apt/lists/*

# Don't run production as root
RUN addgroup --system --gid 1001 agent && \
  adduser --system --uid 1001 agent && \
  mkdir -p /nonexistent && \
  chown agent:agent /nonexistent

USER agent

ENTRYPOINT [ "pnpm", "start" ]
