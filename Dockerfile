# -- Phase 1: Build the React frontend --
FROM node:18-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# -- Phase 2: Full-stack image (Python + Nginx + MongoDB) --
# Using bullseye explicitly to match the MongoDB repository version and avoid GPG SHA1 rejection in newer Debian versions
FROM python:3.10-slim-bullseye

# Install core system dependencies
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    tesseract-ocr \
    gettext-base \
    nginx \
    procps \
    curl \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

# Install local MongoDB to make the project "self-sustained"
RUN curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | \
   gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg
RUN echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] http://repo.mongodb.org/apt/debian bullseye/mongodb-org/7.0 main" | \
   tee /etc/apt/sources.list.d/mongodb-org-7.0.list
RUN apt-get update && apt-get install -y mongodb-org-server \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python backend dependencies
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY backend/ ./

# Copy the frontend built assets from Phase 1 to Nginx distribution folder
COPY --from=frontend-builder /app/frontend/dist /usr/share/nginx/html

# Copy deployment configurations
COPY deployment/nginx_codehost.conf /etc/nginx/conf.d/default.conf.template
RUN rm -f /etc/nginx/sites-enabled/default

COPY deployment/start_codehost.sh /start.sh
RUN chmod +x /start.sh

# Pre-create MongoDB data directory
RUN mkdir -p /data/db && chown -R www-data:www-data /data/db

# CodeHost assigns a dynamic PORT via environment variable
ENV PORT=80
EXPOSE 80

CMD ["/start.sh"]
