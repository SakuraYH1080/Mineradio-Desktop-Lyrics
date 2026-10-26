'use strict';
const $=id=>document.getElementById(id);
let initial,previewSerial=0,fontRows=[],fontsReady=false,fontFailure=false;
const fontFallback='Inter,"Noto Sans SC","PingFang SC","Microsoft YaHei",Arial,sans-serif';
function fontStyle(name){return name?JSON.stringify(name)+','+fontFallback:fontFallback}
function fontOption(label,name){
  const option=new Option(label,name);
  // Treat family names as data; each dropdown row previews its own typeface.
  option.style.fontFamily=fontStyle(name);
  return option;
}
function selectFont(value){
  const name=typeof value==='string'?value:'',select=$('fontFamily');
  select.replaceChildren(fontOption('默认字体',''));
  for(const row of fontRows)select.add(fontOption(row.label,row.family));
  const match=fontRows.find(row=>row.family.toLowerCase()===name.toLowerCase());
  if(name&&!match)select.add(fontOption((fontsReady?'不可用，使用后备字体：':'已保存：')+name,name));
  select.value=match?match.family:name;
  select.title=select.selectedOptions[0]?.textContent||'默认字体';
  select.style.fontFamily=fontStyle(select.value);
}
function fontNotice(){
  const name=$('fontFamily').value;
  if(fontFailure){$('font-notice').textContent='暂时无法读取字体列表，可继续使用默认或已保存的字体；重新打开设置可重试。';return}
  if(!fontsReady){$('font-notice').textContent='正在读取本机字体，可先使用默认或已保存的字体。';return}
  if(name&&!fontRows.some(row=>row.family.toLowerCase()===name.toLowerCase())){$('font-notice').textContent='此字体当前不可用，将自动使用默认后备字体。';return}
  $('font-notice').textContent='仅改变桌面歌词字体，设置面板不变。安装或卸载字体后，重启歌词可刷新列表。';
}
function fill(value){
  for(const k of Object.keys(value.captions))$(k).value=value.captions[k];
  $('colorMode').value=value.colorMode;$('fixedColor').value=value.fixedColor;
  $('panelTitle').value=value.panelTitle??'桌面歌词';previewPanelTitle();
  selectFont(value.fontFamily);preview();
}
function previewPanelTitle(composing=false){
  const input=$('panelTitle');
  if(!composing)input.value=Array.from(input.value).slice(0,40).join('');
  $('panelTitleHeading').textContent=input.value.trim()||'桌面歌词';
  $('panelTitleCount').textContent=Array.from(input.value).length+' / 40 字符';
}
function read(){return {captions:Object.fromEntries(['waiting','instrumental','missing','loading'].map(k=>[k,$(k).value])),colorMode:$('colorMode').value,fixedColor:$('fixedColor').value,fontFamily:$('fontFamily').value,panelTitle:$('panelTitle').value}}
function preview(){
  if(!initial)return;
  const p=read(),track=initial.track||{title:'喜欢的歌',artist:'喜欢的歌手'};
  const text=p.captions[$('previewState').value].replace(/\{歌名\}/g,()=>track.title||'').replace(/\{歌手\}/g,()=>track.artist||'');
  $('preview').textContent=text||'（此字幕已隐藏）';$('fixedColor').disabled=p.colorMode!=='fixed';$('notice').textContent='';
  $('fontFamily').style.fontFamily=fontStyle($('fontFamily').value);
  $('fontFamily').title=$('fontFamily').selectedOptions[0]?.textContent||'默认字体';fontNotice();
  const serial=++previewSerial;
  window.lyricSettings.preview(p).then(colors=>{
    if(serial!==previewSerial)return;
    $('preview').style.setProperty('--preview-ink',colors.primary);$('preview').style.setProperty('--preview-glow',colors.glow);
    $('preview').style.fontFamily=colors.fontFamily;$('preview').style.fontWeight=String(colors.fontWeight);
  }).catch(e=>{$('notice').textContent=e.message});
}
async function loadFonts(){
  try{fontRows=await window.lyricSettings.fonts();fontsReady=true;selectFont($('fontFamily').value);preview()}
  catch(_){fontFailure=true;fontNotice()}
}
window.lyricSettings.read().then(value=>{initial=value;fill(value.settings);void loadFonts()}).catch(e=>{$('notice').textContent=e.message});
document.addEventListener('input',event=>{
  // A title keystroke updates only this panel: no IPC, font scan or lyric preview.
  if(event.target.id==='panelTitle'){previewPanelTitle(event.isComposing);return}
  preview();
});
$('panelTitle').addEventListener('compositionend',()=>previewPanelTitle());
$('previewState').addEventListener('change',preview);$('fontFamily').addEventListener('change',preview);
$('reset').onclick=()=>{fill(initial.defaults);$('notice').textContent='已恢复默认，点击保存后生效。'};
$('save').onclick=async()=>{try{const saved=await window.lyricSettings.save(read());fill(saved);$('notice').textContent='已保存，重启后仍会保留。'}catch(e){$('notice').textContent='保存失败：'+e.message}};
$('previewButton').onclick=preview;
