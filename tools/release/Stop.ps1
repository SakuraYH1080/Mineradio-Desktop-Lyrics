$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
. (Join-Path $PSScriptRoot 'Process-Helpers.ps1')
# Only this unpacked app; never cloudmusic or another Electron application.
$targets=@(Get-TrialProcesses -Names electron -Roots $root)
$ids=@($targets|ForEach-Object {$_.Id})
$children=@(Get-CimInstance Win32_Process -Filter "name='powershell.exe'"|Where-Object {$ids -contains $_.ParentProcessId -and $_.CommandLine -like ('*'+$root+'\tools\mouse-poll.ps1*')})
$targets|Stop-Process -ErrorAction SilentlyContinue
foreach($child in $children){Stop-Process -Id $child.ProcessId -ErrorAction SilentlyContinue}
Write-Output '桌面歌词已退出，网易云不受影响。也可优先从歌词托盘正常退出。'
