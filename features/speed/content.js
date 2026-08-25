// 2x Speed Lock content script: hold left-click and release over the 2x icon to lock or reset playback speed.

(function () {
  'use strict';

  const STORAGE_PREFIX = 'speed.';
  const MASTER_KEY = 'toolkit.masterEnabled';

  const config = {
    enabled: true,
    targetSpeed: 2.0
  };
  let masterEnabled = true;

  function isSpeedEnabled() {
    return masterEnabled && config.enabled;
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

  let isPointerDown = false;
  let isHoveringBadge = false;
  let pointerDownTime = 0;
  let activePointerId = null;
  let basePlaybackRate = 1.0;
  let currentTargetEl = null;

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
    try {
      window.postMessage({ source: BRIDGE_SOURCE, name: name, detail: payload }, '*');
    } catch (e) {}
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
      });
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
    return isNormalRate(basePlaybackRate)
      ? formatSpeedLabel(getTargetSpeed())
      : '1x';
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

  function getSpeedmasterPillRect(player) {
    const p = player || activePlayer || document.getElementById('movie_player') || document.body;
    if (!p) return null;

    const overlay = p.querySelector('.ytp-speedmaster-overlay, [class*="speedmaster-overlay"]');

    // Prefer the full capsule (text + icons), not the inner "1.5x" text node.
    const containerSelectors = [
      '.ytp-speedmaster-pill',
      '[class*="speedmaster-pill"]',
      '.ytp-speedmaster-overlay-content',
      '.ytp-speedmaster-overlay > div'
    ];

    for (const sel of containerSelectors) {
      const el = p.querySelector(sel);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (isCompactPillRect(rect)) {
        return { el, rect };
      }
    }

    if (overlay) {
      let best = null;
      const children = overlay.querySelectorAll('*');
      for (const child of children) {
        if (!child.textContent || !SPEED_TEXT_RE.test(child.textContent)) continue;
        const hasIcon = !!child.querySelector('svg, img');
        const rect = child.getBoundingClientRect();
        if (!isCompactPillRect(rect)) continue;
        if (hasIcon) {
          if (!best || rect.width > best.rect.width) {
            best = { el: child, rect };
          }
        } else if (!best) {
          best = { el: child, rect };
        }
      }
      if (best) return best;

      const oRect = overlay.getBoundingClientRect();
      if (isCompactPillRect(oRect)) {
        return { el: overlay, rect: oRect };
      }
    }

    // Fallback: YouTube's top-center 2x pill region
    const isSpeedmasterActive = p.classList.contains('ytp-speedmaster-active') ||
      (overlay && window.getComputedStyle(overlay).display !== 'none');

    if (isSpeedmasterActive) {
      const pRect = p.getBoundingClientRect();
      const centerX = pRect.left + pRect.width / 2;
      const top = pRect.top + 10;
      const bottom = pRect.top + 60;
      const left = centerX - 60;
      const right = centerX + 60;
      return {
        el: overlay || p,
        rect: { left, right, top, bottom, width: 120, height: 50 }
      };
    }

    return null;
  }

  function isPointOverPill(clientX, clientY, pillInfo) {
    if (!pillInfo || !pillInfo.rect) return false;
    const { rect } = pillInfo;

    const pad = 10;
    return (
      clientX >= rect.left - pad &&
      clientX <= rect.right + pad &&
      clientY >= rect.top - pad &&
      clientY <= rect.bottom + pad
    );
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

  function showHint(pillEl, isCurrentlyFast) {
    if (!pillEl) return;
    if (!hintEl) {
      hintEl = document.createElement('div');
      hintEl.className = 'yt-speed-lock-hint';
    }
    if (isCurrentlyFast) {
      hintEl.innerHTML = `
        <svg viewBox="0 0 24 24"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>
        <span>Release to reset 1x</span>
      `;
    } else {
      const speedLabel = formatSpeedLabel(getTargetSpeed());
      hintEl.innerHTML = `
        <svg viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
        <span>Release to lock ${speedLabel}</span>
      `;
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

  function showSpeedToast(player, message, iconType) {
    const p = player || activePlayer || document.getElementById('movie_player') || document.body;
    if (!p) return;
    if (toastTimer) clearTimeout(toastTimer);
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'yt-speed-toast';
    }
    const iconSvg = iconType === 'lock'
      ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>`
      : `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>`;

    toastEl.innerHTML = `<span class="yt-speed-toast-icon">${iconSvg}</span><span>${message}</span>`;
    if (!p.contains(toastEl)) {
      p.appendChild(toastEl);
    }
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

  function onPointerDown(e) {
    if (!isSpeedEnabled()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.button !== undefined && e.button !== 0) return;
    if (isInteractiveElement(e.target)) return;

    const { player, video } = resolvePlayer();
    if (!player) return;

    if (isPointerDown) return;

    activePlayer = player;
    activeVideo = video;
    activePointerId = e.pointerId !== undefined ? e.pointerId : null;
    isPointerDown = true;
    isHoveringBadge = false;
    currentTargetEl = null;
    pointerDownTime = performance.now();

    basePlaybackRate = (activeVideo && Number.isFinite(activeVideo.playbackRate) && activeVideo.playbackRate > 0)
      ? activeVideo.playbackRate
      : 1.0;

    if (pillSyncInterval) clearInterval(pillSyncInterval);
    pillSyncInterval = setInterval(() => {
      if (!isPointerDown) {
        clearInterval(pillSyncInterval);
        pillSyncInterval = null;
        return;
      }
      syncPillLabel(desiredPillLabel());
    }, 50);
    syncPillLabel(desiredPillLabel());
  }

  function onPointerMove(e) {
    if (!isPointerDown || !isSpeedEnabled()) return;
    if (document.body.classList.contains('yt-vol-dragging-active') ||
        document.documentElement.hasAttribute('data-yt-vol-just-dragged')) {
      if (pillSyncInterval) {
        clearInterval(pillSyncInterval);
        pillSyncInterval = null;
      }
      isPointerDown = false;
      isHoveringBadge = false;
      return;
    }
    if (activePointerId !== null && e.pointerId !== undefined && e.pointerId !== activePointerId) return;

    syncPillLabel(desiredPillLabel());

    const pillInfo = getSpeedmasterPillRect(activePlayer);
    if (!pillInfo) {
      if (isHoveringBadge) {
        isHoveringBadge = false;
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
        currentTargetEl = pillInfo.el;
        if (currentTargetEl) {
          currentTargetEl.classList.add('yt-speed-hovered', 'yt-speed-pill-highlight');
        }
        showHint(pillInfo.el, !isNormalRate(basePlaybackRate));
      }
    } else {
      if (isHoveringBadge) {
        isHoveringBadge = false;
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

    if (pillSyncInterval) {
      clearInterval(pillSyncInterval);
      pillSyncInterval = null;
    }

    const wasHovering = isHoveringBadge;
    isPointerDown = false;
    isHoveringBadge = false;
    activePointerId = null;

    if (currentTargetEl) {
      currentTargetEl.classList.remove('yt-speed-hovered', 'yt-speed-pill-highlight');
      currentTargetEl = null;
    }
    hideHint();
    syncPillLabel(null);

    const volumeDragConsumed = document.body.classList.contains('yt-vol-dragging-active') ||
      document.documentElement.hasAttribute('data-yt-vol-just-dragged');

    if (wasHovering && isSpeedEnabled() && !volumeDragConsumed) {
      armClickSuppression();

      if (!isNormalRate(basePlaybackRate)) {
        applyPlaybackRate(1.0);
        showSpeedToast(activePlayer, 'Speed reset to 1x (Normal)', 'reset');
      } else {
        const target = getTargetSpeed();
        applyPlaybackRate(target);
        showSpeedToast(activePlayer, `⚡ ${formatSpeedLabel(target)} Speed Locked`, 'lock');
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
      const { player, video } = resolvePlayer();
      activePlayer = player;
      activeVideo = video;
    });
  }

  init();
})();
