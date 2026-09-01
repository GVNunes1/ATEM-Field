FROM node:22-bookworm-slim AS frontend-build

WORKDIR /workspace/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build


FROM node:22-bookworm-slim AS backend-build

WORKDIR /workspace/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/tsconfig.json ./
COPY backend/src/ ./src/
RUN npm run build


FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=8080 \
    PYTHONUNBUFFERED=1 \
    PYTHON_EXECUTABLE=/opt/atem-python/bin/python \
    CHROMIUM_EXECUTABLE=/usr/bin/chromium-headless-shell \
    MALLOC_ARENA_MAX=2

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3 python3-venv chromium-headless-shell fontconfig fonts-liberation \
    && fc-cache -f \
    && python3 -m venv /opt/atem-python \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/backend

COPY backend/requirements-google-calendar.txt ./
RUN /opt/atem-python/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/atem-python/bin/pip install --no-cache-dir -r requirements-google-calendar.txt

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

COPY --from=backend-build --chown=node:node /workspace/backend/dist ./dist
COPY --chown=node:node backend/data/support-faq.json ./data/support-faq.json
COPY --chown=node:node backend/src/services/*.py ./src/services/
COPY --chown=node:node backend/src/services/service_order_template.html ./src/services/service_order_template.html
COPY --from=frontend-build --chown=node:node /workspace/frontend/dist /workspace/frontend/dist

RUN mkdir -p /workspace/backend/data \
    && chown -R node:node /workspace

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || '8080') + '/health').then(response => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

CMD ["node", "dist/server.js"]
