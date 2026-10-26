const fs = require('node:fs');
const path = require('node:path');
const {cleanName}=require('./system-fonts.cjs');
const defaults = Object.freeze({version:1, captions:{waiting:'等一首喜欢的歌', instrumental:'此刻，让旋律说话', missing:'暂时没有歌词，听听旋律吧', loading:'正在寻找歌词…'}, colorMode:'cover', fixedColor:'#9cffdf',fontFamily:''});
function normalize(value={}) {
  const captions={};
  for(const k of Object.keys(defaults.captions)) {
    const text=value.captions?.[k];
    captions[k]=typeof text==='string'?text.replace(/[\u0000-\u0008\u000b-\u001f]/g,'').slice(0,240):defaults.captions[k];
  }
  return {version:1,captions,colorMode:value.colorMode==='fixed'?'fixed':'cover',fixedColor:/^#[\da-f]{6}$/i.test(value.fixedColor||'')?value.fixedColor:defaults.fixedColor,fontFamily:cleanName(value.fontFamily)};
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
function presentation(state,value,prefs) {
  // Paused is a transport state: usable paused lyrics follow the exact same path.
  if(!state.connected || !state.track || !state.usable) return {kind:'waiting',text:caption(prefs.captions.waiting,state.track)};
  if(value.lines?.length) return null;
  const kind=value.kind==='instrumental'?'instrumental':value.kind==='loading'?'loading':'missing';
  return {kind,text:caption(prefs.captions[kind],state.track)};
}
module.exports={defaults,normalize,load,save,caption,presentation};
