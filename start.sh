#!/bin/bash

# AgentPay One-Button Start Script
echo "🚀 Starting AgentPay with Docker Compose..."
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Start services
docker-compose up


