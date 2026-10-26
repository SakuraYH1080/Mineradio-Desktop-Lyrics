Add-Type @'
using System.Runtime.InteropServices;
public class MineradioMousePoll {
 [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
}
'@
$prev=$false
while ($true) {
 if(([MineradioMousePoll]::GetAsyncKeyState(0x48) -band 0x8000) -eq 0){[Console]::Out.WriteLine('HUP '+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds());[Console]::Out.Flush()}
 $down=([MineradioMousePoll]::GetAsyncKeyState(4) -band 0x8000) -ne 0
 if($down -and -not $prev){[Console]::Out.WriteLine('MMB');[Console]::Out.Flush()}
 $prev=$down
 Start-Sleep -Milliseconds 24
}
