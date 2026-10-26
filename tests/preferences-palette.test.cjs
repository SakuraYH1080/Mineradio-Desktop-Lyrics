const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const prefs=require('../src/preferences.cjs'),{CoverPalette,DEFAULT,fromBitmap,fromHex}=require('../src/palette.cjs');
test('captions preserve hidden text, persist, stay plain and do not replace paused lyrics',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mineradio-settings-')),file=path.join(dir,'preferences.json');
 const value=prefs.save(file,{captions:{instrumental:'',waiting:'{歌名} {歌手} <img>'},colorMode:'fixed',fixedColor:'#ff8800'});
 assert.deepEqual(prefs.load(file),value);assert.equal(prefs.caption(value.captions.waiting,{title:'A'}),'A <img>');
 assert.equal(prefs.presentation({connected:true,usable:true,track:{id:'1'},playing:false},{lines:[{text:'keep'}]},value),null);
 assert.deepEqual(prefs.presentation({connected:true,usable:true,track:{id:'1'}},{kind:'instrumental',lines:[]},value),{kind:'instrumental',text:''});
 assert.equal(prefs.presentation({connected:true,usable:true,track:{}},{kind:'failure',lines:[]},value).kind,'missing');
 fs.unlinkSync(file);fs.rmdirSync(dir);
});
test('real bitmap colors deterministic; monochrome neutral; fixed palette bright',()=>{
 const red=Buffer.from([0,0,180,255]),blue=Buffer.from([180,0,0,255]);assert.notDeepEqual(fromBitmap(red),fromBitmap(blue));assert.deepEqual(fromBitmap(red),fromBitmap(red));
 const mono=fromBitmap(Buffer.from([40,40,40,255]));assert.match(mono.primary,/^#([a-f0-9]{2})\1\1$/);assert.notEqual(fromHex('#000000').primary,'#000000');
});
test('cover races cannot replace new track; failure uses default; same cover cached',async()=>{
 let release,requests=0;const pending=new Promise(r=>release=r);
 const palette=new CoverPalette({decode:b=>b,fetcher:async url=>{requests++;if(url.includes('id=1&')){await pending;return {ok:true,json:async()=>({songs:[{id:1,album:{picUrl:'https://p1.music.126.net/old.jpg'}}]})}}if(url.includes('/api/song/'))return {ok:true,json:async()=>({songs:[{id:Number(new URL(url).searchParams.get('id')),album:{picUrl:'https://p1.music.126.net/new.jpg'}}]})};return {ok:true,body:[Buffer.from([180,0,0,255])]}}});
 const first=palette.change({id:'1'},prefs.defaults);await palette.change({id:'2'},prefs.defaults);const expected=palette.target;release();await first;assert.deepEqual(palette.target,expected);
 await palette.change({id:'3'},prefs.defaults);assert.equal(requests,5); // three metadata + two images (old race completes but cannot publish)
 const fallback=new CoverPalette({decode:()=>{},fetcher:async()=>{throw Error('offline')}});await fallback.change({id:'4'},prefs.defaults);assert.deepEqual(fallback.target,DEFAULT);
});
test('empty lyric response is missing, explicit instrumental stays distinct',()=>{
 const {parse}=require('../src/lyrics.cjs');assert.equal(parse({lrc:{lyric:''}}).kind,'missing');assert.equal(parse({nolyric:true}).kind,'instrumental');
 assert.equal(parse({lyric:'[00:00]暂无歌词'}).kind,'missing');
});
test('EFS rename EXDEV fallback preserves previous settings and saves the new value',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mineradio-efs-')),file=path.join(dir,'settings.json');prefs.save(file,{fixedColor:'#112233'});
 const io={...fs,renameSync(){throw Object.assign(Error('EFS replace'),{code:'EXDEV'})}};
 prefs.save(file,{fixedColor:'#445566'},io);assert.equal(prefs.load(file).fixedColor,'#445566');assert.equal(prefs.load(file+'.previous').fixedColor,'#112233');assert.equal(fs.existsSync(file+'.tmp'),false);
 const failing={...io,copyFileSync(a,b){if(a.endsWith('.tmp'))throw Error('write denied');return fs.copyFileSync(a,b)}};
 assert.throws(()=>prefs.save(file,{fixedColor:'#778899'},failing),/write denied/);assert.equal(prefs.load(file).fixedColor,'#445566');
 for(const n of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,n));fs.rmdirSync(dir);
});
