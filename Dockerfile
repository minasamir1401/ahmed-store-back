FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

ENV DATABASE_URL=file:./prisma/dev.db
RUN npx prisma generate

# Backup the initial database file as a template outside prisma to survive volume mount
RUN mkdir -p prisma uploads prisma-backup && \
    cp prisma/dev.db prisma-backup/dev.db.template 2>/dev/null || true

RUN chmod +x entrypoint.sh

EXPOSE 5000

ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "index.js"]
