FROM oven/bun:alpine
WORKDIR /app
# pg client (matches the Postgres 17 server) + aws-cli for R2 backups.
RUN apk add --no-cache postgresql17-client aws-cli
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src ./src
COPY migrations ./migrations
COPY tsconfig.json ./
CMD ["tail", "-f", "/dev/null"]
