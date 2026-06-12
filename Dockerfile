# Blumind Web — container image
FROM node:20-slim

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

# Fonts so server-side raster/PDF export renders text + emoji correctly.
# Liberation Sans is metric-compatible with Arial (matches the on-screen font).
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-liberation fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first for better layer caching
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# App source
COPY . .

# Writable data dir + drop root
RUN mkdir -p /data && chown -R node:node /app /data
USER node

EXPOSE 3000
VOLUME ["/data"]

CMD ["node", "server.js"]
