param([int]$X,[int]$Y,[ValidateSet('left','middle','drag')][string]$Action='left',[int]$Dx=0,[int]$Dy=0)
Add-Type @'
using System;using System.Runtime.InteropServices;
public class QaMouse {
 [DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")]public static extern bool GetCursorPos(out POINT p);
 [DllImport("user32.dll")]public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra);
 public struct POINT {public int X,Y;}
}
'@
$original=New-Object QaMouse+POINT;$null=[QaMouse]::GetCursorPos([ref]$original)
try {
 $null=[QaMouse]::SetCursorPos($X,$Y);Start-Sleep -Milliseconds 300
 if($Action -eq 'middle'){
  [QaMouse]::mouse_event(0x20,0,0,0,[UIntPtr]::Zero);Start-Sleep -Milliseconds 100;[QaMouse]::mouse_event(0x40,0,0,0,[UIntPtr]::Zero)
 } else {
  [QaMouse]::mouse_event(2,0,0,0,[UIntPtr]::Zero);Start-Sleep -Milliseconds 100
  if($Action -eq 'drag'){for($i=1;$i -le 10;$i++){$null=[QaMouse]::SetCursorPos(($X+[int]($Dx*$i/10)),($Y+[int]($Dy*$i/10)));Start-Sleep -Milliseconds 35}}
  [QaMouse]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
 }
 Start-Sleep -Milliseconds 150
} finally {$null=[QaMouse]::SetCursorPos($original.X,$original.Y)}
