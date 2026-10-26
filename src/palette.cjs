// Small adaptation of upstream 02-visual/07-lyrics-palette-text-utils.js:
// chroma/luminance scoring, bright text HSL, related highlight, 520ms smoothstep.
// No Three.js, player, random colors or per-frame image work.
const DEFAULT={primary:'#f6fdff',secondary:'#a8f6ff',highlight:'#fff0b8',glow:'#9cffdf'};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function hsl(r,g,b){r/=255;g/=255;b/=255;const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min,l=(max+min)/2;let h=0,s=0;if(d){s=d/(1-Math.abs(2*l-1));h=(max===r?(g-b)/d+(g<b?6:0):max===g?(b-r)/d+2:(r-g)/d+4)/6}return {h,s,l}}
function rgb(h,s,l){h=(h%1+1)%1;const f=n=>{const k=(n+h*12)%12;return Math.round(255*(l-s*Math.min(l,1-l)*Math.max(-1,Math.min(k-3,9-k,1))))};return '#'+[f(0),f(8),f(4)].map(x=>x.toString(16).padStart(2,'0')).join('')}
function fromHex(hex){const {h,s,l}=hsl(...hex.match(/[\da-f]{2}/ig).map(x=>parseInt(x,16)));const neutral=s<.035;const sat=neutral?0:Math.max(s*(l>=.62?1:1.2),.86),light=l>=.62?clamp(Math.max(l,.70),.66,.94):clamp(Math.max(l+.30,.74),.70,.90);return {primary:rgb(h,sat,light),secondary:rgb(h+.055,neutral?0:Math.max(sat*.92,.8),clamp(light-.10,.58,.86)),highlight:rgb(h+.018,neutral?0:Math.max(sat*.82,.74),clamp(light+.12,.80,.96)),glow:rgb(h,sat,light)}}
function fromBitmap(bitmap){let best=null,sum=[0,0,0],count=0,maxChroma=0;for(let i=0;i<bitmap.length;i+=4){if(bitmap[i+3]<128)continue;const b=bitmap[i],g=bitmap[i+1],r=bitmap[i+2],lum=(r*.299+g*.587+b*.114)/255,chroma=(Math.max(r,g,b)-Math.min(r,g,b))/255,score=chroma*1.6+(.5-Math.abs(lum-.5))*.45;sum[0]+=r;sum[1]+=g;sum[2]+=b;count++;maxChroma=Math.max(maxChroma,chroma);if(lum>.08&&lum<.92&&(!best||score>best.score))best={r,g,b,score}}
  if(!count)return {...DEFAULT};const c=maxChroma<.055?sum.map(x=>Math.round(x/count)):best?[best.r,best.g,best.b]:sum.map(x=>Math.round(x/count));return fromHex('#'+c.map(x=>x.toString(16).padStart(2,'0')).join(''));
}
class CoverPalette {
  constructor({decode,record=()=>{},fetcher=fetch}){this.decode=decode;this.record=record;this.fetcher=fetcher;this.ids=new Map();this.covers=new Map();this.generation=0;this.key='';this.value={...DEFAULT};this.from=this.value;this.target=this.value;this.changedAt=0}
  targetPalette(value){this.from=this.current();this.target=value;this.changedAt=performance.now()}
  current(){const t=clamp((performance.now()-this.changedAt)/520,0,1),e=t*t*(3-2*t),out={};for(const k of Object.keys(DEFAULT)){const a=this.from[k].match(/[\da-f]{2}/ig).map(x=>parseInt(x,16)),b=this.target[k].match(/[\da-f]{2}/ig).map(x=>parseInt(x,16));out[k]='#'+a.map((x,i)=>Math.round(x+(b[i]-x)*e).toString(16).padStart(2,'0')).join('')}return out}
  async json(url,signal){const r=await this.fetcher(url,{signal,redirect:'error'});if(!r.ok)throw Error('Cover metadata HTTP '+r.status);return r.json()}
  async change(track,prefs){const key=JSON.stringify([track?.id,prefs.colorMode,prefs.fixedColor]);if(key===this.key)return;this.key=key;const generation=++this.generation;this.abort?.abort();this.abort=new AbortController();const signal=AbortSignal.any([this.abort.signal,AbortSignal.timeout(7000)]);
    if(prefs.colorMode==='fixed'){this.targetPalette(fromHex(prefs.fixedColor));return}
    this.targetPalette(DEFAULT);
    if(!/^\d+$/.test(String(track?.id||'')))return;
    try{let url=this.ids.get(track.id);if(!url){const data=await this.json('https://music.163.com/api/song/detail/?id='+track.id+'&ids='+encodeURIComponent('['+track.id+']'),signal);const song=data.songs?.find(s=>String(s.id)===String(track.id));url=song?.album?.picUrl||song?.al?.picUrl;if(!url)throw Error('No cover URL');url=url.replace(/^http:/,'https:');this.ids.set(track.id,url);if(this.ids.size>64)this.ids.delete(this.ids.keys().next().value)}
      const u=new URL(url);if(u.protocol!=='https:'||!/(^|\.)music\.126\.net$/.test(u.hostname)||u.port||u.username||u.password)throw Error('Cover CDN not allowed');
      let colors=this.covers.get(url);if(!colors){const r=await this.fetcher(url+(u.search?'&':'?')+'param=64y64',{signal,redirect:'error'});if(!r.ok)throw Error('Cover HTTP '+r.status);const chunks=[];let size=0;for await(const c of r.body){size+=c.length;if(size>2*1024*1024)throw Error('Cover too large');chunks.push(c)}colors=fromBitmap(this.decode(Buffer.concat(chunks)));this.covers.set(url,colors);if(this.covers.size>32)this.covers.delete(this.covers.keys().next().value)}
      if(generation!==this.generation)return;this.targetPalette(colors);this.record({type:'cover-palette',trackId:track.id,cover:url,colors});
    }catch(error){if(generation===this.generation){this.targetPalette(DEFAULT);this.record({type:'cover-fallback',trackId:track.id,error:error.message})}}
  }
}
module.exports={DEFAULT,fromHex,fromBitmap,CoverPalette};
