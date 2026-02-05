Param(
  [string]$ProjectRoot = "C:\\dev\\avatar-ui",
  [string]$TaskName = "Avatar Tunnel",
  [string]$UserId = "S-1-5-18",
  [string]$CloudflaredPath = "C:\\dev\\bin\\cloudflared.exe",
  [string]$ConfigPath = "C:\\ProgramData\\cloudflared\\config.yml",
  [string]$TunnelName = "avatar"
)

# cloudflared本体が無ければ即停止。
if (-not (Test-Path $CloudflaredPath)) {
  Write-Error "cloudflared.exe not found: $CloudflaredPath"
  exit 1
}

# トンネル設定が無ければ即停止。
if (-not (Test-Path $ConfigPath)) {
  Write-Error "config.yml not found: $ConfigPath"
  exit 1
}

# 起動コマンドと作業ディレクトリを定義する。
$action = New-ScheduledTaskAction `
  -Execute $CloudflaredPath `
  -Argument "tunnel --config `"$ConfigPath`" run $TunnelName" `
  -WorkingDirectory $ProjectRoot

# PC起動時に自動で立ち上げるトリガー。
$trigger = New-ScheduledTaskTrigger -AtStartup

# 失敗時の再試行など、運用に必要な設定をまとめる。
$settings = New-ScheduledTaskSettingsSet `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries

# SYSTEMアカウントで常に動かす実行権限を設定。
$principal = New-ScheduledTaskPrincipal `
  -UserId $UserId `
  -LogonType ServiceAccount `
  -RunLevel Highest

# 既存タスクがあっても上書き登録する。
Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "Avatar Cloudflare Tunnel" `
  -Force

Write-Host "Registered scheduled task: $TaskName"
