FROM node:20-alpine

WORKDIR /app

# Install Chromium and required system dependencies for Puppeteer + wget for healthcheck
RUN apk add --no-cache \
    python3 \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    udev \
    wget \
    openssl

# Tell Puppeteer to use the installed Chromium instead of downloading one
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

COPY package*.json ./
RUN npm ci --only=production

COPY . .

COPY requirements.txt ./
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt

# Generate Prisma client (PostgreSQL)
RUN npx prisma generate

RUN chmod +x entrypoint.sh

EXPOSE 5000

ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "index.js"]
