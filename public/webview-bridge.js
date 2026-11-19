(() => {
  const webview = window.chrome?.webview;
  if (!webview) return;

  const pending = new Map();
  const listeners = new Map();
  let nextRequest = 0;

  webview.addEventListener('message', ({ data }) => {
    if (data.requestId === undefined) {
      listeners.get(data.channel)?.forEach(listener => listener(...data.args));
      return;
    }
    const request = pending.get(data.requestId);
    pending.delete(data.requestId);
    if (data.error) request.reject(Error(data.error));
    else request.resolve(data.value);
  });

  function invoke(channel, ...args) {
    const requestId = ++nextRequest;
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      webview.postMessage({ channel, args, requestId });
    });
  }

  function subscribe(channel, listener) {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    const callbacks = listeners.get(channel);
    callbacks.add(listener);
    return () => callbacks.delete(listener);
  }

  if (location.pathname === '/public/settings.html') {
    window.lyricSettings = {
      read: () => invoke('mineradio-settings-read'),
      fonts: () => invoke('mineradio-settings-fonts'),
      preview: value => invoke('mineradio-settings-preview', value),
      save: value => invoke('mineradio-settings-save', value),
    };
    return;
  }

  const lyrics = 'mineradio-desktop-lyrics-';
  window.desktopOverlay = {
    visibilityReady: (...args) => webview.postMessage({ channel: 'mineradio-visibility-ready', args }),
    reportDisplay: (...args) => webview.postMessage({ channel: 'mineradio-display-observation', args }),
    onLyricsState: listener => subscribe(lyrics + 'state', listener),
    onLockedHover: listener => subscribe(lyrics + 'locked-hover', listener),
    onWallpaperState: listener => subscribe('mineradio-wallpaper-state', listener),
    setLyricsDrag: active => invoke(lyrics + 'set-dragging', active),
    setLyricsHotBounds: bounds => invoke(lyrics + 'set-hot-bounds', bounds),
    setLyricsLockState: locked => invoke(lyrics + 'set-lock-state', locked),
    closeLyrics: () => invoke(lyrics + 'set-enabled'),
  };
})();
