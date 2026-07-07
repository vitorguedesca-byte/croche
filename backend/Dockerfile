FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
ENV PORT=4000
EXPOSE 4000
# Sincroniza o schema com o banco antes de subir (Testimonial não tem migration)
CMD ["sh", "-c", "npx prisma db push --skip-generate && node src/server.js"]
