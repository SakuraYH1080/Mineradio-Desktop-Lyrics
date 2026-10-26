# QueryFullProcessImageName avoids the remote module enumeration behind .Path.
if(-not ('TrialProcessImage' -as [type])){
 Add-Type @'
using System;using System.Text;using System.Runtime.InteropServices;
public static class TrialProcessImage {
 [DllImport("kernel32.dll",SetLastError=true)]static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool QueryFullProcessImageName(IntPtr handle,uint flags,StringBuilder value,ref uint size);
 [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr handle);
 public static string Read(int pid){var h=OpenProcess(0x1000,false,pid);if(h==IntPtr.Zero)return "";try{uint size=32768;var b=new StringBuilder((int)size);return QueryFullProcessImageName(h,0,b,ref size)?b.ToString():"";}finally{CloseHandle(h);}}
}
'@
}
function Get-TrialProcesses {
 param([ValidateSet('electron','cloudmusic')][string[]]$Names,[string[]]$Roots)
 foreach($p in @(Get-Process -Name $Names -ErrorAction SilentlyContinue)){
  $image=[TrialProcessImage]::Read($p.Id)
  foreach($root in $Roots){if($image -and $image.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)){$p;break}}
 }
}
