FROM node:24-bookworm

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV ELECTRON_DISABLE_SECURITY_WARNINGS=true

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnss3 \
    libx11-xcb1 \
    libxcb-dri3-0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    libxshmfence1 \
    libxss1 \
    libxtst6 \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps ./apps
COPY packages ./packages
COPY patches ./patches
COPY scripts ./scripts
COPY multimodal ./multimodal

RUN corepack enable && corepack pnpm install --frozen-lockfile --ignore-scripts

CMD ["corepack", "pnpm", "run", "docker:build"]
