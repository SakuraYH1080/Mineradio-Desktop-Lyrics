'use strict';
const $=id=>document.getElementById(id);
let initial,previewSerial=0,fontRows=[],fontsReady=false,fontFailure=false;
const fontScripts=['zh','latin','ja','ko','cyrillic'];
const fontModes=['auto','zh','ja','ko'];
const fontControls=[{key:'default',id:'fontFamily'},...fontScripts.map(key=>({key,id:'fontFamily-'+key}))];
const fontSamples={default:'中文 · English · 日本語かな · 한글 · Русский',zh:'中文歌词，随音乐流动',latin:'The music stays · Aa Éé',ja:'日本語の歌詞、あいうえお',ko:'음악과 함께하는 노래',cyrillic:'Музыка и слова · Ая Жё'};
let sampleProfile='';
const fontFallback='Inter,"Noto Sans SC","PingFang SC","Microsoft YaHei",Arial,sans-serif';
function fontStyle(name){return name?JSON.stringify(name)+','+fontFallback:fontFallback}
function fontOption(label,name){
  const option=new Option(label,name);
  // Treat family names as data; each dropdown row previews its own typeface.
  option.style.fontFamily=fontStyle(name);
  return option;
}
function coverageLabel(row,script){
  if(script==='default')return row.label;
  const sample=row.coverage?.[script];
  return row.label+' · '+(sample&&Number.isFinite(sample.covered)&&Number.isFinite(sample.total)&&sample.total>0
    ? '代表字符 '+sample.covered+'/'+sample.total:'代表字符未检测');
}
function selectFont(value,script='default'){
  const name=typeof value==='string'?value:'',select=$(script==='default'?'fontFamily':'fontFamily-'+script);
  select.replaceChildren(fontOption(script==='default'?'默认字体':'沿用通用默认',''));
  for(const row of fontRows)select.add(fontOption(coverageLabel(row,script),row.family));
  const match=fontRows.find(row=>row.family.toLowerCase()===name.toLowerCase());
  if(name&&!match)select.add(fontOption((fontsReady?'不可用，使用后备字体：':'已保存：')+name,name));
  select.value=match?match.family:name;
  select.title=select.selectedOptions[0]?.textContent||'默认字体';
  select.style.fontFamily=fontStyle(select.value||(script==='default'?'':$('fontFamily').value));
}
function selectFonts(value){
  selectFont(value.fontFamily);
  for(const script of fontScripts)selectFont(value.fontFamilies?.[script],script);
}
function renderRuns(element,text,families,language='auto'){
  const fragments=window.LyricTypography?.createRuns(text,{families,language,context:'auto'})||[{text,fontFamily:families.default}];
  // Keep one grid item in the existing black/white preview; font runs stay inline.
  const content=document.createElement('span');
  for(const run of fragments){const span=document.createElement('span');span.textContent=run.text;span.style.fontFamily=run.fontFamily;content.appendChild(span)}
  element.replaceChildren(content);
}
function renderFontSamples(families,language,weight){
  const key=JSON.stringify([families,language,weight]);
  if(key===sampleProfile)return;
  sampleProfile=key;
  for(const {key:script} of fontControls){
    const sample=$('fontSample-'+script);sample.style.fontWeight=String(weight);
    if(script==='default'){sample.textContent=fontSamples.default;sample.style.fontFamily=families.default}
    else renderRuns(sample,fontSamples[script],families,script);
  }
}
function fontNotice(){
  if(fontFailure){$('font-notice').textContent='暂时无法读取字体列表，可继续使用默认或已保存的字体；重新打开设置可重试。';return}
  if(!fontsReady){$('font-notice').textContent='正在读取本机字体，可先使用默认或已保存的字体。';return}
  if(fontControls.some(({id})=>$(id).value&&!fontRows.some(row=>row.family.toLowerCase()===$(id).value.toLowerCase()))){$('font-notice').textContent='部分已保存字体当前不可用，将使用通用默认或后备字体。代表字符覆盖不等于支持全部歌词。';return}
  $('font-notice').textContent='列表仅标注代表字符覆盖，不代表支持全部歌词；缺字仍使用后备字体。字体按需读取并缓存，安装或卸载后重启歌词刷新。仅影响歌词与预览，设置面板字体不变。';
}
function fill(value){
  for(const k of Object.keys(value.captions))$(k).value=value.captions[k];
  $('colorMode').value=value.colorMode;$('fixedColor').value=value.fixedColor;
  $('panelTitle').value=value.panelTitle??'桌面歌词';previewPanelTitle();
  $('lyricLanguage').value=fontModes.includes(value.lyricLanguage)?value.lyricLanguage:'auto';
  selectFonts(value);preview();
}
function previewPanelTitle(composing=false){
  const input=$('panelTitle');
  if(!composing)input.value=Array.from(input.value).slice(0,40).join('');
  $('panelTitleHeading').textContent=input.value.trim()||'桌面歌词';
  $('panelTitleCount').textContent=Array.from(input.value).length+' / 40 字符';
}
function read(){return {captions:Object.fromEntries(['waiting','instrumental','missing','loading'].map(k=>[k,$(k).value])),colorMode:$('colorMode').value,fixedColor:$('fixedColor').value,fontFamily:$('fontFamily').value,fontFamilies:Object.fromEntries(fontScripts.map(key=>[key,$('fontFamily-'+key).value])),lyricLanguage:$('lyricLanguage').value,panelTitle:$('panelTitle').value}}
function preview(){
  if(!initial)return;
  const p=read(),track=initial.track||{title:'喜欢的歌',artist:'喜欢的歌手'};
  const text=p.captions[$('previewState').value].replace(/\{歌名\}/g,()=>track.title||'').replace(/\{歌手\}/g,()=>track.artist||'');
  $('preview').textContent=text||'（此字幕已隐藏）';$('fixedColor').disabled=p.colorMode!=='fixed';$('notice').textContent='';
  for(const {key,id} of fontControls){const select=$(id);select.style.fontFamily=fontStyle(select.value||(key==='default'?'':p.fontFamily));select.title=select.selectedOptions[0]?.textContent||(key==='default'?'默认字体':'沿用通用默认')}
  fontNotice();
  const serial=++previewSerial;
  window.lyricSettings.preview(p).then(colors=>{
    if(serial!==previewSerial)return;
    $('preview').style.setProperty('--preview-ink',colors.primary);$('preview').style.setProperty('--preview-glow',colors.glow);
    $('preview').style.fontFamily=colors.fontFamily;$('preview').style.fontWeight=String(colors.fontWeight);
    const families=colors.fontFamilies||Object.fromEntries(['default',...fontScripts].map(key=>[key,colors.fontFamily]));
    renderRuns($('preview'),text||'（此字幕已隐藏）',families,colors.lyricLanguage||p.lyricLanguage);
    renderFontSamples(families,colors.lyricLanguage||p.lyricLanguage,colors.fontWeight);
  }).catch(e=>{$('notice').textContent=e.message});
}
async function loadFonts(){
  try{fontRows=await window.lyricSettings.fonts();fontsReady=true;selectFonts(read());preview()}
  catch(_){fontFailure=true;fontNotice()}
}
function renderConnection(connection){
  const status=$('connectionStatus');if(!status)return;
  status.textContent=!connection?'连接状态暂不可用':!connection.connected?'等待网易云连接':!connection.usable?'已连接 · 等待有效进度':connection.playing?'已连接 · 正在播放':'已连接 · 已暂停';
  status.title='打开设置面板时的真实连接状态；重新打开面板时更新。';
}
window.lyricSettings.read().then(value=>{initial=value;renderConnection(value.connection);fill(value.settings);void loadFonts()}).catch(e=>{renderConnection(null);$('notice').textContent=e.message});
document.addEventListener('input',event=>{
  // A title keystroke updates only this panel: no IPC, font scan or lyric preview.
  if(event.target.id==='panelTitle'){previewPanelTitle(event.isComposing);return}
  preview();
});
$('panelTitle').addEventListener('compositionend',()=>previewPanelTitle());
$('previewState').addEventListener('change',preview);
for(const {id} of fontControls)$(id).addEventListener('change',preview);
$('lyricLanguage').addEventListener('change',preview);
$('reset').onclick=()=>{fill(initial.defaults);$('notice').textContent='已恢复默认，点击保存后生效。'};
$('save').onclick=async()=>{try{const saved=await window.lyricSettings.save(read());fill(saved);$('notice').textContent='已保存，重启后仍会保留。'}catch(e){$('notice').textContent='保存失败：'+e.message}};
$('previewButton').onclick=preview;
