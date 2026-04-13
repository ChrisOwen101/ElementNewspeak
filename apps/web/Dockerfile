# syntax=docker.io/docker/dockerfile:1.21-labs@sha256:2e681d22e86e738a057075f930b81b2ab8bc2a34cd16001484a7453cfa7a03fb

# Builder
FROM --platform=$BUILDPLATFORM node:24-bullseye@sha256:d83f76ec9956d35fe14221022e8b5a87a5de6fcdb4edb1187eddeb7dc80cba71 AS builder

# Support custom branch of the js-sdk. This also helps us build images of element-web develop.
ARG USE_CUSTOM_SDKS=false
ARG JS_SDK_REPO="https://github.com/matrix-org/matrix-js-sdk.git"
ARG JS_SDK_BRANCH="master"

WORKDIR /src

COPY --exclude=docker . /src
RUN corepack enable
# Required for pnpm to operate non-interactively (no TTY in Docker build context)
ENV CI=true
# Install all workspace dependencies. matrix-js-sdk is pulled from the GitHub
# tarball specified in package.json; its prepare script builds it automatically
# (allowed via onlyBuiltDependencies in the root package.json).
# No docker-link-repos.sh needed — that's the old yarn approach.
RUN pnpm install
# Build directly with a static version string.
# We skip docker-package.sh / get-version-from-git.sh because they assume
# matrix-js-sdk is a git checkout inside node_modules.
ARG VERSION=docker
ARG GENERATE_API_URL=http://localhost:3001/generate
ENV GENERATE_API_URL=$GENERATE_API_URL
# Limit Node heap to prevent OOM kills on small servers (e.g. 2-4GB Hetzner).
# Disable Terser parallelism to reduce peak memory during minification.
ENV NODE_OPTIONS="--max-old-space-size=1536"
RUN VERSION=$VERSION pnpm --dir apps/web build

# Copy the config now so that we don't create another layer in the app image
RUN cp /src/apps/web/config.sample.json /src/apps/web/webapp/config.json

# App
FROM nginxinc/nginx-unprivileged:alpine-slim@sha256:800307aaf07c143f5d90aa9d4269cc1971dcfe5aee7cabd11579ac4c6bcf198f

# Need root user to install packages & manipulate the usr directory
USER root

# Install jq and moreutils for sponge, both used by our entrypoints
RUN apk add jq moreutils

COPY --from=builder /src/apps/web/webapp /app

# Override default nginx config. Templates in `/etc/nginx/templates` are passed
# through `envsubst` by the nginx docker image entry point.
COPY /apps/web/docker/nginx-templates/* /etc/nginx/templates/
COPY /apps/web/docker/docker-entrypoint.d/* /docker-entrypoint.d/

RUN rm -rf /usr/share/nginx/html \
  && ln -s /app /usr/share/nginx/html

# Run as nginx user by default
USER nginx

# HTTP listen port
ENV ELEMENT_WEB_PORT=80

HEALTHCHECK --start-period=5s CMD wget -q --spider http://localhost:$ELEMENT_WEB_PORT/config.json
