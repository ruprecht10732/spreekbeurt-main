# Stage 1: Build
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

ARG GEMINI_API_KEY
RUN sed -i "s|'YOUR_GEMINI_API_KEY'|'${GEMINI_API_KEY}'|g" angular.json

RUN npx ng build --configuration production

# Stage 2: Production runtime
FROM node:22-alpine AS production

ENV NODE_ENV=production
ENV PORT=4000

WORKDIR /app

COPY --from=build /app/dist/app ./dist/app

# Only install production dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Don't run as root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 4000

CMD ["node", "dist/app/server/server.mjs"]
