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
# the build has no git history (.dockerignore): pass the commit in with --build-arg GIT_HASH=$(git rev-parse HEAD)
ARG GIT_HASH=unknown
RUN GIT_HASH=$GIT_HASH npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data
COPY --from=build /app/dist ./dist
COPY server ./server
VOLUME /data
EXPOSE 3000
CMD ["node", "server/index.mjs"]
