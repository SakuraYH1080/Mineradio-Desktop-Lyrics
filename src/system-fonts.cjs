const {execFile}=require('node:child_process');
const path=require('node:path');
const DEFAULT_FAMILY='Inter,"Noto Sans SC","PingFang SC","Microsoft YaHei",Arial,sans-serif';
let catalog=null,pending=null;
// Metadata only: no font files or paths are exported, copied or downloaded.
// This script runs only when the settings window requests its font dropdown.
const enumerateScript=String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName PresentationCore
$rows=@(foreach($f in [System.Windows.Media.Fonts]::SystemFontFamilies){
 try{
  $family=$f.Source.Trim()
  if(-not $family -or $family.StartsWith('@')){continue}
  $physical=$false
  foreach($face in $f.GetTypefaces()){$glyph=$null;if($face.TryGetGlyphTypeface([ref]$glyph)){$physical=$true;break}}
  if(-not $physical){continue}
  $label=$family
  foreach($tag in @('zh-CN','zh-Hans',[Globalization.CultureInfo]::CurrentUICulture.IetfLanguageTag,'en-US')){
   $language=[System.Windows.Markup.XmlLanguage]::GetLanguage($tag)
   if($f.FamilyNames.ContainsKey($language)){$label=$f.FamilyNames[$language];break}
  }
  if($label -ne $family){$label=$label+' ('+$family+')'}
  [pscustomobject]@{family=$family;label=$label}
 }catch{continue}
})
ConvertTo-Json -InputObject $rows -Compress -Depth 3
`;
function cleanName(value){return typeof value==='string'&&value.length<=160?value.replace(/[\u0000-\u001f\u007f]/g,'').trim():''}
function cssFamily(value){
  const name=cleanName(value);
  if(!name||(catalog&&!catalog.known.has(name.toLowerCase())))return DEFAULT_FAMILY;
  // A family name is a single quoted CSS string, never a CSS fragment or URL.
  return JSON.stringify(name)+','+DEFAULT_FAMILY;
}
function listFonts(){
  if(catalog)return Promise.resolve(catalog.rows);
  if(pending)return pending;
  if(process.platform!=='win32')return Promise.resolve([]);
  pending=new Promise((resolve,reject)=>{
    const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
    execFile(executable,['-NoProfile','-NonInteractive','-STA','-EncodedCommand',Buffer.from(enumerateScript,'utf16le').toString('base64')],
      {windowsHide:true,encoding:'utf8',timeout:20000,maxBuffer:4*1024*1024},(error,stdout)=>{
        if(error){reject(Error('无法读取本机字体列表，请稍后重新打开设置；已保存的字体和默认后备字体仍可使用。'));return}
        try{
          const data=JSON.parse(stdout.replace(/^\uFEFF/,''));
          const unique=new Map();
          for(const row of Array.isArray(data)?data:[]){
            const family=cleanName(row.family);
            if(family)unique.set(family.toLowerCase(),{family,label:typeof row.label==='string'?row.label.slice(0,320):family});
          }
          const rows=[...unique.values()].sort((a,b)=>a.label.localeCompare(b.label,'zh-CN',{numeric:true,sensitivity:'base'}));
          if(!rows.length)throw Error('No usable font metadata');
          catalog={rows,known:new Set(unique.keys())};resolve(rows);
        }catch(_){reject(Error('本机字体列表读取失败，仍可使用默认字体。'))}
      });
  }).finally(()=>{pending=null});
  return pending;
}
module.exports={DEFAULT_FAMILY,cleanName,cssFamily,listFonts};
