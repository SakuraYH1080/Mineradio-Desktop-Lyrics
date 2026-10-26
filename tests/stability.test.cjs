const {test}=require('node:test'),assert=require('node:assert/strict');
const {summarize}=require('../tools/phase2/stability-summary.cjs');
test('matched callback reference separates held SDK position from transport/render delay',()=>{
 const make=(at,reset=1)=>({type:'stability-display',atMs:at,mainReceivedAtMs:at+2,positionMs:12000+at-1000,text:'current',frameIntervalsMs:[33.3],diagnostic:{mainAtMs:at-12,playing:true,usable:true,reset,track:'42',sourceAtMs:1000,sourcePositionMs:12000,trace:{sdkPositionMs:12000},expectedText:'current'}});
 const result=summarize([make(1100),make(1600),make(2100)]);
 assert.equal(result.steadySamples,2);
 assert.equal(result.matchedEventExtrapolatedDifferenceMs.max,0);
 assert.equal(result.heldSdkPositionDifferenceMs.max,1100);
 assert.equal(result.mainToFinalFrameMs.p95,12);
 assert.equal(result.displayGapMs.max,500);
});
test('a missing final-display stream cannot be mistaken for contiguous observation',()=>{
 const result=summarize([]);
 assert.equal(result.displaySamples,0);assert.equal(result.displayGapMs.max,null);
 assert.equal(result.matchedEventExtrapolatedDifferenceMs.max,null);
});
test('the SDK comparison reference stops at track duration instead of inventing end drift',()=>{
 const rows=[1000,1500,2000].map(atMs=>({type:'stability-display',atMs,mainReceivedAtMs:atMs,positionMs:20000,text:'end',diagnostic:{mainAtMs:atMs,playing:true,usable:true,reset:1,track:'42',sourceAtMs:500,sourcePositionMs:19900,durationMs:20000,expectedText:'end'}}));
 assert.equal(summarize(rows).matchedEventExtrapolatedDifferenceMs.max,0);
});
