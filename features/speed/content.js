// 2x Speed Lock content script: hold left-click and release over the 2x icon to lock or reset playback speed.

(function () {
  'use strict';

  const STORAGE_PREFIX = 'speed.';
  const MASTER_KEY = 'toolkit.masterEnabled';
  const DWELL_MS = 300;
  const SPEED_MIN = 0.25;
  const SPEED_MAX = 3;
  const LOCK_ICON_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>';

  const config = {
    enabled: true,
    targetSpeed: 2.0
  };
  let masterEnabled = true;
  let configLoaded = false;

  function isSpeedEnabled() {
    return configLoaded && masterEnabled && config.enabled;
  }

  const SPEED_TEXT_RE = /\d+(?:\.\d+)?[xX]/;

  function getTargetSpeed() {
    const n = Number(config.targetSpeed);
    return Number.isFinite(n) && n > 0 ? n : 2.0;
  }

  function formatSpeedLabel(rate) {
    const n = Number(rate);
    if (!Number.isFinite(n)) return '1x';
    if (Math.abs(n - 1) < 0.01) return '1x';
    if (Math.abs(n - Math.round(n)) < 0.01) return `${Math.round(n)}x`;
    return `${n}x`;
  }

  function isNormalRate(rate) {
    return !Number.isFinite(rate) || Math.abs(rate - 1) < 0.05;
  }

  function roundToQuarter(n) {
    return Math.round(n * 4) / 4;
  }

  function getPickerSpeeds() {
    const target = roundToQuarter(frozenCenterRate != null ? frozenCenterRate : getTargetSpeed());
    const left = [];
    const right = [];
    [0.25, 0.5].forEach((step) => {
      const value = roundToQuarter(target - step);
      if (value >= SPEED_MIN && Math.abs(value - target) > 0.01) left.push(value);
    });
    [0.25, 0.5].forEach((step) => {
      const value = roundToQuarter(target + step);
      if (value <= SPEED_MAX && Math.abs(value - target) > 0.01) right.push(value);
    });
    return { target, left, right };
  }

  let isPointerDown = false;
  let isHoveringBadge = false;
  let pointerDownTime = 0;
  let activePointerId = null;
  let basePlaybackRate = 1.0;
  let currentTargetEl = null;
  let hoveredPick = null;
  let dwellTimer = null;
  let pickerOpen = false;
  let pickerClosing = false;
  let pickerHost = null;
  let pickerPills = [];
  let pickerCloseTimer = null;
  let nativeOverlayEl = null;
  let frozenCenterRate = null;

  let activePlayer = null;
  let activeVideo = null;
  let hintEl = null;
  let toastEl = null;
  let toastTimer = null;
  let suppressNextClick = false;
  let suppressClickTimer = null;
  let pillSyncInterval = null;

  const BRIDGE_SOURCE = 'yt-toolkit-volume-bridge';

  function cloneForPage(value) {
    if (typeof cloneInto === 'function') {
      try {
        const target = window.wrappedJSObject || window;
        return cloneInto(value, target, { cloneFunctions: false });
      } catch (e) {}
    }
    return value;
  }

  function dispatchToPage(name, detail) {
    const payload = detail && typeof detail === 'object' ? detail : {};
    try {
      window.dispatchEvent(new CustomEvent(name, { detail: cloneForPage(payload) }));
    } catch (e) {
      try {
        window.dispatchEvent(new CustomEvent(name, { detail: payload }));
      } catch (err) {}
    }
  }

  function loadConfig() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get({
        [MASTER_KEY]: true,
        [STORAGE_PREFIX + 'enabled']: true,
        [STORAGE_PREFIX + 'targetSpeed']: 2.0
      }, (items) => {
        if (items[MASTER_KEY] !== undefined) {
          masterEnabled = items[MASTER_KEY] !== false;
        }
        if (items[STORAGE_PREFIX + 'enabled'] !== undefined) {
          config.enabled = items[STORAGE_PREFIX + 'enabled'] !== false;
        }
        if (items[STORAGE_PREFIX + 'targetSpeed'] !== undefined) {
          config.targetSpeed = Number(items[STORAGE_PREFIX + 'targetSpeed']) || 2.0;
        }
        configLoaded = true;
      });
    } else {
      configLoaded = true;
    }
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      if (changes[MASTER_KEY] && changes[MASTER_KEY].newValue !== undefined) {
        masterEnabled = changes[MASTER_KEY].newValue !== false;
      }
      if (changes[STORAGE_PREFIX + 'enabled'] && changes[STORAGE_PREFIX + 'enabled'].newValue !== undefined) {
        config.enabled = changes[STORAGE_PREFIX + 'enabled'].newValue !== false;
      }
      if (changes[STORAGE_PREFIX + 'targetSpeed'] && changes[STORAGE_PREFIX + 'targetSpeed'].newValue !== undefined) {
        config.targetSpeed = Number(changes[STORAGE_PREFIX + 'targetSpeed'].newValue) || 2.0;
      }
      if (!isSpeedEnabled()) {
        teardownSpeedGesture();
      }
    });
  }

  function resolvePlayer() {
    const moviePlayer = document.getElementById('movie_player');
    if (moviePlayer) {
      const video = moviePlayer.querySelector('video') || document.querySelector('video');
      return { player: moviePlayer, video };
    }
    const watchPlayer = document.querySelector('.html5-video-player, ytd-player, #player');
    const video = document.querySelector('video');
    return { player: watchPlayer || null, video: video || null };
  }

  function desiredPillLabel() {
    const rate = frozenCenterRate != null
      ? frozenCenterRate
      : (isNormalRate(basePlaybackRate) ? getTargetSpeed() : 1);
    return formatSpeedLabel(rate);
  }

  function syncPillLabel(label) {
    const p = activePlayer || document.getElementById('movie_player') || document.body;
    if (!p) return;

    const overlay = p.querySelector('.ytp-speedmaster-overlay, [class*="speedmaster-overlay"]');
    if (!overlay) return;

    if (!label) {
      const allElements = overlay.querySelectorAll('*');
      for (const el of allElements) {
        for (const node of el.childNodes) {
          if (node.nodeType === Node.TEXT_NODE && node._origValue !== undefined) {
            node.nodeValue = node._origValue;
            delete node._origValue;
          }
        }
      }
      return;
    }

    const elements = [
      overlay.querySelector('.ytp-speedmaster-label'),
      overlay.querySelector('.ytp-speedmaster-pill'),
      overlay.querySelector('[class*="speedmaster-label"]'),
      ...overlay.querySelectorAll('*')
    ].filter(Boolean);

    for (const el of elements) {
      for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.nodeValue && SPEED_TEXT_RE.test(node.nodeValue)) {
          if (node._origValue === undefined) {
            node._origValue = node.nodeValue;
          }
          node.nodeValue = node._origValue.replace(SPEED_TEXT_RE, label);
        }
      }
    }
  }

  function isCompactPillRect(rect) {
    return rect && rect.width > 36 && rect.width < 280 && rect.height > 16 && rect.height < 80;
  }

  function isOurSpeedUi(el) {
    if (!el || !el.closest) return false;
    return !!el.closest('.yt-speed-picker, .yt-speed-lock-hint, .yt-speed-toast');
  }

  function getVideoContentRect(player) {
    const p = player || activePlayer;
    const video = (p && p.querySelector && p.querySelector('video')) ||
      document.querySelector('#movie_player video, .html5-video-player video, video.html5-main-video, video');
    if (video) {
      try {
        const rect = video.getBoundingClientRect();
        if (rect.width > 32 && rect.height > 32) return rect;
      } catch (e) {}
    }
    if (p && p.getBoundingClientRect) {
      try {
        const rect = p.getBoundingClientRect();
        if (rect.width > 32 && rect.height > 32) return rect;
      } catch (e) {}
    }
    return null;
  }

  function getFullscreenElement() {
    try {
      return document.fullscreenElement || document.webkitFullscreenElement || null;
    } catch (e) {
      return null;
    }
  }

  function getPickerMountRoot() {
    const player = activePlayer || document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    const fs = getFullscreenElement();
    if (fs) {
      if (player && (fs === player || fs.contains(player))) return player;
      return fs;
    }
    return player || document.body;
  }

  function isDocumentRoot(el) {
    return !el || el === document.body || el === document.documentElement;
  }

  function layoutPicker(host, items, mount, pillRect) {
    if (!host || !pillRect) return;
    const mountIsBody = isDocumentRoot(mount);
    let originLeft = 0;
    let originTop = 0;
    let scaleX = 1;
    let scaleY = 1;

    if (mountIsBody) {
      host.style.position = 'fixed';
      host.style.left = '0px';
      host.style.top = '0px';
      host.style.width = '100vw';
      host.style.height = '100vh';
    } else {
      host.style.position = 'absolute';
      host.style.left = '0px';
      host.style.top = '0px';
      host.style.width = '100%';
      host.style.height = '100%';
      try {
        const mountRect = mount.getBoundingClientRect();
        originLeft = mountRect.left;
        originTop = mountRect.top;
        if (mount.offsetWidth) scaleX = mountRect.width / mount.offsetWidth;
        if (mount.offsetHeight) scaleY = mountRect.height / mount.offsetHeight;
      } catch (e) {}
    }

    const cx = (pillRect.left + pillRect.width / 2 - originLeft) / (scaleX || 1);
    const cy = (pillRect.top + pillRect.height / 2 - originTop) / (scaleY || 1);
    (items || []).forEach((item) => {
      item.el.style.left = `${cx}px`;
      item.el.style.top = `${cy}px`;
    });
  }

  function refreshPillInfo(pillInfo) {
    if (pillInfo && pillInfo.el && typeof pillInfo.el.getBoundingClientRect === 'function') {
      try {
        const rect = pillInfo.el.getBoundingClientRect();
        if (isCompactPillRect(rect)) {
          return { el: pillInfo.el, overlay: pillInfo.overlay || null, rect };
        }
      } catch (e) {}
    }
    if (pillInfo && pillInfo.rect) return pillInfo;
    return getSpeedmasterPillRect(activePlayer) || pillInfo;
  }

  function getSpeedmasterPillRect(player) {
    const p = player || activePlayer || document.getElementById('movie_player') || document.body;
    if (!p) return null;

    const overlay = p.querySelector('.ytp-speedmaster-overlay, [class*="speedmaster-overlay"]');

    const containerSelectors = [
      '.ytp-speedmaster-pill',
      '[class*="speedmaster-pill"]',
      '.ytp-speedmaster-overlay-content',
      '.ytp-speedmaster-overlay > div'
    ];

    for (const sel of containerSelectors) {
      const el = p.querySelector(sel);
      if (!el || isOurSpeedUi(el)) continue;
      const rect = el.getBoundingClientRect();
      if (isCompactPillRect(rect)) {
        return { el, rect, overlay };
      }
    }

    if (overlay) {
      let best = null;
      const children = overlay.querySelectorAll('*');
      for (const child of children) {
        if (isOurSpeedUi(child)) continue;
        if (!child.textContent || !SPEED_TEXT_RE.test(child.textContent)) continue;
        const hasIcon = !!child.querySelector('svg, img');
        const rect = child.getBoundingClientRect();
        if (!isCompactPillRect(rect)) continue;
        if (hasIcon) {
          if (!best || rect.width > best.rect.width) {
            best = { el: child, rect, overlay };
          }
        } else if (!best) {
          best = { el: child, rect, overlay };
        }
      }
      if (best) return best;

      const oRect = overlay.getBoundingClientRect();
      if (isCompactPillRect(oRect)) {
        return { el: overlay, rect: oRect, overlay };
      }
    }

    const isSpeedmasterActive = p.classList.contains('ytp-speedmaster-active') ||
      (overlay && window.getComputedStyle(overlay).display !== 'none');

    if (isSpeedmasterActive) {
      const sourceRect = getVideoContentRect(p) || p.getBoundingClientRect();
      const centerX = sourceRect.left + sourceRect.width / 2;
      const top = sourceRect.top + 10;
      const bottom = sourceRect.top + 60;
      const left = centerX - 60;
      const right = centerX + 60;
      return {
        el: overlay || p,
        overlay: overlay || null,
        rect: { left, right, top, bottom, width: 120, height: 50 }
      };
    }

    return null;
  }

  function isPointOverRect(clientX, clientY, rect, pad) {
    if (!rect) return false;
    const p = pad || 0;
    return (
      clientX >= rect.left - p &&
      clientX <= rect.right + p &&
      clientY >= rect.top - p &&
      clientY <= rect.bottom + p
    );
  }

  function isPointOverPill(clientX, clientY, pillInfo) {
    if (!pillInfo || !pillInfo.rect) return false;
    return isPointOverRect(clientX, clientY, pillInfo.rect, 10);
  }

  function isInteractiveElement(target) {
    if (!target) return false;
    const excludedSelectors = [
      '.ytp-chrome-bottom',
      '.ytp-chrome-top',
      '.ytp-popup',
      '.ytp-settings-menu',
      '.ytp-contextmenu',
      '.ytp-volume-control',
      '.ytp-volume-panel',
      '.ytp-volume-slider',
      '.ytp-mute-button',
      'button',
      'a',
      'input',
      'select',
      'textarea',
      'ytd-menu-renderer'
    ];
    for (const selector of excludedSelectors) {
      if (target.closest && target.closest(selector)) {
        return true;
      }
    }
    return false;
  }

  function clearDwellTimer() {
    if (dwellTimer) {
      clearTimeout(dwellTimer);
      dwellTimer = null;
    }
  }

  function clearPickerCloseTimer() {
    if (pickerCloseTimer) {
      clearTimeout(pickerCloseTimer);
      pickerCloseTimer = null;
    }
  }

  function setNativeOverlayHidden(hidden) {
    if (nativeOverlayEl) {
      nativeOverlayEl.classList.toggle('yt-speed-picker-active', !!hidden);
    }
  }

  function destroyPicker() {
    clearDwellTimer();
    clearPickerCloseTimer();
    pickerOpen = false;
    pickerClosing = false;
    setNativeOverlayHidden(false);
    nativeOverlayEl = null;
    pickerPills = [];
    if (pickerHost && pickerHost.parentElement) {
      pickerHost.parentElement.removeChild(pickerHost);
    }
    pickerHost = null;
  }

  function closePickerAnimated() {
    if (!pickerHost || pickerClosing) return;
    pickerClosing = true;
    pickerOpen = false;
    highlightPicker(null);
    pickerHost.classList.remove('is-open');
    const sideRings = pickerPills
      .filter((item) => item.role === 'side')
      .map((item) => Number(item.el.dataset.ring) || 1);
    const maxRing = Math.max(1, ...sideRings);
    pickerPills.forEach((item) => {
      if (item.role !== 'side') return;
      const ring = Number(item.el.dataset.ring) || 1;
      item.el.style.transitionDelay = `${0.06 * (maxRing - ring + 1)}s`;
    });
    void pickerHost.offsetWidth;
    pickerHost.classList.add('is-closing');
    const host = pickerHost;
    clearPickerCloseTimer();
    pickerCloseTimer = setTimeout(() => {
      if (pickerHost !== host) return;
      host.classList.add('is-fading');
      pickerCloseTimer = setTimeout(() => {
        pickerCloseTimer = null;
        if (pickerHost === host) destroyPicker();
      }, 400);
    }, 580);
  }

  function createPickerPill(rate, role, width, height, offsetX, delayS, ring) {
    const pill = document.createElement('div');
    pill.className = 'yt-speed-picker-pill' + (role === 'center' ? ' is-center' : ' is-side');
    pill.textContent = formatSpeedLabel(rate);
    pill.style.width = `${Math.max(44, Math.round(width))}px`;
    pill.style.height = `${Math.max(24, Math.round(height))}px`;
    pill.style.setProperty('--yt-speed-shift', `${offsetX}px`);
    pill.style.transitionDelay = `${delayS}s`;
    if (ring) pill.dataset.ring = String(ring);
    return { el: pill, rate, role };
  }

  function openPicker(pillInfo) {
    if (!isPointerDown || pickerOpen || !activePlayer || !pillInfo) return;
    const { target, left, right } = getPickerSpeeds();
    if (!left.length && !right.length) return;

    const liveInfo = refreshPillInfo(pillInfo);
    const rect = liveInfo.rect;
    const host = document.createElement('div');
    host.className = 'yt-speed-picker';

    const width = rect.width;
    const height = rect.height;
    const step = width + 8;
    const items = [];

    left.forEach((rate, i) => {
      items.push(createPickerPill(rate, 'side', width, height, -step * (i + 1), 0.06 * (i + 1), i + 1));
    });
    items.push(createPickerPill(target, 'center', width, height, 0, 0));
    right.forEach((rate, i) => {
      items.push(createPickerPill(rate, 'side', width, height, step * (i + 1), 0.06 * (i + 1), i + 1));
    });

    items.forEach((item) => {
      if (item.role !== 'center') host.appendChild(item.el);
    });
    const centerItem = items.find((item) => item.role === 'center');
    if (centerItem) host.appendChild(centerItem.el);

    const mountRoot = getPickerMountRoot();
    (mountRoot || document.body || activePlayer).appendChild(host);
    layoutPicker(host, items, mountRoot, rect);
    pickerHost = host;
    pickerPills = items;
    pickerOpen = true;
    nativeOverlayEl = liveInfo.overlay || (liveInfo.el && liveInfo.el.closest && liveInfo.el.closest('.ytp-speedmaster-overlay, [class*="speedmaster-overlay"]'));
    hideHint();

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!pickerHost) return;
        layoutPicker(pickerHost, pickerPills, pickerHost.parentElement, rect);
        pickerHost.classList.add('is-open');
        setNativeOverlayHidden(true);
        const center = pickerPills.find((entry) => entry.role === 'center');
        highlightPicker(center || null);
      });
    });
  }

  function hitTestPicker(clientX, clientY) {
    for (let i = 0; i < pickerPills.length; i++) {
      const item = pickerPills[i];
      const rect = item.el.getBoundingClientRect();
      if (isPointOverRect(clientX, clientY, rect, 8)) {
        return item;
      }
    }
    return null;
  }

  function highlightPicker(item) {
    pickerPills.forEach((entry) => {
      entry.el.classList.toggle('is-hovered', entry === item);
    });
  }

  function showHint(pillEl, isCurrentlyFast) {
    if (!pillEl || pickerOpen) return;
    if (!hintEl) {
      hintEl = document.createElement('div');
      hintEl.className = 'yt-speed-lock-hint';
    }
    if (isCurrentlyFast) {
      hintEl.innerHTML = `${LOCK_ICON_SVG}<span>1x</span>`;
    } else {
      hintEl.innerHTML = `${LOCK_ICON_SVG}<span>${formatSpeedLabel(getTargetSpeed())}</span>`;
    }
    const container = pillEl.closest('.ytp-speedmaster-overlay') || pillEl;
    if (!container.contains(hintEl)) {
      container.appendChild(hintEl);
    }
    hintEl.classList.add('visible');
  }

  function hideHint() {
    if (hintEl) {
      hintEl.classList.remove('visible');
    }
  }

  function showSpeedToast(player, rate) {
    const p = player || activePlayer || document.getElementById('movie_player') || document.body;
    if (!p) return;
    if (toastTimer) clearTimeout(toastTimer);
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'yt-speed-toast';
    }
    toastEl.innerHTML = `<span class="yt-speed-toast-icon">${LOCK_ICON_SVG}</span><span>${formatSpeedLabel(rate)}</span>`;
    if (!p.contains(toastEl)) {
      p.appendChild(toastEl);
    }
    toastEl.classList.remove('show');
    void toastEl.offsetWidth;
    toastEl.classList.add('show');
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
    }, 1800);
  }

  function applyPlaybackRate(targetRate) {
    dispatchToPage('yt-speed-sync-player', { rate: targetRate });

    const video = activeVideo || document.querySelector('video');
    if (video) {
      try {
        video.playbackRate = targetRate;
      } catch (e) {}
    }

    const reAssertRate = () => {
      if (video && Math.abs(video.playbackRate - targetRate) > 0.01) {
        video.playbackRate = targetRate;
      }
      dispatchToPage('yt-speed-sync-player', { rate: targetRate });
    };

    requestAnimationFrame(reAssertRate);
    setTimeout(reAssertRate, 50);
    setTimeout(reAssertRate, 150);
    setTimeout(reAssertRate, 300);
  }

  function armClickSuppression() {
    suppressNextClick = true;
    if (suppressClickTimer) clearTimeout(suppressClickTimer);
    suppressClickTimer = setTimeout(() => {
      suppressNextClick = false;
      suppressClickTimer = null;
    }, 200);
  }

  function stopPillSync() {
    if (pillSyncInterval) {
      clearInterval(pillSyncInterval);
      pillSyncInterval = null;
    }
  }

  function teardownSpeedGesture() {
    stopPillSync();
    isPointerDown = false;
    isHoveringBadge = false;
    hoveredPick = null;
    if (currentTargetEl) {
      currentTargetEl.classList.remove('yt-speed-hovered', 'yt-speed-pill-highlight');
      currentTargetEl = null;
    }
    hideHint();
    destroyPicker();
    frozenCenterRate = null;
    syncPillLabel(null);
  }

  function onPointerDown(e) {
    if (!isSpeedEnabled()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.button !== undefined && e.button !== 0) return;
    if (e.altKey) return;
    if (isInteractiveElement(e.target)) return;

    const { player, video } = resolvePlayer();
    if (!player) return;

    if (isPointerDown) return;
    if (pickerHost) destroyPicker();

    activePlayer = player;
    activeVideo = video;
    activePointerId = e.pointerId !== undefined ? e.pointerId : null;
    isPointerDown = true;
    isHoveringBadge = false;
    hoveredPick = null;
    currentTargetEl = null;
    pointerDownTime = performance.now();

    basePlaybackRate = (activeVideo && Number.isFinite(activeVideo.playbackRate) && activeVideo.playbackRate > 0)
      ? activeVideo.playbackRate
      : 1.0;
    frozenCenterRate = isNormalRate(basePlaybackRate) ? getTargetSpeed() : 1;

    stopPillSync();
    pillSyncInterval = setInterval(() => {
      if (!isPointerDown) {
        stopPillSync();
        return;
      }
      if (!pickerOpen) syncPillLabel(desiredPillLabel());
    }, 50);
    syncPillLabel(desiredPillLabel());
  }

  function onPointerMove(e) {
    if (!isPointerDown || !isSpeedEnabled()) return;
    if (document.body.classList.contains('yt-vol-dragging-active') ||
        document.documentElement.hasAttribute('data-yt-vol-just-dragged')) {
      teardownSpeedGesture();
      return;
    }
    if (activePointerId !== null && e.pointerId !== undefined && e.pointerId !== activePointerId) return;

    if (pickerClosing) return;
    if (!pickerOpen) syncPillLabel(desiredPillLabel());

    if (pickerOpen) {
      const hit = hitTestPicker(e.clientX, e.clientY);
      if (hit) {
        isHoveringBadge = true;
        hoveredPick = hit.role === 'center' ? 'center' : hit.rate;
        highlightPicker(hit);
        return;
      }
      isHoveringBadge = false;
      hoveredPick = null;
      highlightPicker(null);
      return;
    }

    const pillInfo = getSpeedmasterPillRect(activePlayer);
    if (!pillInfo) {
      if (isHoveringBadge) {
        isHoveringBadge = false;
        hoveredPick = null;
        clearDwellTimer();
        if (currentTargetEl) {
          currentTargetEl.classList.remove('yt-speed-hovered', 'yt-speed-pill-highlight');
        }
        hideHint();
      }
      return;
    }

    const over = isPointOverPill(e.clientX, e.clientY, pillInfo);
    if (over) {
      if (!isHoveringBadge) {
        isHoveringBadge = true;
        hoveredPick = 'center';
        currentTargetEl = pillInfo.el;
        if (currentTargetEl) {
          currentTargetEl.classList.add('yt-speed-hovered', 'yt-speed-pill-highlight');
        }
        showHint(pillInfo.el, !isNormalRate(basePlaybackRate));
        clearDwellTimer();
        dwellTimer = setTimeout(() => {
          dwellTimer = null;
          openPicker(refreshPillInfo(pillInfo));
        }, DWELL_MS);
      }
    } else {
      if (isHoveringBadge) {
        isHoveringBadge = false;
        hoveredPick = null;
        clearDwellTimer();
        if (currentTargetEl) {
          currentTargetEl.classList.remove('yt-speed-hovered', 'yt-speed-pill-highlight');
          currentTargetEl = null;
        }
        hideHint();
      }
    }
  }

  function onPointerUp(e) {
    if (!isPointerDown) return;
    if (activePointerId !== null && e.pointerId !== undefined && e.pointerId !== activePointerId) return;

    stopPillSync();
    clearDwellTimer();

    const wasHovering = isHoveringBadge;
    const pick = hoveredPick;
    isPointerDown = false;
    isHoveringBadge = false;
    hoveredPick = null;
    activePointerId = null;

    if (currentTargetEl) {
      currentTargetEl.classList.remove('yt-speed-hovered', 'yt-speed-pill-highlight');
      currentTargetEl = null;
    }
    hideHint();
    if (pickerClosing) {
      /* let the reverse animation finish */
    } else if (pickerOpen && !wasHovering) {
      closePickerAnimated();
    } else {
      destroyPicker();
    }
    syncPillLabel(null);

    const volumeDragConsumed = document.body.classList.contains('yt-vol-dragging-active') ||
      document.documentElement.hasAttribute('data-yt-vol-just-dragged');

    if (wasHovering && isSpeedEnabled() && !volumeDragConsumed) {
      armClickSuppression();

      if (typeof pick === 'number') {
        applyPlaybackRate(pick);
        showSpeedToast(activePlayer, pick);
      } else if (!isNormalRate(basePlaybackRate)) {
        applyPlaybackRate(1.0);
        showSpeedToast(activePlayer, 1.0);
      } else {
        const target = getTargetSpeed();
        applyPlaybackRate(target);
        showSpeedToast(activePlayer, target);
      }

      if (e.cancelable) {
        e.preventDefault();
      }
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
  }

  function onClickCapture(e) {
    if (suppressNextClick) {
      e.stopPropagation();
      e.stopImmediatePropagation();
      e.preventDefault();
      suppressNextClick = false;
      if (suppressClickTimer) {
        clearTimeout(suppressClickTimer);
        suppressClickTimer = null;
      }
    }
  }

  function init() {
    loadConfig();

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerUp, true);
    window.addEventListener('click', onClickCapture, true);

    window.addEventListener('yt-navigate-finish', () => {
      teardownSpeedGesture();
      const { player, video } = resolvePlayer();
      activePlayer = player;
      activeVideo = video;
    });
  }

  init();
})();
