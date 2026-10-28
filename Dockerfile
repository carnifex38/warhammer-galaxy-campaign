FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# the build has no git history (.dockerignore): pass the commit in with --build-arg GIT_HASH=$(git rev-parse HEAD)
ARG GIT_HASH=unknown
RUN GIT_HASH=$GIT_HASH npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data
COPY --from=build /app/dist ./dist
COPY server ./server
VOLUME /data
EXPOSE 3000
CMD ["node", "server/index.mjs"]
