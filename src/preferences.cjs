const fs = require('node:fs');
const path = require('node:path');
const {cleanName,SCRIPT_KEYS,LANGUAGE_MODES}=require('./system-fonts.cjs');
const defaults = Object.freeze({version:1, captions:{waiting:'等一首喜欢的歌', instrumental:'此刻，让旋律说话', missing:'暂时没有歌词，听听旋律吧', loading:'正在寻找歌词…'}, colorMode:'cover', fixedColor:'#9cffdf',fontFamily:'',fontFamilies:Object.freeze(Object.fromEntries(SCRIPT_KEYS.map(key=>[key,'']))),lyricLanguage:'auto',panelTitle:'桌面歌词'});
function normalizePanelTitle(value) {
  const text=typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim():'';
  return Array.from(text).slice(0,40).join('').trim() || defaults.panelTitle;
}
function normalize(value={}) {
  const captions={};
  for(const k of Object.keys(defaults.captions)) {
    const text=value.captions?.[k];
    captions[k]=typeof text==='string'?text.replace(/[\u0000-\u0008\u000b-\u001f]/g,'').slice(0,240):defaults.captions[k];
  }
  // Existing single-font configurations remain the general default. New script
  // overrides are opt-in and inherit it until the user explicitly changes them.
  const fontFamilies=Object.fromEntries(SCRIPT_KEYS.map(key=>[key,cleanName(value.fontFamilies?.[key])]));
  return {version:1,captions,colorMode:value.colorMode==='fixed'?'fixed':'cover',fixedColor:/^#[\da-f]{6}$/i.test(value.fixedColor||'')?value.fixedColor:defaults.fixedColor,fontFamily:cleanName(value.fontFamily),fontFamilies,lyricLanguage:LANGUAGE_MODES.includes(value.lyricLanguage)?value.lyricLanguage:'auto',panelTitle:normalizePanelTitle(value.panelTitle)};
}
function load(file) {try{return normalize(JSON.parse(fs.readFileSync(file,'utf8')))}catch{return normalize()}}
function save(file,value,io=fs) {
  const result=normalize(value),temporary=file+'.tmp';io.mkdirSync(path.dirname(file),{recursive:true});io.writeFileSync(temporary,JSON.stringify(result,null,2));
  try{io.renameSync(temporary,file)}catch(error){
    if(error.code!=='EXDEV')throw error;
    // Windows EFS can reject replace-by-rename even within the same directory.
    // Preserve a recoverable copy and retain the destination's encryption/ACL.
    const previous=file+'.previous',existed=io.existsSync(file);
    if(existed)io.copyFileSync(file,previous);
    try{io.copyFileSync(temporary,file)}catch(failure){if(existed)io.copyFileSync(previous,file);throw failure}
    io.unlinkSync(temporary);
  }
  return result;
}
function caption(template,track) {return String(template).replace(/\{歌名\}/g,()=>track?.title||'').replace(/\{歌手\}/g,()=>track?.artist||'').replace(/\s+/g,' ').trim();}
function presentation(state,value,prefs,located) {
  // Paused is a transport state: usable paused lyrics follow the exact same path.
  if(!state.connected || !state.track || !state.usable) return {kind:'waiting',text:caption(prefs.captions.waiting,state.track)};
  if(located?.phase==='intro') {
    // Reuse the real track placeholders without inventing writer/composer credits
    // or leaving a separator behind when either metadata field is unavailable.
    const parts=[caption('{歌名}',state.track),caption('{歌手}',state.track)].filter(Boolean);
    return {kind:'intro',text:parts.join(' — ')};
  }
  if(value.lines?.length && located?.phase!=='empty') return null;
  const kind=['instrumental','loading','failure','parse-failure'].includes(value.kind)?value.kind:'missing';
  const captionKey=kind==='failure'||kind==='parse-failure'?'missing':kind;
  return {kind,text:caption(prefs.captions[captionKey],state.track)};
}
module.exports={defaults,normalize,load,save,caption,presentation};
