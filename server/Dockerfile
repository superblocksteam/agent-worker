# Deploy image
FROM node:16-bullseye-slim

RUN set -ex; \
  apt-get update && \
  apt-get install -yqq dumb-init --no-install-recommends && \
  rm -rf /var/lib/apt/lists/*

ENV NODE_ENV production
USER node
WORKDIR /usr/app

COPY packages/shared /usr/app/shared
COPY packages/shared-backend /usr/app/shared-backend
COPY packages/worker/client /usr/app/worker/client
COPY packages/worker/server/node_modules /usr/app/worker/server/node_modules
COPY packages/worker/server/dist /usr/app/worker/server/dist
COPY packages/worker/server/package.json /usr/app/worker/server
WORKDIR /usr/app/worker/server/dist

ARG INTERNAL_TAG
ENV SUPERBLOCKS_WORKER_VERSION=$INTERNAL_TAG

CMD ["dumb-init", "node", "entry.js"]
