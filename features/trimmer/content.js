// Layout width trimmer content script.

(function () {
  'use strict';

  const STORAGE_PREFIX = 'trimmer.';
  const MASTER_KEY = 'toolkit.masterEnabled';

  const DEFAULT_CONFIG = {
    enabled: true,
    maxWidth: 1440,
    sidebarWidth: 320,
    align: 'center',
    allPages: false,
    trimTheater: false,
    showHud: false,
    enableHotkeys: true
  };

  let currentConfig = { ...DEFAULT_CONFIG };
  let masterEnabled = true;
  let hudElement = null;
  let toastElement = null;
  let toastTimeout = null;
  let resizeTimeout = null;

  function isTrimmerEnabled() {
    return masterEnabled && currentConfig.enabled;
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
        if (callback) callback(currentConfig);
      });
    } else {
      if (callback) callback(currentConfig);
    }
  }

  function saveConfig(updates, callback) {
    currentConfig = { ...currentConfig, ...updates };
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set(prefixUpdates(updates), () => {
        if (callback) callback(currentConfig);
      });
    } else {
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
    root.setAttribute('data-yt-trimmer-enabled', (masterEnabled && config.enabled) ? 'true' : 'false');
    root.setAttribute('data-yt-trimmer-align', config.align || 'center');
    root.setAttribute('data-yt-trimmer-all-pages', config.allPages ? 'true' : 'false');
    root.setAttribute('data-yt-trimmer-theater', config.trimTheater ? 'true' : 'false');

    triggerYouTubeResize();
    updateHudUi();
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
    if (!isWatchPage()) {
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

  function showToast(message) {
    if (!toastElement) {
      toastElement = document.createElement('div');
      toastElement.id = 'yt-trimmer-toast';
      document.body.appendChild(toastElement);
    }

    toastElement.textContent = message;
    toastElement.classList.add('yt-trimmer-toast-show');

    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      if (toastElement) {
        toastElement.classList.remove('yt-trimmer-toast-show');
      }
    }, 1600);
  }

  function setupHud() {
    if (hudElement || !document.body) return;

    hudElement = document.createElement('div');
    hudElement.id = 'yt-trimmer-hud';
    hudElement.innerHTML = `
      <button class="yt-trimmer-hud-icon-btn" id="yt-trimmer-hud-toggle" title="YouTube Layout Trimmer (Click to collapse/expand)">
        <svg viewBox="0 0 24 24">
          <path d="M4 6h2v12H4V6zm14 0h2v12h-2V6zM8.5 12l3.5-3.5v7L8.5 12zm7 0L12 8.5v7l3.5-3.5z"/>
        </svg>
      </button>
      <div class="yt-trimmer-hud-body">
        <button class="yt-trimmer-hud-step-btn" id="yt-trimmer-hud-minus" title="Decrease width (Alt+[)">−</button>
        <input type="range" class="yt-trimmer-hud-slider" id="yt-trimmer-hud-slider" min="960" max="2560" step="20" value="${currentConfig.maxWidth}" title="Drag to adjust width in real time">
        <button class="yt-trimmer-hud-step-btn" id="yt-trimmer-hud-plus" title="Increase width (Alt+])">+</button>
        <span class="yt-trimmer-hud-val" id="yt-trimmer-hud-val">${currentConfig.maxWidth}px</span>
      </div>
    `;

    document.body.appendChild(hudElement);

    const slider = hudElement.querySelector('#yt-trimmer-hud-slider');
    const valText = hudElement.querySelector('#yt-trimmer-hud-val');
    const minusBtn = hudElement.querySelector('#yt-trimmer-hud-minus');
    const plusBtn = hudElement.querySelector('#yt-trimmer-hud-plus');
    const toggleBtn = hudElement.querySelector('#yt-trimmer-hud-toggle');

    slider.addEventListener('input', (e) => {
      const newWidth = parseInt(e.target.value, 10);
      currentConfig.maxWidth = newWidth;
      valText.textContent = `${newWidth}px`;
      document.documentElement.style.setProperty('--yt-trimmer-max-width', `${newWidth}px`);
      triggerYouTubeResize();
    });

    slider.addEventListener('change', (e) => {
      const newWidth = parseInt(e.target.value, 10);
      saveConfig({ maxWidth: newWidth });
    });

    minusBtn.addEventListener('click', () => {
      const newWidth = Math.max(960, currentConfig.maxWidth - 40);
      updateWidth(newWidth, true);
    });

    plusBtn.addEventListener('click', () => {
      const newWidth = Math.min(2560, currentConfig.maxWidth + 40);
      updateWidth(newWidth, true);
    });

    toggleBtn.addEventListener('click', () => {
      hudElement.classList.toggle('yt-trimmer-hud-collapsed');
    });

    updateHudUi();
  }

  function updateHudUi() {
    if (!hudElement) return;

    if (!currentConfig.showHud || !isTrimmerEnabled()) {
      hudElement.classList.add('yt-trimmer-hud-hidden');
    } else {
      hudElement.classList.remove('yt-trimmer-hud-hidden');
    }

    const slider = hudElement.querySelector('#yt-trimmer-hud-slider');
    const valText = hudElement.querySelector('#yt-trimmer-hud-val');

    if (slider) slider.value = currentConfig.maxWidth;
    if (valText) valText.textContent = `${currentConfig.maxWidth}px`;
  }

  function updateWidth(newWidth, notify = false) {
    currentConfig.maxWidth = newWidth;
    applyStyles(currentConfig);
    saveConfig({ maxWidth: newWidth });
    if (notify) {
      showToast(`Width: ${newWidth}px`);
    }
  }

  function setupHotkeys() {
    window.addEventListener('keydown', (e) => {
      if (!masterEnabled || !currentConfig.enableHotkeys) return;

      const target = e.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if (e.altKey && e.key === '[') {
        e.preventDefault();
        const newWidth = Math.max(960, currentConfig.maxWidth - 50);
        updateWidth(newWidth, true);
      } else if (e.altKey && e.key === ']') {
        e.preventDefault();
        const newWidth = Math.min(2560, currentConfig.maxWidth + 50);
        updateWidth(newWidth, true);
      } else if (e.altKey && e.key === '\\') {
        e.preventDefault();
        const newEnabled = !currentConfig.enabled;
        currentConfig.enabled = newEnabled;
        applyStyles(currentConfig);
        saveConfig({ enabled: newEnabled });
        showToast(newEnabled ? `Trimmer Enabled (${currentConfig.maxWidth}px)` : 'Trimmer Disabled (Full Width)');
      }
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
      } else if (request.action === 'trimmer.SET_SIDEBAR_WIDTH') {
        currentConfig.sidebarWidth = request.sidebarWidth;
        applyStyles(currentConfig);
        sendResponse({ success: true, config: currentConfig });
      } else if (request.action === 'trimmer.UPDATE_CONFIG') {
        currentConfig = { ...currentConfig, ...request.config };
        applyStyles(currentConfig);
        sendResponse({ success: true, config: currentConfig });
      } else if (request.action === 'trimmer.GET_CONFIG') {
        sendResponse({ success: true, config: currentConfig });
      }
      return true;
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
      setupHud();
      setupHotkeys();
      setupMessageListeners();
      setupLayoutWatchers();
    });
  } else {
    setupHud();
    setupHotkeys();
    setupMessageListeners();
    setupLayoutWatchers();
  }
})();
