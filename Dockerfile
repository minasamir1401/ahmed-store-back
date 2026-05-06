FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# DATABASE_URL should be provided via environment variables
RUN npx prisma generate

# Ensure uploads directory exists
RUN mkdir -p uploads

RUN chmod +x entrypoint.sh

EXPOSE 5000

ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "index.js"]
