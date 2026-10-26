// BetterNCM 1.3.4 framework 44b4df2 adds fixed widths to the NCM 3 header.
// Those widths overflow official controls into its right padding. Remove only
// those foreign rules; retain the client's native layout and all other styles.
(function (root) {
  root.MineradioHeaderCompat = function () {
    var removed = [], timer, attempts = 0;
    function repair() {
      Array.from(document.styleSheets).forEach(function (sheet) {
        var owner = sheet.ownerNode;
        if (!owner || owner.tagName !== 'STYLE' || !owner.textContent.includes('bncm-mgr')) return;
        var rules; try { rules = sheet.cssRules; } catch (_) { return; }
        for (var i = rules.length - 1; i >= 0; i--) {
          var r = rules[i], selector = r.selectorText || '';
          var fixed = (selector === '[class^="IconBar_"]' && r.style.width === '200px') ||
            (selector === '[class^="MiniModeIconBar_"]' && r.style.width === '160px') ||
            (selector === '[class^="WindowOpBarContainer_"]' && r.style.gap === '5px');
          if (fixed) { removed.push({ sheet: sheet, text: r.cssText, index: i }); sheet.deleteRule(i); }
        }
      });
      if (++attempts >= 20 || removed.length === 3) clearInterval(timer);
    }
    timer = setInterval(repair, 250); repair();
    return function () {
      clearInterval(timer);
      removed.reverse().forEach(function (r) {
        try { r.sheet.insertRule(r.text, Math.min(r.index, r.sheet.cssRules.length)); } catch (_) {}
      });
    };
  };
})(window);
