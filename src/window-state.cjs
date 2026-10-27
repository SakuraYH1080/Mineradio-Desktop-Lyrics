// User-owned window placement only. Never exported into an installer or portable ZIP.
const fs=require('node:fs');
const path=require('node:path');
function bounds(value){
  if(!value || !['x','y','width','height'].every(key=>Number.isFinite(value[key])))return null;
  if(value.width<100 || value.width>10000 || value.height<50 || value.height>10000 || Math.abs(value.x)>100000 || Math.abs(value.y)>100000)return null;
  return Object.fromEntries(['x','y','width','height'].map(key=>[key,Math.round(value[key])]));
}
function readParts(file){
  const handle=fs.openSync(file,'r');
  try{
    const size=fs.fstatSync(handle).size,headSize=Math.min(size,65536),tailSize=Math.min(size,8*1024*1024);
    const head=Buffer.alloc(headSize),tail=Buffer.alloc(tailSize);
    fs.readSync(handle,head,0,headSize,0);
    fs.readSync(handle,tail,0,tailSize,Math.max(0,size-tailSize));
    return head.toString('utf8')+'\n'+tail.toString('utf8');
  }finally{fs.closeSync(handle);}
}
function legacyPlacement(directory){
  // Older trials did not persist bounds. Recover only coordinates/lock state
  // from a bounded read of this app's own logs, never copy private logs to a build.
  try{
    const folders=fs.readdirSync(directory,{withFileTypes:true}).filter(item=>item.isDirectory()&&/^desktop-/.test(item.name))
      .map(item=>path.join(directory,item.name)).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs).slice(0,8);
    for(const folder of folders){
      const files=fs.readdirSync(folder).filter(name=>/^overlay-live-\d+\.ndjson$/.test(name)).sort().reverse();
      for(const name of files.slice(0,1)){
        let found=null,locked;
        for(const line of readParts(path.join(folder,name)).split(/\r?\n/)){
          if(!/"type":"(?:drag|ready|visibility-shown|lock)"/.test(line))continue;
          try{
            const entry=JSON.parse(line),candidate=bounds(entry.type==='drag'?entry.after:entry.bounds);
            if(candidate && (!found || entry.atMs>=found.atMs))found={bounds:candidate,atMs:entry.atMs};
            if(typeof entry.locked==='boolean')locked=entry.locked;
          }catch{}
        }
        if(found)return {version:1,bounds:found.bounds,locked,provenance:'legacy-local-log'};
      }
    }
  }catch{}
  return {version:1};
}
function load(file,logs){
  try{const value=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));if(bounds(value.bounds))return {...value,bounds:bounds(value.bounds)};}catch{}
  return legacyPlacement(logs);
}
function place(saved,defaults,areas){
  const previous=bounds(saved?.bounds);if(!previous)return defaults;
  const visible=areas.some(area=>Math.min(previous.x+defaults.width,area.x+area.width)-Math.max(previous.x,area.x)>=64 &&
    Math.min(previous.y+defaults.height,area.y+area.height)-Math.max(previous.y,area.y)>=40);
  return visible?{...defaults,x:previous.x,y:previous.y}:defaults;
}
function save(file,value){
  const position=bounds(value.bounds);if(!position)return;
  const temporary=file+'.tmp';fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(temporary,JSON.stringify({version:1,bounds:position,locked:!!value.locked,savedAt:new Date().toISOString()},null,2));
  try{fs.renameSync(temporary,file);}catch(error){
    if(error.code!=='EXDEV')throw error;
    const previous=file+'.previous',existed=fs.existsSync(file);if(existed)fs.copyFileSync(file,previous);
    try{fs.copyFileSync(temporary,file);}catch(failure){if(existed)fs.copyFileSync(previous,file);throw failure;}
    fs.unlinkSync(temporary);
  }
}
module.exports={load,place,save};
