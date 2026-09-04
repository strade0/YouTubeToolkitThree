// Layout width trimmer content script.

(function () {
  'use strict';

  const STORAGE_PREFIX = 'trimmer.';
  const MASTER_KEY = 'toolkit.masterEnabled';

  const DEFAULT_CONFIG = {
    enabled: true,
    maxWidth: 2000,
    sidebarWidth: 500
  };

  let currentConfig = { ...DEFAULT_CONFIG };
  let masterEnabled = true;
  let configLoaded = false;
  let resizeTimeout = null;

  function isTrimmerEnabled() {
    return configLoaded && masterEnabled && currentConfig.enabled;
  }

  function prefixUpdates(updates) {
    const prefixed = {};
    for (const [key, value] of Object.entries(updates)) {
      prefixed[STORAGE_PREFIX + key] = value;
    }
    return prefixed;
  }

  function applyPrefixedItems(items) {
    if (!items) return;
    if (items[MASTER_KEY] !== undefined) {
      masterEnabled = items[MASTER_KEY] !== false;
    }
    const next = { ...currentConfig };
    for (const key of Object.keys(DEFAULT_CONFIG)) {
      const prefixed = STORAGE_PREFIX + key;
      if (items[prefixed] !== undefined) {
        next[key] = items[prefixed];
      }
    }
    currentConfig = next;
  }

  function loadConfig(callback) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      const defaults = { [MASTER_KEY]: true, ...prefixUpdates(DEFAULT_CONFIG) };
      chrome.storage.sync.get(defaults, (items) => {
        applyPrefixedItems(items);
        configLoaded = true;
        if (callback) callback(currentConfig);
      });
    } else {
      configLoaded = true;
      if (callback) callback(currentConfig);
    }
  }

  function applyStyles(config) {
    const root = document.documentElement;
    if (!root) return;

    const sidebarW = config.sidebarWidth || 320;
    const thumbW = Math.round(sidebarW * 0.42);

    root.style.setProperty('--yt-trimmer-max-width', `${config.maxWidth}px`);
    root.style.setProperty('--yt-trimmer-sidebar-width', `${sidebarW}px`);
    root.style.setProperty('--yt-trimmer-sidebar-thumb-width', `${thumbW}px`);
    root.setAttribute('data-yt-trimmer-enabled', isTrimmerEnabled() ? 'true' : 'false');

    triggerYouTubeResize();
    observeWatchLayout();
  }

  function triggerYouTubeResize() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 50);
  }

  function isWatchPage() {
    return window.location.pathname.startsWith('/watch') || !!document.querySelector('ytd-watch-flexy, ytd-watch-grid');
  }

  function relayoutPlayer() {
    if (!isWatchPage()) return;
    triggerYouTubeResize();
    setTimeout(() => { if (isWatchPage()) window.dispatchEvent(new Event('resize')); }, 200);
    setTimeout(() => { if (isWatchPage()) window.dispatchEvent(new Event('resize')); }, 500);
  }

  let watchObserver = null;
  let watchObservedEl = null;

  function observeWatchLayout() {
    if (!isWatchPage() || !isTrimmerEnabled()) {
      if (watchObserver) {
        watchObserver.disconnect();
        watchObserver = null;
        watchObservedEl = null;
      }
      return;
    }
    const watch = document.querySelector('ytd-watch-flexy, ytd-watch-grid');
    if (!watch || watch === watchObservedEl) return;

    if (watchObserver) watchObserver.disconnect();
    watchObservedEl = watch;
    watchObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          relayoutPlayer();
          return;
        }
      }
    });
    watchObserver.observe(watch, {
      attributes: true,
      attributeFilter: ['theater', 'fullscreen', 'full-bleed-player', 'hidden', 'is-two-columns_']
    });
  }

  function setupMessageListeners() {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) return;

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'trimmer.SET_WIDTH') {
        currentConfig.maxWidth = request.maxWidth;
        if (request.enabled !== undefined) currentConfig.enabled = request.enabled;
        applyStyles(currentConfig);
        sendResponse({ success: true, config: currentConfig });
        return true;
      }
      if (request.action === 'trimmer.SET_SIDEBAR_WIDTH') {
        currentConfig.sidebarWidth = request.sidebarWidth;
        applyStyles(currentConfig);
        sendResponse({ success: true, config: currentConfig });
        return true;
      }
      if (request.action === 'trimmer.UPDATE_CONFIG') {
        currentConfig = { ...currentConfig, ...request.config };
        applyStyles(currentConfig);
        sendResponse({ success: true, config: currentConfig });
        return true;
      }
      if (request.action === 'trimmer.GET_CONFIG') {
        sendResponse({ success: true, config: currentConfig });
        return true;
      }
      return false;
    });

    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        let changed = false;
        if (changes[MASTER_KEY] && changes[MASTER_KEY].newValue !== undefined) {
          masterEnabled = changes[MASTER_KEY].newValue !== false;
          changed = true;
        }
        for (const key of Object.keys(DEFAULT_CONFIG)) {
          const prefixed = STORAGE_PREFIX + key;
          if (changes[prefixed] && changes[prefixed].newValue !== undefined) {
            currentConfig[key] = changes[prefixed].newValue;
            changed = true;
          }
        }
        if (changed) {
          applyStyles(currentConfig);
        }
      });
    }
  }

  loadConfig((config) => {
    applyStyles(config);
  });

  function updateVideoAspectRatio() {
    if (!isWatchPage()) return;
    const watch = document.querySelector('ytd-watch-flexy, ytd-watch-grid');
    if (!watch) return;
    const video = watch.querySelector('video');
    if (video && !video.closest('ytd-inline-preview-renderer, #inline-preview-player, .inline-preview-player') && video.videoWidth > 0 && video.videoHeight > 0) {
      const ratio = video.videoWidth / video.videoHeight;
      document.documentElement.style.setProperty('--yt-trimmer-video-ratio', String(ratio.toFixed(4)));
    }
  }

  function setupLayoutWatchers() {
    observeWatchLayout();
    if (isWatchPage()) {
      updateVideoAspectRatio();
    }

    window.addEventListener('yt-navigate-finish', () => {
      observeWatchLayout();
      if (isWatchPage()) {
        updateVideoAspectRatio();
        relayoutPlayer();
      }
    });
    window.addEventListener('yt-set-theater-mode-enabled', () => {
      if (isWatchPage()) {
        updateVideoAspectRatio();
        relayoutPlayer();
      }
    });
    document.addEventListener('fullscreenchange', () => {
      if (isWatchPage()) {
        updateVideoAspectRatio();
        relayoutPlayer();
      }
    });

    document.addEventListener('loadedmetadata', (e) => {
      if (!isWatchPage()) return;
      if (e.target && e.target.tagName === 'VIDEO' && !e.target.closest('ytd-inline-preview-renderer, #inline-preview-player, .inline-preview-player')) {
        updateVideoAspectRatio();
      }
    }, true);

    document.addEventListener('playing', (e) => {
      if (!isWatchPage()) return;
      if (e.target && e.target.tagName === 'VIDEO' && !e.target.closest('ytd-inline-preview-renderer, #inline-preview-player, .inline-preview-player')) {
        updateVideoAspectRatio();
      }
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setupMessageListeners();
      setupLayoutWatchers();
    });
  } else {
    setupMessageListeners();
    setupLayoutWatchers();
  }
})();
