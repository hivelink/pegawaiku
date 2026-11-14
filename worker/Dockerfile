# Pekerja Asisten Otonom PegawaiKu — untuk NAS (Synology Container Manager) atau server rumah.
# Bangun dari akar repo:  docker compose -f worker/docker-compose.yml up -d --build

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src/lib ./src/lib
COPY worker ./worker
RUN npm run worker:build

FROM node:22-slim
ENV NODE_ENV=production TZ=Asia/Jakarta
WORKDIR /app
COPY --from=build /app/dist/worker.cjs ./worker.cjs
USER node
CMD ["node", "worker.cjs"]
