#!/bin/bash

# Script to reliably start the PostgreSQL database container
# Handles cases where the container already exists or is stopped

set -e

CONTAINER_NAME="quandoc-postgres"

# Check if container exists
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Container ${CONTAINER_NAME} exists"
    
    # Check if it's running
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        echo "Container ${CONTAINER_NAME} is already running"
    else
        echo "Starting existing container ${CONTAINER_NAME}..."
        docker start ${CONTAINER_NAME}
    fi
else
    echo "Creating and starting container ${CONTAINER_NAME}..."
    docker-compose up -d
fi

# Wait for database to be ready
echo "Waiting for database to be ready..."
max_attempts=30
attempt=0

while [ $attempt -lt $max_attempts ]; do
    if docker exec ${CONTAINER_NAME} pg_isready -U astrodoc > /dev/null 2>&1; then
        echo "✓ Database is ready!"
        exit 0
    fi
    attempt=$((attempt + 1))
    echo "Waiting... ($attempt/$max_attempts)"
    sleep 1
done

echo "✗ Database failed to become ready after $max_attempts seconds"
exit 1
