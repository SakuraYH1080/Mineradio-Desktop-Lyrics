param([string]$ClientExe,[string]$Profile)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$configFile=Join-Path $root '.runtime\launch.json'
if(Test-Path -LiteralPath $configFile){$saved=Get-Content -Raw -LiteralPath $configFile|ConvertFrom-Json;if(-not $ClientExe){$ClientExe=$saved.clientExe};if(-not $Profile){$Profile=$saved.profile}}
if(-not $ClientExe){$ClientExe=Read-Host '原版 cloudmusic.exe 完整路径（不要输入客户端副本）'}
if(-not $Profile){$Profile=Read-Host '原客户端实际读取的 BetterNCM 数据目录，例如 C:\betterncm'}
$ClientExe=[IO.Path]::GetFullPath($ClientExe.Trim().Trim('"'));$Profile=[IO.Path]::GetFullPath($Profile.Trim().Trim('"'))
if(-not(Test-Path -LiteralPath $ClientExe -PathType Leaf) -or [IO.Path]::GetFileName($ClientExe) -ne 'cloudmusic.exe'){throw '找不到所配置的原版 cloudmusic.exe'}
if((Get-Item -LiteralPath $ClientExe).VersionInfo.FileVersion -ne '3.1.42.205594'){throw '此客户端版本不在已验证范围，请先核实兼容性，不自动升降级'}
$bridge=Join-Path $Profile 'plugins_dev\MineradioBridge'
if(-not(Test-Path -LiteralPath (Join-Path $bridge 'manifest.json'))){throw '实际 profile 中未安装 MineradioBridge，请先按 docs/INSTALL.md 配置'}
$electron=Join-Path $root 'node_modules\electron\dist\electron.exe'
if(-not(Test-Path -LiteralPath $electron)){throw '缺少 Electron：源码版请先 npm ci，试用版请完整解压发布 ZIP'}
New-Item -ItemType Directory -Force (Split-Path $configFile)|Out-Null
@{clientExe=$ClientExe;profile=$Profile}|ConvertTo-Json|Set-Content -Encoding UTF8 -LiteralPath $configFile
. (Join-Path $PSScriptRoot 'Process-Helpers.ps1')
$clientRoot=Split-Path $ClientExe
$mutex=New-Object Threading.Mutex($false,'Local\MineradioPublicLauncher')
try{$owned=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$owned=$true}
if(-not $owned){$mutex.Dispose();exit 0}
try{
 $all=@(Get-Process cloudmusic -ErrorAction SilentlyContinue)
 $matching=@(Get-TrialProcesses -Names cloudmusic -Roots $clientRoot)
 if($all.Count -and -not $matching.Count){throw '另一位置的网易云运行中，请先从其托盘正常退出；不会强制中断音乐'}
 if(-not $matching.Count){Start-Process -FilePath $ClientExe -WorkingDirectory $clientRoot|Out-Null}
 $env:MINERADIO_LOG_DIR=Join-Path $root 'logs'
 # No profile environment override, debugging ports or high-frequency display audit.
 $argsList='"'+$root+'" --source=inflink-api --audio=inflink-pcm --frame-rate=30 --bridge-config="'+(Join-Path $bridge 'connection.json')+'"'
 Start-Process -FilePath $electron -WorkingDirectory $root -ArgumentList $argsList|Out-Null
}finally{$mutex.ReleaseMutex();$mutex.Dispose()}
