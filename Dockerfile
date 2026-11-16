FROM node:24-alpine AS build
WORKDIR /app
# git: the build reads the commit hash from .git
RUN apk add --no-cache git
COPY package*.json ./
RUN npm ci
# the army builder's rules come with the checkout (public/data is committed, as BSData's repositories are gone); `npm run data` refreshes them when wanted
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
