# Test patient profile creation
if (-not $env:SUPABASE_URL) { throw "SUPABASE_URL is not set" }
if (-not $env:SUPABASE_SERVICE_ROLE_KEY) { throw "SUPABASE_SERVICE_ROLE_KEY is not set" }

$body = @{
    name = "John Doe"
    stroke_type = "ischemic"
    months_in_recovery = "3 months"
    affected_part = "Legs"
    affected_side = "Right"
} | ConvertTo-Json

Write-Host "Sending patient profile to backend..."
$response = Invoke-WebRequest -Uri "http://localhost:8002/patients" `
    -Method POST `
    -Body $body `
    -ContentType "application/json" `
    -UseBasicParsing

Write-Host "Response Status: $($response.StatusCode)"
Write-Host "Response Content:"
$response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 10
