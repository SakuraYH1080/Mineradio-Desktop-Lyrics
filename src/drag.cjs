// Cursor, window and work-area values are all Electron screen DIPs.
function dragTarget(anchor,cursor,area,ink){
  const clamp=(v,lo,hi)=>Math.round(Math.max(lo,Math.min(Math.max(lo,hi),v)));
  return {x:clamp(anchor.bounds.x+cursor.x-anchor.cursor.x,area.x-ink.left+12,area.x+area.width-ink.right-12),
    y:clamp(anchor.bounds.y+cursor.y-anchor.cursor.y,area.y-ink.top+12,area.y+area.height-ink.bottom-12)};
}
module.exports={dragTarget};
