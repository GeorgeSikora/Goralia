# Obraz serveru Goralia: Node + jen produkční závislosti, data/ a maps/ přicházejí zvenku jako volume.
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Server běží pod uživatelem node, práva zahazuje docker/start.js po srovnání vlastníka data/ a maps/.
ENV PORT=8300 GORALIA_DATA_DIR=/app/data GORALIA_MAPS_DIR=/app/maps
EXPOSE 8300

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8300) + '/robots.txt').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", "docker/start.js"]
