# AgentPay Docker Test Script
Write-Host "[TEST] Testing AgentPay Docker Setup..." -ForegroundColor Green
Write-Host ""

# Test 1: Identity Verification
Write-Host "[1] Testing Identity Verification..." -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri "http://localhost:3001/verify-identity" `
        -Method POST `
        -Headers @{
            "Content-Type" = "application/json"
            "x-api-key" = "test_dev_key_123"
        } `
        -Body (@{
            firstName = "John"
            lastName = "Doe"
            dob = "1990-01-01"
            idNumber = "ID123"
        } | ConvertTo-Json)
    Write-Host "[OK] Identity verified!" -ForegroundColor Green
    Write-Host "   Response: $($response | ConvertTo-Json -Compress)" -ForegroundColor Gray
} catch {
    Write-Host "[FAIL] Identity test failed: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Test 2: Meter Logging
Write-Host "[2] Testing Meter Logging..." -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri "http://localhost:3001/meter/log" `
        -Method POST `
        -Headers @{
            "Content-Type" = "application/json"
            "x-api-key" = "test_dev_key_123"
        } `
        -Body (@{
            agentId = "agent_123"
            toolName = "summary"
            tokensUsed = 42
        } | ConvertTo-Json)
    Write-Host "[OK] Meter logged!" -ForegroundColor Green
    Write-Host "   Response: $($response | ConvertTo-Json -Compress)" -ForegroundColor Gray
} catch {
    Write-Host "[FAIL] Meter test failed: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Test 3: Get Meter Logs
Write-Host "[3] Testing Get Meter Logs..." -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri "http://localhost:3001/meter/logs" `
        -Method GET `
        -Headers @{
            "x-api-key" = "test_dev_key_123"
        }
    Write-Host "[OK] Retrieved logs!" -ForegroundColor Green
    Write-Host "   Found $($response.Count) log entries" -ForegroundColor Gray
    if ($response.Count -gt 0) {
        Write-Host "   Latest: $($response[0] | ConvertTo-Json -Compress)" -ForegroundColor Gray
    }
} catch {
    Write-Host "[FAIL] Get logs failed: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Test 4: Dashboard
Write-Host "[4] Testing Dashboard..." -ForegroundColor Cyan
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing
    if ($response.StatusCode -eq 200) {
        Write-Host "[OK] Dashboard is accessible!" -ForegroundColor Green
        Write-Host "   Open http://localhost:3000 in your browser" -ForegroundColor Yellow
    }
} catch {
    Write-Host "[FAIL] Dashboard test failed: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

Write-Host "[DONE] Testing complete!" -ForegroundColor Green
Write-Host ""
Write-Host "View logs: docker-compose logs -f" -ForegroundColor Cyan
Write-Host "Dashboard: http://localhost:3000" -ForegroundColor Cyan
Write-Host "API: http://localhost:3001" -ForegroundColor Cyan

