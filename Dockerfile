FROM oven/bun:1.3.14-alpine
ARG POSTGRES_MAJOR=17
WORKDIR /app
# PostgreSQL client and AWS CLI for backup and restore commands.
RUN apk add --no-cache postgresql${POSTGRES_MAJOR}-client aws-cli
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src ./src
COPY drizzle ./drizzle
COPY tsconfig.json ./
CMD ["tail", "-f", "/dev/null"]
