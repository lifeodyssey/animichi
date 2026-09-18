# The anitabi egress service (#1792). Build context is the REPOSITORY ROOT
# (see fly.toml [build]); the image is a single self-contained bundle — the
# service has no runtime dependencies beyond Node itself, and no database, no
# user data, no write path.
#
#   docker build -f apps/anitabi-egress/Dockerfile .

FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/anitabi-egress/package.json apps/anitabi-egress/
RUN pnpm install --frozen-lockfile --filter anitabi-egress --ignore-scripts
COPY apps/anitabi-egress apps/anitabi-egress
RUN pnpm --filter anitabi-egress build

FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=build /app/apps/anitabi-egress/dist/server.mjs server.mjs
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
