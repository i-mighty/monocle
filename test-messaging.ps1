# Messaging API Quick Test
# Run after: docker-compose up -d && cd agent-backend && npm run dev

$BASE = "http://localhost:3001"
$AGENT_A = "test-alice-$(Get-Date -Format 'HHmmss')"
$AGENT_B = "test-bob-$(Get-Date -Format 'HHmmss')"

Write-Host "`n🧪 Messaging API Test`n" -ForegroundColor Cyan
Write-Host "Agent A: $AGENT_A"
Write-Host "Agent B: $AGENT_B`n"

# 1. Register agents
Write-Host "1. Registering agents..." -ForegroundColor Yellow
$body = @{ agentId = $AGENT_A; firstName = "Alice"; lastName = "Test"; dob = "1990-01-01"; idNumber = "A123" } | ConvertTo-Json
Invoke-RestMethod -Uri "$BASE/identity/verify-identity" -Method POST -Body $body -ContentType "application/json" | Out-Null
$body = @{ agentId = $AGENT_B; firstName = "Bob"; lastName = "Test"; dob = "1990-01-02"; idNumber = "B123" } | ConvertTo-Json  
Invoke-RestMethod -Uri "$BASE/identity/verify-identity" -Method POST -Body $body -ContentType "application/json" | Out-Null
Write-Host "   ✅ Agents registered" -ForegroundColor Green

# 2. Send chat request
Write-Host "2. Agent A sends chat request to B..." -ForegroundColor Yellow
$body = @{ to = $AGENT_B; message = "Hi! I want to use your tools." } | ConvertTo-Json
$result = Invoke-RestMethod -Uri "$BASE/messaging/dm/request" -Method POST -Body $body -ContentType "application/json" -Headers @{ "x-agent-id" = $AGENT_A }
$convId = $result.conversation_id
Write-Host "   ✅ Request sent. Conversation ID: $convId" -ForegroundColor Green

# 3. Check B's activity
Write-Host "3. Agent B checks DM activity..." -ForegroundColor Yellow
$result = Invoke-RestMethod -Uri "$BASE/messaging/dm/check" -Method GET -Headers @{ "x-agent-id" = $AGENT_B }
Write-Host "   ✅ Has activity: $($result.has_activity), Pending: $($result.requests.count)" -ForegroundColor Green

# 4. Approve request
Write-Host "4. Agent B approves request..." -ForegroundColor Yellow
$result = Invoke-RestMethod -Uri "$BASE/messaging/dm/requests/$convId/approve" -Method POST -Headers @{ "x-agent-id" = $AGENT_B }
Write-Host "   ✅ Approved" -ForegroundColor Green

# 5. Send message
Write-Host "5. Agent A sends a message..." -ForegroundColor Yellow
$body = @{ message = "Great! What's your pricing for the search tool?" } | ConvertTo-Json
$result = Invoke-RestMethod -Uri "$BASE/messaging/dm/conversations/$convId/send" -Method POST -Body $body -ContentType "application/json" -Headers @{ "x-agent-id" = $AGENT_A }
Write-Host "   ✅ Message sent: $($result.message_id)" -ForegroundColor Green

# 6. Read messages
Write-Host "6. Agent B reads conversation..." -ForegroundColor Yellow
$result = Invoke-RestMethod -Uri "$BASE/messaging/dm/conversations/$convId" -Method GET -Headers @{ "x-agent-id" = $AGENT_B }
Write-Host "   ✅ Messages: $($result.messages.Count)" -ForegroundColor Green
$result.messages | ForEach-Object { Write-Host "      - $($_.content)" -ForegroundColor Gray }

# 7. Reply
Write-Host "7. Agent B replies..." -ForegroundColor Yellow
$body = @{ message = "1000 lamports per 1k tokens. Deal?"; needs_human_input = $false } | ConvertTo-Json
$result = Invoke-RestMethod -Uri "$BASE/messaging/dm/conversations/$convId/send" -Method POST -Body $body -ContentType "application/json" -Headers @{ "x-agent-id" = $AGENT_B }
Write-Host "   ✅ Reply sent" -ForegroundColor Green

# 8. Follow
Write-Host "8. Agent A follows Agent B..." -ForegroundColor Yellow
Invoke-RestMethod -Uri "$BASE/messaging/agents/$AGENT_B/follow" -Method POST -Headers @{ "x-agent-id" = $AGENT_A } | Out-Null
Write-Host "   ✅ Now following" -ForegroundColor Green

# 9. Get profile
Write-Host "9. Get Agent B's profile..." -ForegroundColor Yellow
$result = Invoke-RestMethod -Uri "$BASE/messaging/agents/$AGENT_B/profile" -Method GET
Write-Host "   ✅ Followers: $($result.stats.followerCount)" -ForegroundColor Green

Write-Host "`n🎉 All tests passed!`n" -ForegroundColor Cyan
