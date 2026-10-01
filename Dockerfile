# syntax=docker/dockerfile:1

# ---------- 1. Build the React frontend ----------
FROM node:22-alpine AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---------- 2. Python runtime (CPU only) ----------
FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TF_CPP_MIN_LOG_LEVEL=2 \
    CUDA_VISIBLE_DEVICES=-1 \
    SIGNIA_DATA_DIR=/data \
    SIGNIA_FRONTEND_DIST=/app/frontend/dist

WORKDIR /app/backend
COPY backend/requirements.txt ./
# MediaPipe depends on the GUI build of OpenCV, which needs system GL libraries.
# Swap it for the headless build so the image needs no extra system packages.
RUN pip install -r requirements.txt \
    && pip uninstall -y opencv-contrib-python \
    && pip install --no-deps opencv-contrib-python-headless==4.11.0.86 \
    && python -c "import cv2, mediapipe, tensorflow; print('cv2', cv2.__version__, '| mediapipe', mediapipe.__version__, '| tf', tensorflow.__version__)"

COPY backend/app ./app
COPY backend/pretrained ./pretrained
COPY --from=frontend /frontend/dist /app/frontend/dist

RUN useradd --create-home --uid 1000 signia \
    && mkdir -p /data && chown signia:signia /data
USER signia
VOLUME ["/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--ws-max-size", "4194304"]
