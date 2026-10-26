const {test}=require('node:test'),assert=require('node:assert/strict');
const {dragTarget}=require('../src/drag.cjs');
test('drag follows native cursor in one coordinate space without accumulating renderer/window feedback',()=>{
 const a={bounds:{x:400,y:400},cursor:{x:600,y:600}},area={x:0,y:0,width:2048,height:1080},ink={left:400,top:100,right:800,bottom:200};
 const t=dragTarget(a,{x:800,y:650},area,ink);assert.deepEqual(t,{x:600,y:450});assert.deepEqual(dragTarget(a,{x:800,y:650},area,ink),t);
});
test('only visible lyrics constrain drag; transparent window padding can pass screen edges',()=>{
 const a={bounds:{x:400,y:400},cursor:{x:600,y:600}},area={x:0,y:0,width:2048,height:1080},ink={left:400,top:100,right:800,bottom:200};
 assert.deepEqual(dragTarget(a,{x:-2000,y:-2000},area,ink),{x:-388,y:-88});
 assert.deepEqual(dragTarget(a,{x:9000,y:9000},area,ink),{x:1236,y:868});
});
