#!/bin/bash

# Substitute PORT environment variable into Nginx config
envsubst '${PORT}' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf

# 1. Start MongoDB in the background (Self-Sustained Mode)
# This allows the project to run on its own without MongoDB Atlas or external dbs.
echo "Initializing and starting local MongoDB database..."
mkdir -p /data/db
mongod --fork --logpath /var/log/mongodb.log --dbpath /data/db --bind_ip 127.0.0.1

# 2. Start Nginx in the background
echo "Starting Nginx reverse proxy on port $PORT..."
nginx -g "daemon off;" &

# 3. Start the FastAPI backend
# Note: mongo.py defaults to localhost:27017, so it will connect automatically.
echo "Starting Python FastAPI backend..."
uvicorn app.main:app --host 127.0.0.1 --port 8000
