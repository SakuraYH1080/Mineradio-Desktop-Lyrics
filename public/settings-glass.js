/* Settings-only, size-cached adaptation of Mineradio's SVG glass.
 * Upstream d43de565: 15-control-glass-animations.js / GLASS_SVG_TEXTURE.md.
 * RGB displacement, screen recombination and a small terminal blur are retained;
 * strengths are scaled to controls and stable tall-panel edges, not the player bar.
 */
(function () {
  'use strict';
  const page = document.querySelector('.settings-page');
  if (!page) return;
  const NS = 'http://www.w3.org/2000/svg';
  const XLINK = 'http://www.w3.org/1999/xlink';
  const reduced = window.matchMedia('(prefers-reduced-transparency: reduce)');
  const contrast = window.matchMedia('(forced-colors: active)');
  const capable = typeof CSS !== 'undefined' && CSS.supports('backdrop-filter', 'url(#settings-glass-probe)');
  const entries = new Map();
  const surfaces = new Map();
  const dirty = new Set();
  let counter = 0, frame = 0, stopped = false, failed = false;
  function svg(name, attributes) {
    const node = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attributes || {})) node.setAttribute(key, String(value));
    return node;
  }
  const definitions = svg('svg', {width:0, height:0, 'aria-hidden':'true', focusable:'false'});
  Object.assign(definitions.style, {position:'absolute', width:'0', height:'0', overflow:'hidden', pointerEvents:'none'});
  const defs = svg('defs');
  definitions.appendChild(defs);
  page.appendChild(definitions);

  function disabled() {
    return !capable || failed || reduced.matches || contrast.matches || page.dataset.reduceTransparency === 'true' || document.documentElement.dataset.transparency === 'reduce';
  }
  function mapData(width, height, radius, kind) {
    // Same red/blue gradient + neutral centre construction as upstream. The
    // centre is 128 so its displacement is zero; only the bevel bends the scene.
    const edge = Math.max(1.5, Math.min(12, Math.min(width,height) * (kind === 'panel' ? .035 : .075)));
    const innerW = Math.max(1,width-edge*2), innerH = Math.max(1,height-edge*2);
    const innerRadius = Math.max(1,radius-edge);
    const soft = Math.max(.8,Math.min(5,edge*.7));
    const source = '<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'" viewBox="0 0 '+width+' '+height+'">'+
      '<defs><linearGradient id="x" x1="100%" y1="0%" x2="0%" y2="0%"><stop offset="0%" stop-color="#000000" stop-opacity="0"/><stop offset="100%" stop-color="#ff0000"/></linearGradient>'+
      '<linearGradient id="y" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#000000" stop-opacity="0"/><stop offset="100%" stop-color="#0000ff"/></linearGradient>'+
      '<filter id="soft" x="-20%" y="-30%" width="140%" height="160%"><feGaussianBlur stdDeviation="'+soft.toFixed(2)+'"/></filter></defs>'+
      '<rect width="100%" height="100%" fill="#808080"/>'+
      '<rect width="'+width+'" height="'+height+'" rx="'+radius+'" fill="url(#x)"/>'+
      '<rect width="'+width+'" height="'+height+'" rx="'+radius+'" fill="url(#y)" style="mix-blend-mode:difference"/>'+
      '<rect x="'+edge.toFixed(2)+'" y="'+edge.toFixed(2)+'" width="'+innerW.toFixed(2)+'" height="'+innerH.toFixed(2)+'" rx="'+innerRadius.toFixed(2)+'" fill="#808080" filter="url(#soft)"/>'+
      '</svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(source);
  }
  function strength(kind, height) {
    if (kind === 'panel') return {scale:8, spread:.55, blur:.18};
    if (kind === 'toolbar') return {scale:13, spread:.7, blur:.24};
    if (kind === 'pill') return {scale:7, spread:.45, blur:.18};
    if (kind === 'button') return {scale:Math.max(7,Math.min(10,height*.2)), spread:.5, blur:.20};
    return {scale:Math.max(8,Math.min(14,height*.24)), spread:.65, blur:.24};
  }
  function createEntry(key, width, height, radius, kind) {
    const id = 'settings-glass-' + (++counter);
    const amount = strength(kind,height);
    const filter = svg('filter', {id, x:'-12%', y:'-28%', width:'124%', height:'156%', 'color-interpolation-filters':'sRGB'});
    const image = svg('feImage', {x:0, y:0, width:'100%', height:'100%', preserveAspectRatio:'none', result:'map'});
    const href = mapData(width,height,radius,kind);
    image.setAttribute('href',href);
    image.setAttributeNS(XLINK,'href',href);
    image.addEventListener('error',fallback,{once:true});
    filter.appendChild(image);
    const channels = [
      {name:'red', factor:1.075, dx:-amount.spread, dy:-amount.spread*.08, matrix:'1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0'},
      {name:'green', factor:1, dx:0, dy:0, matrix:'0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0'},
      {name:'blue', factor:.925, dx:amount.spread, dy:amount.spread*.08, matrix:'0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0'},
    ];
    for (const channel of channels) {
      filter.appendChild(svg('feDisplacementMap', {in:'SourceGraphic', in2:'map', scale:(amount.scale*channel.factor).toFixed(2), xChannelSelector:'R', yChannelSelector:'B', result:channel.name+'Displaced'}));
      filter.appendChild(svg('feOffset', {in:channel.name+'Displaced', dx:channel.dx.toFixed(2), dy:channel.dy.toFixed(2), result:channel.name+'Shifted'}));
      const merge = svg('feMerge', {result:channel.name+'Aligned'});
      merge.append(svg('feMergeNode',{in:'SourceGraphic'}),svg('feMergeNode',{in:channel.name+'Shifted'}));
      filter.appendChild(merge);
      filter.appendChild(svg('feColorMatrix',{in:channel.name+'Aligned', type:'matrix', values:channel.matrix, result:channel.name}));
    }
    filter.appendChild(svg('feBlend',{in:'red', in2:'green', mode:'screen', result:'rg'}));
    filter.appendChild(svg('feBlend',{in:'rg', in2:'blue', mode:'screen', result:'recombined'}));
    filter.appendChild(svg('feGaussianBlur',{in:'recombined', stdDeviation:amount.blur}));
    defs.appendChild(filter);
    const entry = {key, id, filter, refs:0};
    entries.set(key,entry);
    return entry;
  }
  function release(surface) {
    if (surface.entry) surface.entry.refs--;
    surface.entry = null;
  }
  function prune() {
    if (entries.size <= 80) return;
    for (const [key, entry] of entries) {
      if (entries.size <= 64) break;
      if (!entry.refs) {entry.filter.remove();entries.delete(key);}
    }
  }
  function measure(element) {
    const surface = surfaces.get(element);
    if (!surface || !element.isConnected) return;
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const width = Math.max(2,Math.round(rect.width/2)*2);
    const height = Math.max(2,Math.round(rect.height/2)*2);
    const radius = Math.max(0,Math.round(Math.min(parseFloat(getComputedStyle(element).borderRadius)||14,width/2,height/2)));
    const key = surface.kind+':'+width+'x'+height+':'+radius;
    if (surface.entry?.key === key) return;
    release(surface);
    const entry = entries.get(key) || createEntry(key,width,height,radius,surface.kind);
    entry.refs++;
    surface.entry = entry;
    surface.layer.style.setProperty('--settings-glass-filter','url("#'+entry.id+'") saturate(1.06)');
    element.classList.add('settings-glass-ready');
    prune();
  }
  function flush() {
    frame = 0;
    if (stopped || document.hidden || disabled()) return;
    const work = Array.from(dirty);
    dirty.clear();
    for (const element of work) measure(element);
  }
  function schedule() {
    if (!stopped && !document.hidden && !disabled() && !frame && dirty.size) frame=requestAnimationFrame(flush);
  }
  function fallback() {
    failed = true;
    console.warn('[SettingsGlass] SVG map unavailable; using the stable reading surface.');
    refresh();
  }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(records=>{
    for (const record of records) dirty.add(record.target);
    schedule();
  }) : null;
  function refresh() {
    if (stopped) return;
    const off = disabled();
    page.classList.toggle('settings-glass-available',!off);
    page.classList.toggle('settings-glass-reduced',off);
    page.dataset.settingsGlass = off ? 'fallback' : 'svg';
    if (frame) {cancelAnimationFrame(frame);frame=0;}
    observer?.disconnect();
    for (const [element,surface] of surfaces) {
      if (off) {
        surface.layer.style.removeProperty('--settings-glass-filter');
        element.classList.remove('settings-glass-ready');
      } else {
        // Restoring visibility keeps cached dimensions and requires no new map.
        if (surface.entry) {
          surface.layer.style.setProperty('--settings-glass-filter','url("#'+surface.entry.id+'") saturate(1.06)');
          element.classList.add('settings-glass-ready');
        }
        dirty.add(element);
        if (!document.hidden) observer?.observe(element);
      }
    }
    schedule();
  }
  function attach() {
    for (const element of page.querySelectorAll('[data-glass]')) {
      if (surfaces.has(element) || element.matches('input,select,textarea,.primary')) continue;
      const kind = ['panel','toolbar','control','button','pill'].includes(element.dataset.glass) ? element.dataset.glass : 'control';
      if (element.tagName === 'BUTTON') {
        const content = document.createElement('span');content.className='glass-content';
        content.append(...Array.from(element.childNodes));element.appendChild(content);
      }
      const layer = document.createElement('span');
      layer.className='glass-material';layer.dataset.glassKind=kind;
      layer.setAttribute('aria-hidden','true');
      layer.style.pointerEvents='none';
      element.prepend(layer);
      element.classList.add('has-settings-glass');
      surfaces.set(element,{layer,kind,entry:null});
    }
    refresh();
  }
  function visibility() {
    if (document.hidden) {if(frame){cancelAnimationFrame(frame);frame=0;}observer?.disconnect();}
    else refresh();
  }
  function changedPreference() {refresh();}
  for (const media of [reduced,contrast]) media.addEventListener?.('change',changedPreference);
  const preferencesObserver = new MutationObserver(()=>refresh());
  preferencesObserver.observe(page,{attributes:true,attributeFilter:['data-reduce-transparency']});
  preferencesObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-transparency']});
  document.addEventListener('visibilitychange',visibility);
  function resizeFallback() {if(!observer){for(const element of surfaces.keys())dirty.add(element);schedule();}}
  window.addEventListener('resize',resizeFallback,{passive:true});
  function destroy() {
    stopped=true;if(frame)cancelAnimationFrame(frame);
    observer?.disconnect();preferencesObserver.disconnect();
    for(const media of [reduced,contrast])media.removeEventListener?.('change',changedPreference);
    document.removeEventListener('visibilitychange',visibility);
    window.removeEventListener('resize',resizeFallback);
    dirty.clear();entries.clear();surfaces.clear();
  }
  window.addEventListener('pagehide',destroy,{once:true});
  window.SettingsGlass=Object.freeze({refresh,attach,destroy});
  attach();
})();
