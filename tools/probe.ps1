param([int]$Seconds = 30, [int]$IntervalMs = 250, [string]$SessionPattern = '(?i)(^|[\\/!.])cloudmusic(\.exe)?($|[!_])|netease.*cloudmusic', [ValidateSet('native','inflink')][string]$SourceMode='native')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]
function Await($op, $type) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
  $task = $method.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $task.Wait(4000)) { throw 'WinRT timeout' }
  return $task.Result
}
function Emit($obj) {
  if($obj.ContainsKey('source')){$obj.source=$sourceName}
  if($SourceMode -eq 'inflink' -and $obj.connected -and -not $obj.track.id){$obj.timelineUsable=$false;$obj.providerWarning='InfLink provenance not established: NCM-ID genre absent'}
  $obj | ConvertTo-Json -Depth 8 -Compress | ForEach-Object { [Console]::Out.WriteLine($_) }; [Console]::Out.Flush()
}
$sourceName=if($SourceMode -eq 'inflink'){'gsmtc-inflink'}else{'gsmtc'}
$manager = $null; $lastKey = ''; $connected = $false; $lastPosition = $null; $lastState = ''; $lastSample = 0
$until = [DateTime]::UtcNow.AddSeconds($Seconds)
while ($Seconds -eq 0 -or [DateTime]::UtcNow -lt $until) {
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  try {
    if (-not $manager) { $manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]) }
    $sessions = @($manager.GetSessions())
    $targets = @($sessions | Where-Object { $_.SourceAppUserModelId -match $SessionPattern })
    $ids = @($sessions | ForEach-Object { $_.SourceAppUserModelId })
    if ($targets.Count -ne 1) {
      Emit @{ type='sample'; source='gsmtc'; connected=$false; sampledAtMs=$now; events=@($(if ($connected) {'disconnected'} else {'waiting'})); sessions=$ids; reason=$(if ($targets.Count -gt 1) {'ambiguous-netease-sessions'} else {'no-netease-session'}) }
      $connected=$false; $lastPosition=$null; Start-Sleep -Milliseconds $IntervalMs; continue
    }
    $s = $targets[0]; $media = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    $timeline = $s.GetTimelineProperties(); $info = $s.GetPlaybackInfo()
    $sampled = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $updated = ([DateTimeOffset]$timeline.LastUpdatedTime).ToUnixTimeMilliseconds()
    $pos = $timeline.Position.TotalSeconds; $duration = ($timeline.EndTime - $timeline.StartTime).TotalSeconds
    $songId=$null
    foreach($genre in $media.Genres){if($genre -match '^NCM-(\d+)$'){$songId=$matches[1]}}
    $key = "$($s.SourceAppUserModelId)|$($media.Title)|$($media.Artist)|$($media.AlbumTitle)|$songId"
    $status = $info.PlaybackStatus.ToString().ToLowerInvariant()
    $events = @(); if (-not $connected) { $events += 'connected' }; if ($key -ne $lastKey) { $events += 'track-changed' }
    if ($lastPosition -ne $null -and $key -eq $lastKey) {
      $expected=$lastPosition; if ($lastState -eq 'playing') {$expected+=($sampled-$lastSample)/1000}
      if ([Math]::Abs($pos-$expected) -gt 1.5 -and $updated -gt $lastSample) {$events+='seek-or-loop'}
    }
    if ($status -ne $lastState) {$events+='playback-changed'}
    Emit @{ type='sample'; source='gsmtc'; connected=$true; sessionId=$s.SourceAppUserModelId; sessions=$ids; track=@{ title=$media.Title; artist=$media.Artist; album=$media.AlbumTitle; id=$songId }; status=$status; positionSec=$pos; durationSec=$duration; rate=$(if ($info.PlaybackRate) {[double]$info.PlaybackRate} else {1}); sampledAtMs=$sampled; updatedAtMs=$updated; events=$events; fields=@{ title=$(if($media.Title){'observed'}else{'missing'}); artist=$(if($media.Artist){'observed'}else{'missing'}); album=$(if($media.AlbumTitle){'observed'}else{'missing'}); id=$(if($songId){'observed-genre-ncm-id'}else{'missing'}); position=$(if($duration -gt 0 -and $updated -gt 0){'observed-gsmtc'}else{'missing-invalid-gsmtc'}); duration=$(if($duration -gt 0){'observed-gsmtc'}else{'missing-invalid-gsmtc'}); updatedAt=$(if($updated -gt 0){'observed-gsmtc'}else{'missing-invalid-gsmtc'}); audio='missing' }; timelineUsable=($duration -gt 0 -and $updated -gt 0 -and $pos -ge 0) }
    $connected=$true; $lastKey=$key; $lastPosition=$pos; $lastState=$status; $lastSample=$sampled
  } catch { Emit @{type='sample'; source='gsmtc'; connected=$false; sampledAtMs=$now; events=@('error'); error=$_.Exception.Message}; $manager=$null; $connected=$false }
  Start-Sleep -Milliseconds $IntervalMs
}
