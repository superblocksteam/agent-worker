# Deploy image
FROM python:3.9-slim-buster
RUN groupadd --gid 1000 node \
  && useradd --uid 1000 --gid node --shell /bin/bash --create-home node

# Replace with the branch of Node.js or io.js you want to install: node_6.x, node_8.x, etc...
ENV NODE_VERSION node_16.x

RUN set -ex; \
  apt-get update && \
  apt-get install -yqq gcc gnupg libc6-dev libpq-dev wget dnsutils iputils-ping curl --no-install-recommends && \
  wget --quiet -O -  https://deb.nodesource.com/setup_lts.x | bash - && \
  apt-get install -yqq nodejs dumb-init --no-install-recommends && \
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
COPY packages/worker/server/requirements.txt /usr/app/packages/misc/requirements.txt
RUN pip3 install -r /usr/app/packages/misc/requirements.txt
WORKDIR /usr/app/worker/server/dist

ARG INTERNAL_TAG
ENV SUPERBLOCKS_WORKER_VERSION=$INTERNAL_TAG

CMD ["dumb-init", "node", "entry.js"]
