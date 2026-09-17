$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source
$script = Join-Path $root "scripts\sa-keep.mjs"
$log = Join-Path $root "data\sa-keep.log"
$name = "LegCalendar SA Keep"
$launcherDir = Join-Path $env:LOCALAPPDATA "LegCalendarMonitor"
$cmdLauncher = Join-Path $launcherDir "sa-keep-run.cmd"
$vbsLauncher = Join-Path $launcherDir "sa-keep-run.vbs"
New-Item -ItemType Directory -Force -Path $launcherDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $root "data") | Out-Null

@(
  "@echo off"
  "cd /d `"$root`""
  "`"$node`" `"$script`""
) | Set-Content -Path $cmdLauncher -Encoding ASCII

$nodeVbs = $node.Replace("\", "\\")
$scriptVbs = $script.Replace("\", "\\")
$logVbs = $log.Replace("\", "\\")
$rootVbs = $root.Replace("\", "\\")
$vbs = @"
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$rootVbs"
sh.Run "cmd /c ""$nodeVbs"" ""$scriptVbs"" >> ""$logVbs"" 2>&1", 0, False
"@
Set-Content -Path $vbsLauncher -Value $vbs -Encoding ASCII

function Install-StartupShortcut {
  $startup = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
  $shortcutPath = Join-Path $startup "$name.lnk"
  $w = New-Object -ComObject WScript.Shell
  $sc = $w.CreateShortcut($shortcutPath)
  $sc.TargetPath = "$env:SystemRoot\System32\wscript.exe"
  $sc.Arguments = "//B `"$vbsLauncher`""
  $sc.WorkingDirectory = $root
  $sc.WindowStyle = 7
  $sc.Save()
  Write-Host "Installed a hidden Startup shortcut so a session push also runs at logon."
}

$wscript = Join-Path $env:SystemRoot "System32\wscript.exe"
$taskOk = $false
try {
  $action = New-ScheduledTaskAction -Execute $wscript -Argument "//B `"$vbsLauncher`"" -WorkingDirectory $root
  $logon = New-ScheduledTaskTrigger -AtLogOn
  $repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration (New-TimeSpan -Days 3650)
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -Hidden
  Register-ScheduledTask -TaskName $name -Action $action -Trigger @($logon, $repeat) -Settings $settings -Force | Out-Null
  $taskOk = $true
  Write-Host "Installed hidden Windows task '$name'."
} catch {
  $quoted = '"' + $wscript + '" //B "' + $vbsLauncher + '"'
  $create = schtasks.exe /Create /TN $name /SC MINUTE /MO 30 /TR $quoted /F 2>&1
  if ($LASTEXITCODE -eq 0) {
    $taskOk = $true
    Write-Host "Installed hidden Windows task '$name' (every 30 minutes)."
  } else {
    Write-Host "Could not register a repeating task ($create)."
  }
}

Install-StartupShortcut
if ($taskOk) {
  Write-Host "It still runs at logon and every 30 minutes, without a PowerShell window."
} else {
  Write-Host "Repeating task needs Administrator. Until then, this PC pushes when you sign in to Windows."
}
Write-Host "If JumpCloud expires, run: npm run sa:login"
