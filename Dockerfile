FROM node:22-bookworm-slim

# The onboarding worker uses the Linux flock command.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates util-linux \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /root/event-bot
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# Explicit source directories prevent accidental inclusion of workspace artifacts.
COPY bot/ ./bot/
COPY calendar-web/ ./calendar-web/
COPY slack/ ./slack/

ENV NODE_ENV=production \
    BOT_PROFILE=onlyplay \
    DATA_DIR=/data/onlyplay \
    ONBOARDING_RUNTIME=/root/event-bot/package.json

EXPOSE 8766
CMD ["npm", "run", "start:bot"]
