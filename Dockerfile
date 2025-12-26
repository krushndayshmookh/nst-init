FROM node:22-alpine

WORKDIR /app
COPY package.json ./package.json
RUN npm install --omit=dev

COPY server.js ./server.js
COPY public ./public

ENV PORT=8080
ENV K8S_NAMESPACE=apps
ENV APP_ZONE=dayshmookh.work
ENV PUBLIC_DIR=/app/public

EXPOSE 8080
CMD ["node", "server.js"]
