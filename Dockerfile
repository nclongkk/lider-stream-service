FROM node:14-alpine

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm install

COPY . .

EXPOSE 5001

CMD ["node", "server.js"]
