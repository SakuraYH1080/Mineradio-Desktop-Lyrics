const {execFile}=require('node:child_process');
const path=require('node:path');
const DEFAULT_FAMILY='Inter,"Noto Sans SC","PingFang SC","Microsoft YaHei",Arial,sans-serif';
const SCRIPT_KEYS=Object.freeze(['zh','latin','ja','ko','cyrillic']);
const LANGUAGE_MODES=Object.freeze(['auto','zh','ja','ko']);
// This is representative character coverage, not a promise of complete lyrics coverage.
const COVERAGE_SAMPLES=Object.freeze({zh:'中文歌词',latin:'AaÉé',ja:'あア日本語',ko:'한글음악',cyrillic:'АяЖё'});
const SCRIPT_FALLBACKS=Object.freeze({
  zh:['Microsoft YaHei','Microsoft YaHei UI','Noto Sans SC','PingFang SC','SimSun'],
  latin:['Segoe UI','Arial','Noto Sans'],
  ja:['Yu Gothic','Meiryo','Noto Sans JP','Hiragino Sans'],
  ko:['Malgun Gothic','Noto Sans KR','Apple SD Gothic Neo','Gulim'],
  cyrillic:['Segoe UI','Arial','Noto Sans','Tahoma'],
});
let catalog=null,pending=null;
// Metadata only: no font files or paths are exported, copied or downloaded.
// This script runs only when the settings window requests its font dropdown.
const enumerateScript=String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName PresentationCore
$samples=[ordered]@{zh='中文歌词';latin='AaÉé';ja='あア日本語';ko='한글음악';cyrillic='АяЖё'}
$samplePoints=New-Object 'System.Collections.Generic.HashSet[int]'
foreach($sample in $samples.Values){foreach($character in $sample.ToCharArray()){$null=$samplePoints.Add([int]$character)}}
$rows=@(foreach($f in [System.Windows.Media.Fonts]::SystemFontFamilies){
 try{
  $family=$f.Source.Trim()
  if(-not $family -or $family.StartsWith('@')){continue}
  $physical=$false
  $coverageKnown=$true
  $covered=New-Object 'System.Collections.Generic.HashSet[int]'
  foreach($face in $f.GetTypefaces()){
   try{
    $glyph=$null
    if(-not $face.TryGetGlyphTypeface([ref]$glyph)){continue}
    $physical=$true
    $map=$glyph.CharacterToGlyphMap
    foreach($point in $samplePoints){if($map.ContainsKey($point) -and $map[$point] -ne 0){$null=$covered.Add($point)}}
    if($covered.Count -eq $samplePoints.Count){break}
   }catch{$coverageKnown=$false}
  }
  if(-not $physical){continue}
  $label=$family
  foreach($tag in @('zh-CN','zh-Hans',[Globalization.CultureInfo]::CurrentUICulture.IetfLanguageTag,'en-US')){
   $language=[System.Windows.Markup.XmlLanguage]::GetLanguage($tag)
   if($f.FamilyNames.ContainsKey($language)){$label=$f.FamilyNames[$language];break}
  }
  if($label -ne $family){$label=$label+' ('+$family+')'}
  $coverage=@{}
  foreach($key in $samples.Keys){
   if(-not $coverageKnown){$coverage[$key]=$null;continue}
   $count=0
   foreach($character in $samples[$key].ToCharArray()){if($covered.Contains([int]$character)){$count++}}
   $coverage[$key]=@{covered=$count;total=$samples[$key].Length}
  }
  [pscustomobject]@{family=$family;label=$label;coverage=$coverage}
 }catch{continue}
})
ConvertTo-Json -InputObject $rows -Compress -Depth 5
`;
function cleanName(value){return typeof value==='string'&&value.length<=160?value.replace(/[\u0000-\u001f\u007f]/g,'').trim():''}
function availableName(value){
  const name=cleanName(value);
  return name&&(!catalog||catalog.known.has(name.toLowerCase()))?name:'';
}
function cssFamily(value){
  const name=availableName(value);
  if(!name)return DEFAULT_FAMILY;
  // A family name is a single quoted CSS string, never a CSS fragment or URL.
  return JSON.stringify(name)+','+DEFAULT_FAMILY;
}
function fontProfile(settings={}){
  const general=availableName(settings.fontFamily);
  const result={default:cssFamily(general)};
  for(const script of SCRIPT_KEYS){
    const names=[availableName(settings.fontFamilies?.[script]),general,
      'Inter','Noto Sans SC','PingFang SC','Microsoft YaHei','Arial',...SCRIPT_FALLBACKS[script]];
    const unique=[],seen=new Set();
    for(const value of names){
      const name=cleanName(value),key=name.toLowerCase();
      if(name&&!seen.has(key)){seen.add(key);unique.push(JSON.stringify(name))}
    }
    // Inherit the original general order, then extend only its missing-glyph
    // fallback. Optional script overrides precede it; generic fallback stays last.
    result[script]=unique.join(',')+',sans-serif';
  }
  return result;
}
function normalizeCoverage(value){
  return Object.fromEntries(SCRIPT_KEYS.map(key=>{
    const row=value?.[key],total=Array.from(COVERAGE_SAMPLES[key]).length;
    return [key,row&&Number.isInteger(row.covered)&&row.covered>=0&&row.covered<=total&&row.total===total
      ?{covered:row.covered,total}:null];
  }));
}
function listFonts(){
  if(catalog)return Promise.resolve(catalog.rows);
  if(pending)return pending;
  if(process.platform!=='win32')return Promise.resolve([]);
  pending=new Promise((resolve,reject)=>{
    const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
    execFile(executable,['-NoProfile','-NonInteractive','-STA','-EncodedCommand',Buffer.from(enumerateScript,'utf16le').toString('base64')],
      {windowsHide:true,encoding:'utf8',timeout:20000,maxBuffer:4*1024*1024},(error,stdout,stderr)=>{
        if(error){const failure=Error('无法读取本机字体列表，请稍后重新打开设置；已保存的字体和默认后备字体仍可使用。',{cause:error});failure.helperStderr=stderr;reject(failure);return}
        try{
          const data=JSON.parse(stdout.replace(/^\uFEFF/,''));
          const unique=new Map();
          for(const row of Array.isArray(data)?data:[]){
            const family=cleanName(row.family);
            if(family)unique.set(family.toLowerCase(),{family,label:typeof row.label==='string'?row.label.slice(0,320):family,coverage:normalizeCoverage(row.coverage)});
          }
          const rows=[...unique.values()].sort((a,b)=>a.label.localeCompare(b.label,'zh-CN',{numeric:true,sensitivity:'base'}));
          if(!rows.length)throw Error('No usable font metadata');
          catalog={rows,known:new Set(unique.keys())};resolve(rows);
        }catch(cause){const failure=Error('本机字体列表读取失败，仍可使用默认字体。',{cause});failure.helperStderr=stderr;reject(failure)}
      });
  }).finally(()=>{pending=null});
  return pending;
}
module.exports={DEFAULT_FAMILY,SCRIPT_KEYS,LANGUAGE_MODES,COVERAGE_SAMPLES,cleanName,cssFamily,fontProfile,listFonts};
