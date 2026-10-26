// Local-only analysis of documented InfLink 48kHz/int16/stereo frames.
// No microphone access, audio storage, network PCM transfer, or audio playback.
(function(root){
  class PcmAnalyzer {
    constructor(){this.reset();}
    reset(){this.low=0;this.baseline=0;this.energy=0;this.bass=0;this.pulse=0;this.elapsed=0;this.lastBeat=-Infinity;this.lastPts=null;}
    push(data,pts,now){
      if(!(data instanceof ArrayBuffer)||data.byteLength<4||data.byteLength>1048576||data.byteLength%4||!Number.isFinite(pts)||(pts<0&&pts!==-2147483648)||!Number.isFinite(now))return null;
      if(this.lastPts!==null&&(pts<this.lastPts-200||pts-this.lastPts>1000))this.reset();
      this.lastPts=pts;
      const samples=new Int16Array(data),frames=samples.length/2,dt=frames/48000;
      let energy=0,lowEnergy=0;
      const alpha=1-Math.exp(-2*Math.PI*120/48000);
      for(let i=0;i<samples.length;i+=2){const x=(samples[i]+samples[i+1])/65536;this.low+=alpha*(x-this.low);energy+=x*x;lowEnergy+=this.low*this.low;}
      const rms=Math.sqrt(energy/frames),lowRms=Math.sqrt(lowEnergy/frames);
      const baseline=this.baseline;
      this.baseline+=(lowRms-this.baseline)*(1-Math.exp(-dt/.65));
      this.energy+=(rms-this.energy)*(1-Math.exp(-dt/(rms>this.energy?.035:.24)));
      this.bass+=(lowRms*5-this.bass)*(1-Math.exp(-dt/(lowRms*5>this.bass?.045:.22)));
      this.pulse*=Math.exp(-dt/.16);
      this.elapsed+=dt;
      if(this.elapsed>.3&&lowRms>Math.max(.012,baseline*1.32)&&now-this.lastBeat>180){this.pulse=Math.min(1.4,(lowRms-baseline)*14+.35);this.lastBeat=now;}
      return {source:'inflink-pcm',observedAtMs:now,ptsMs:pts,rms,bass:Math.max(0,Math.min(1.2,this.bass)),beatPulse:this.pulse,beatGlow:Math.max(0,Math.min(1.7,this.energy*2.6+this.pulse*.55)),sampleFrames:frames};
    }
  }
  if(typeof module==='object'&&module.exports)module.exports=PcmAnalyzer;
  else root.MineradioPcmAnalyzer=PcmAnalyzer;
})(typeof window==='object'?window:globalThis);
