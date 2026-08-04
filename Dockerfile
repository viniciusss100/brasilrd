FROM node:20-alpine

WORKDIR /app

# Instalar dependências necessárias para compilação e execução
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .
RUN npm run build

EXPOSE 7000

CMD ["sh", "-c", "npm run migrate && npm run start:stremio"]
