FROM node:22-slim
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data TRUST_PROXY=1
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "src/main.js"]
