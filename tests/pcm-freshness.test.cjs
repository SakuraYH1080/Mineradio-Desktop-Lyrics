const {test}=require('node:test');
const assert=require('node:assert/strict');
const Gate=require('../plugins/MineradioBridge/pcm-freshness.js');
const frame=pts=>({data:new ArrayBuffer(12800),pts});
const ctx=t=>({playing:true,confirmed:true,timelineAgeMs:20,positionMs:50000,monotonicMs:t});
test('zero native PTS requires sustained real callback cadence, retains explicit quality',()=>{
  const g=new Gate();
  for(let i=0;i<5;i++)assert.equal(g.accept(frame(0),ctx(i*67)).ok,false);
  const f=frame(0),r=g.accept(f,ctx(335));assert.equal(r.ok,true);
  assert.equal(r.quality,'callback-receipt/no-native-pts');assert.equal(f.pts,0);
});
test('queued callback burst after a stall cannot establish freshness',()=>{
  const g=new Gate();for(let i=0;i<8;i++)g.accept(frame(0),ctx(i*67));
  assert.equal(g.accept(frame(0),ctx(3000)).ok,false);
  for(let i=1;i<100;i++)assert.equal(g.accept(frame(0),ctx(3000+i)).ok,false);
});
test('observed INT32_MIN missing clock follows the same quarantine and remains distinguishable',()=>{
  const g=new Gate(),f=frame(-2147483648);
  for(let i=0;i<5;i++)assert.equal(g.accept(f,ctx(i*67)).ok,false);
  assert.equal(g.accept(f,ctx(335)).quality,'callback-receipt/no-native-pts');
  assert.equal(f.pts,-2147483648);
  g.reset();assert.equal(g.accept(f,ctx(402)).ok,false);
  assert.equal(g.accept(frame(-1),ctx(469)).reason,'invalid-buffer-or-pts');
  const Analyzer=require('../plugins/MineradioBridge/pcm-analyzer.js'),a=new Analyzer();
  assert.equal(a.push(f.data,f.pts,1000).ptsMs,-2147483648);
  assert.equal(a.push(f.data,-1,1000),null);
});
test('pause, stale timeline and missing native confirmation reject audio',()=>{
  for(const change of [{playing:false},{timelineAgeMs:501},{confirmed:false}]){
    const g=new Gate();for(let i=0;i<8;i++)g.accept(frame(0),ctx(i*67));
    assert.equal(g.accept(frame(0),{...ctx(536),...change}).ok,false);
    assert.equal(g.accept(frame(0),ctx(603)).ok,false);
  }
});
test('track, seek and reconnect reset quarantine; positive bad PTS never falls back',()=>{
  const g=new Gate();for(let i=0;i<8;i++)g.accept(frame(0),ctx(i*67));g.reset();
  assert.equal(g.accept(frame(0),ctx(536)).ok,false);
  assert.equal(g.accept(frame(100),ctx(603)).reason,'pts-skew');
  assert.equal(g.accept(frame(50000),ctx(670)).quality,'native-pts');
  assert.equal(g.accept(frame(NaN),ctx(737)).ok,false);
});
