FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json* /app/
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
COPY . /app
EXPOSE 8080
CMD ["node","--experimental-strip-types","/app/src/index.ts"]
