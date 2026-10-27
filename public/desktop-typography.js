/* One DOM shaping result for text, karaoke pixels, fitting, scrolling and Canvas. */
(function () {
  'use strict';
  function DesktopLyricLayout(line) {
    this.line = line;
    this.key = '';
    this.runs = [];
    this.nodes = [];
    this.cache = new Map();
    this.layout = null;
    this.styleKey = '';
    this.measurement = document.createElement('span');
    this.measurement.className = 'line lyric-measure';
    this.measurement.setAttribute('aria-hidden', 'true');
    Object.assign(this.measurement.style, {
      position:'fixed', left:'0', top:'0', visibility:'hidden', pointerEvents:'none',
      width:'max-content', maxWidth:'none', transform:'none', animation:'none',
      transition:'none', filter:'none', willChange:'auto', textShadow:'none',
      background:'none', contain:'layout style',
    });
    document.body.appendChild(this.measurement);
  }
  DesktopLyricLayout.prototype.update = function (text, options) {
    var key = JSON.stringify([text, options.families, options.language, options.context]);
    if (key === this.key) return false;
    this.key = key;
    this.text = text;
    this.runs = window.LyricTypography.createRuns(text, options);
    var visible = document.createDocumentFragment(), measured = document.createDocumentFragment();
    this.nodes = [];
    for (var run of this.runs) {
      var span = document.createElement('span');
      span.className = 'lyric-run';
      span.style.fontFamily = run.fontFamily;
      span.textContent = run.text;
      visible.appendChild(span);
      var copy = span.cloneNode(true);
      measured.appendChild(copy);
      this.nodes.push(copy);
    }
    this.baselineMarker = document.createElement('span');
    Object.assign(this.baselineMarker.style, {display:'inline-block',width:'0',height:'0',padding:'0',margin:'0',verticalAlign:'baseline'});
    measured.appendChild(this.baselineMarker);
    this.line.replaceChildren(visible);
    this.measurement.replaceChildren(measured);
    this.invalidate();
    return true;
  };
  DesktopLyricLayout.prototype.invalidate = function () {
    this.cache.clear();this.layout = null;this.styleKey = '';
  };
  DesktopLyricLayout.prototype.setStyle = function (size, weight, spacing, lineHeight) {
    var pixels = (size * spacing).toFixed(2);
    var key = [size,weight,pixels,lineHeight].join('|');
    if (this.styleKey !== key) {
      Object.assign(this.measurement.style, {fontSize:size+'px',fontWeight:String(weight),letterSpacing:pixels+'px',lineHeight:String(lineHeight)});
      this.styleKey = key;
    }
    return key;
  };
  DesktopLyricLayout.prototype.measure = function (size, weight, spacing, lineHeight) {
    var key = this.setStyle(size,weight,spacing,lineHeight);
    if (!this.cache.has(key)) {
      var rect = this.measurement.getBoundingClientRect();
      this.cache.set(key,{width:Math.max(1,rect.width),height:Math.max(1,rect.height)});
    }
    return this.cache.get(key);
  };
  DesktopLyricLayout.prototype.commit = function (size, weight, spacing, lineHeight) {
    var key = this.setStyle(size,weight,spacing,lineHeight);
    if (this.layout && this.layout.styleKey === key) return this.layout;
    var box = this.measurement.getBoundingClientRect(), clusters = [], positioned = [];
    var baseline = this.baselineMarker.getBoundingClientRect().top - box.top;
    for (var i=0;i<this.runs.length;i++) {
      var run = this.runs[i], span = this.nodes[i], node = span.firstChild;
      if (!node) continue;
      var left = span.getBoundingClientRect().left - box.left;
      var range = document.createRange();
      range.setStart(node,0);range.setEnd(node,node.length);
      var width = range.getBoundingClientRect().width;
      positioned.push({text:run.text,fontFamily:run.fontFamily,left:left,width:width});
      var previous = left;
      for (var part of window.LyricTypography.graphemes(run.text)) {
        range.setEnd(node,part.end);
        var right = left + range.getBoundingClientRect().width;
        clusters.push({start:run.start+part.start,end:run.start+part.end,left:previous,right:right});
        previous = right;
      }
    }
    this.layout = {styleKey:key,size:size,weight:weight,spacing:(size*spacing).toFixed(2)+'px',
      width:Math.max(1,box.width),height:Math.max(1,box.height),baseline:baseline,
      runs:positioned,clusters:clusters,length:this.text.length};
    return this.layout;
  };
  DesktopLyricLayout.prototype.pixelProgress = function (value) {
    var p = Math.max(0,Math.min(1,Number(value)||0)), layout = this.layout;
    if (!layout || !layout.clusters.length || p===0 || p===1) return p;
    var target=p*layout.length, list=layout.clusters, low=0, high=list.length-1;
    while(low<high){var mid=(low+high)>>1;if(list[mid].end<target)low=mid+1;else high=mid;}
    var item=list[low], fraction=Math.max(0,Math.min(1,(target-item.start)/Math.max(1,item.end-item.start)));
    return Math.max(0,Math.min(1,(item.left+(item.right-item.left)*fraction)/layout.width));
  };
  DesktopLyricLayout.prototype.paint = function (ctx, x, y, stroke) {
    var layout=this.layout;if(!layout)return;
    for (var run of layout.runs) {
      ctx.save();ctx.font=layout.weight+' '+layout.size+'px '+run.fontFamily;
      ctx.textAlign='left';ctx.textBaseline='alphabetic';
      if ('letterSpacing' in ctx)ctx.letterSpacing=layout.spacing;
      var nativeWidth=ctx.measureText(run.text).width;
      ctx.translate(x-layout.width/2+run.left,y-layout.height/2+layout.baseline);
      // Use the exact DOM-shaped advance even on a Canvas lacking letterSpacing.
      if(nativeWidth>0)ctx.scale(run.width/nativeWidth,1);
      if(stroke)ctx.strokeText(run.text,0,0);else ctx.fillText(run.text,0,0);
      ctx.restore();
    }
  };
  window.DesktopLyricLayout = DesktopLyricLayout;
})();
