# syntax=docker/dockerfile:1
#
# Immagine unica: backend Node.js che serve anche il frontend compilato, più Pandoc,
# LibreOffice headless, Tesseract (italiano e inglese) e OCRmyPDF.
# Build:  docker compose build      Avvio: docker compose up -d
#
# Versioni fissate: Node 24 LTS su Debian 13 "trixie". I pacchetti Debian di una release stabile
# ricevono solo correzioni di sicurezza, quindi le versioni degli strumenti restano coerenti.
ARG NODE_IMAGE=node:24.19.0-trixie-slim
ARG PNPM_VERSION=10.34.9

# ---------- 1. Compilazione di frontend e backend ----------
FROM ${NODE_IMAGE} AS build
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
RUN pnpm install --frozen-lockfile
COPY packages/shared packages/shared
COPY apps/backend apps/backend
COPY apps/frontend apps/frontend
RUN pnpm build

# ---------- 2. Sole dipendenze di produzione del backend ----------
FROM ${NODE_IMAGE} AS prod-deps
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
RUN pnpm install --frozen-lockfile --prod --filter "@md-converter/backend..."

# ---------- 3. Immagine finale ----------
FROM ${NODE_IMAGE} AS runtime
ENV DEBIAN_FRONTEND=noninteractive
# --no-install-recommends evita centinaia di MB di pacchetti grafici non necessari.
# libreoffice-draw-nogui contiene il filtro di importazione PDF usato da PDF → DOCX alta fedeltà.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    pandoc \
    libreoffice-writer-nogui \
    libreoffice-draw-nogui \
    tesseract-ocr \
    tesseract-ocr-ita \
    tesseract-ocr-eng \
    ocrmypdf \
    fonts-dejavu-core \
    fonts-liberation2 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/backend/package.json ./apps/backend/package.json
COPY --from=build /app/apps/backend/dist ./apps/backend/dist
COPY --from=build /app/apps/backend/assets ./apps/backend/assets
COPY --from=build /app/apps/frontend/dist ./apps/frontend/dist
COPY docker/healthcheck.mjs ./docker/healthcheck.mjs

# Dentro il container il server deve ascoltare su tutte le interfacce del container stesso,
# altrimenti Docker non può inoltrare la porta. L'esposizione verso l'esterno è limitata da
# docker-compose.yml, che pubblica la porta solo su 127.0.0.1 del computer host.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    ALLOW_NON_LOOPBACK=true \
    PORT=8080 \
    TEMP_DIR=/tmp/md-converter \
    HOME=/tmp/home

# Utente non privilegiato già presente nell'immagine Node (uid 1000).
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD ["node", "/app/docker/healthcheck.mjs"]
CMD ["node", "apps/backend/dist/index.js"]
