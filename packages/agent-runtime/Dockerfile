# Inside-VM agent: headless Chromium + GPT-4o tool-use loop.
FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Pull in source after deps so deps cache survives src edits.
COPY tsconfig.json ./
COPY src ./src

# tsx runs TS directly — keeps the image small (no build step).
RUN npm install --no-save --no-audit --no-fund tsx@^4.16.2

ENV NODE_ENV=production
ENV NODE_NO_WARNINGS=1

CMD ["npx", "tsx", "src/index.ts"]
