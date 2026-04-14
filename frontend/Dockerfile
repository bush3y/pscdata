FROM node:20-slim AS base

WORKDIR /app
COPY package.json ./
RUN npm install

# ── Development stage ──────────────────────────────────────────────────────────
FROM base AS development

COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev"]

# ── Production build stage ─────────────────────────────────────────────────────
FROM base AS builder

COPY . .
RUN npm run build

# ── Production stage (nginx) ───────────────────────────────────────────────────
FROM nginx:1.27-alpine AS production

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
