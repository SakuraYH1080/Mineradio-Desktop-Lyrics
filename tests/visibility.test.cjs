const {test}=require('node:test'),assert=require('node:assert/strict');
const {Visibility}=require('../src/visibility.cjs');
test('held shortcut toggles once until physical release; tray remains independent',async()=>{
  const calls=[];const v=new Visibility({prepare:async()=>{},show:()=>calls.push('show'),hide:()=>calls.push('hide'),changed:()=>{}});
  assert.equal(v.visible,true);await v.shortcut();for(let i=0;i<30;i++)await v.shortcut();assert.deepEqual(calls,['hide']);
  v.released(v.heldAt-5);await v.shortcut();assert.deepEqual(calls,['hide'],'queued old key-up samples do not release a current hold');
  v.released();await v.shortcut();assert.deepEqual(calls,['hide','show']);await v.toggle('tray');assert.equal(v.visible,false);
});
test('show waits for fresh renderer state; obsolete delayed show cannot undo a newer hide',async()=>{
  let ready,shown=0,prepared=0;const v=new Visibility({prepare:()=>{prepared++;return new Promise(r=>ready=r)},show:()=>shown++,hide:()=>{},changed:()=>{}});
  await v.set(false,'tray');const pending=v.set(true,'launch');assert.equal(shown,0);assert.equal(prepared,1);
  await v.set(false,'shortcut');ready();await pending;assert.equal(shown,0);
  const again=v.set(true,'launch');ready();await again;assert.equal(shown,1);assert.equal(v.visible,true);
});
