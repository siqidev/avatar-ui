Param(
  [string]$TaskName = "SPECTRA Core",
  [int]$Port = 8000,
  [string]$HealthUrl = "http://127.0.0.1:8000/health",
  [int]$HealthRetries = 10,
  [int]$HealthIntervalSeconds = 2
)

# まずタスクを停止する（停止できないなら即エラー）。
Stop-ScheduledTask -TaskName $TaskName -ErrorAction Stop
Start-Sleep -Seconds 1

# まだポートを掴んでいるプロセスがあれば強制終了する。
$conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) {
  Stop-Process -Id $conn.OwningProcess -Force -ErrorAction Stop
}

# タスクを起動する。
Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
Start-Sleep -Seconds 2

# ヘルスチェックをリトライし、起動直後の揺らぎを吸収する。
$lastError = $null
$lastContent = $null
for ($i = 1; $i -le $HealthRetries; $i++) {
  try {
    $response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -ErrorAction Stop
    $lastContent = $response.Content
    if ($response.StatusCode -eq 200 -and $response.Content -match '"status"\s*:\s*"ok"') {
      Write-Host "Core restarted and healthy."
      exit 0
    }
  } catch {
    $lastError = $_.Exception.Message
  }
  Start-Sleep -Seconds $HealthIntervalSeconds
}

if ($lastContent) {
  throw "Health check failed: $lastContent"
}
if ($lastError) {
  throw "Health check failed: $lastError"
}
throw "Health check failed: no response"
