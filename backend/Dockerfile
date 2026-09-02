FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Dependências nascem somente dentro da imagem. As cópias explícitas abaixo
# impedem que um node_modules do contexto sobrescreva o resultado do npm ci.
COPY package.json package-lock.json ./
RUN npm ci \
    && node --input-type=module -e "await import('express')"

COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts

# Se uma dependência ou o Prisma estiverem incompletos, o build para aqui em
# vez de publicar uma imagem que entra em reinício contínuo em produção.
RUN npx prisma generate \
    && node --check src/server.js \
    && node --input-type=module -e "await import('express')"
ENV PORT=4000
EXPOSE 4000
# Sincroniza o schema com o banco antes de subir (Testimonial não tem migration)
CMD ["sh", "-c", "npx prisma db push --skip-generate && node src/server.js"]
