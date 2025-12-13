# AgentPay One-Button Start Script (PowerShell)
Write-Host "🚀 Starting AgentPay with Docker Compose..." -ForegroundColor Green
Write-Host ""

# Check if Docker is running
try {
    docker info | Out-Null
} catch {
    Write-Host "❌ Docker is not running. Please start Docker first." -ForegroundColor Red
    exit 1
}

# Start services
docker-compose up


