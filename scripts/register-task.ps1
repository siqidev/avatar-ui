Param(
  [string]$ProjectRoot = "C:\\dev\\avatar-ui",
  [string]$TaskName = "Avatar Core",
  [string]$UserId = "S-1-5-18"
)

# venvのpythonを使う前提なので、存在しなければ止める。
$pythonPath = Join-Path $ProjectRoot ".venv\\Scripts\\python.exe"
if (-not (Test-Path $pythonPath)) {
  Write-Error "python.exe not found: $pythonPath"
  exit 1
}

# 起動するコマンドと作業ディレクトリを定義する。
$action = New-ScheduledTaskAction `
  -Execute $pythonPath `
  -Argument "-m uvicorn core.main:app --host 127.0.0.1 --port 8000" `
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
  -Description "Avatar Core (uvicorn)" `
  -Force

Write-Host "Registered scheduled task: $TaskName"
