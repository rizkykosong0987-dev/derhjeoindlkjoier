FROM ghcr.io/puppeteer/puppeteer:latest

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

CMD ["node", "index.js"]