FROM node:22-alpine

WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY server.js .
COPY routes ./routes
COPY utils ./utils
COPY middleware ./middleware
COPY public ./public

EXPOSE 8080
CMD ["node", "server.js"]
