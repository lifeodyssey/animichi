# The anitabi egress service (#1792). Build context is the REPOSITORY ROOT
# (see fly.toml [build]); the image is a single self-contained bundle — the
# service has no runtime dependencies beyond Node itself, no product data, no
# data-plane credential, and no write path beyond the ceiling's own counter
# (#1810), which is an external store the service reaches over TCP (#1824).
#
#   docker build -f apps/anitabi-egress/Dockerfile .

FROM node:26-bookworm-slim AS build
WORKDIR /app
RUN npm install -g corepack && corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/anitabi-egress/package.json apps/anitabi-egress/
# The frozen install reads `patchedDependencies` even under `--filter`, so the
# lockfile's patch must be present or the install fails before the build.
COPY packages/pi-session-neon/patches packages/pi-session-neon/patches
RUN pnpm install --frozen-lockfile --filter anitabi-egress --ignore-scripts
COPY apps/anitabi-egress apps/anitabi-egress
RUN pnpm --filter anitabi-egress build

FROM node:26-bookworm-slim
WORKDIR /app
COPY --from=build /app/apps/anitabi-egress/dist/server.mjs server.mjs
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
