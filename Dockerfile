FROM node:24-alpine AS build
WORKDIR /app
# git: npm run data downloads the army builder's rules (BSData) with it
RUN apk add --no-cache git
COPY package*.json ./
RUN npm ci
# the rules data gets its own layer, so code changes do not download it again. For newer rules: docker compose build --no-cache
COPY scripts ./scripts
RUN npm run data
COPY . .
# the version shown in the app is the commit being built: read from the checkout's .git (which is why .dockerignore lets it in), or
# given with --build-arg GIT_HASH=... when there is no .git
ARG GIT_HASH=
RUN git config --global --add safe.directory /app && GIT_HASH=$GIT_HASH npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data
COPY --from=build /app/dist ./dist
COPY server ./server
VOLUME /data
EXPOSE 3000
CMD ["node", "server/index.mjs"]
