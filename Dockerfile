FROM node:22-alpine

WORKDIR /app

# Instalar dependências necessárias para compilação e execução
RUN apk add --no-cache python3 make g++

# Render recomenda runtime Node LTS atual; npm atualizado reduz problemas de lockfile.
RUN npm install --global npm@latest

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .
RUN npm run build

EXPOSE 7000

CMD ["sh", "-c", "npm run migrate && npm run start:stremio"]
