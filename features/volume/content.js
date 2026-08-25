// Volume drag gesture content script and native UI synchronizer.

(function () {
  'use strict';

  const VOLUME_STORAGE_KEYS = new Set([
    'yt_extension_saved_volume',
    'yt_extension_saved_muted',
    'yt_tab_volume',
    'yt_tab_muted',
    'yt-player-volume'
  ]);

  // Prevent cross-tab storage broadcast
  window.addEventListener('storage', (e) => {
    if (e.key && VOLUME_STORAGE_KEYS.has(e.key)) {
      e.stopImmediatePropagation();
    }
  }, true);

  const STORAGE_PREFIX = 'volume.';
  const MASTER_KEY = 'toolkit.masterEnabled';

  const config = {
    enabled: true,
    dragTrigger: 'left', // 'left', 'right', 'shift-left', 'alt-left'
    sensitivity: 60,     // 60% of player width for 0% to 100% volume
    hudStyle: 'wave',    // 'wave' or 'minimal'
    followCursor: true   // HUD pill follows the mouse while dragging
  };
  let masterEnabled = true;

  function isVolumeEnabled() {
    return masterEnabled && config.enabled;
  }

  let hud = null;
  let activePlayer = null;
  let activeVideo = null;
  let isPointerDown = false;
  let isDragging = false;
  let fastForwardLocked = false;
  let activePointerId = null;
  let captureEl = null;

  let pointerDownTime = 0;
  let startX = 0;
  let startY = 0;
  let hudAnchorX = 0;
  let hudAnchorY = 0;
  let initialVolume = 1.0;
  let savedPlaybackRate = 1.0;
  let cachedPlayerRect = null;
  let cachedSpanWidth = 600;
  let cachedSliderHandleMax = 40;

  let tabDesiredVolume = null;
  let tabDesiredMuted = false;

  let rAFScheduled = false;
  let pendingVolume = 1.0;
  let pendingCursorX = 0;
  let pendingCursorY = 0;
  let lastSyncedIntVol = null;
  let lastSyncedMuted = null;
  let lastNativeSliderKey = '';
  let playerObserver = null;
  let isNativeSliderInteracting = false;

  let suppressNextClick = false;
  let suppressNextContextMenu = false;
  let suppressClickTimer = null;
  let suppressContextTimer = null;
  let hudEnsureTimer = null;
  let userVolumeHoldUntil = 0;
  let pendingEarlyHold = null;
  let suppressVolumePointerId = null;
  let wasPausedAtGestureStart = false;
  let playGuardVideo = null;
  let pauseAssertTimers = [];
  let justDraggedClearTimer = null;
  let playerLeaveBound = null;
  let persistTimer = null;

  const NATIVE_VOLUME_SELECTOR = '.ytp-volume-control, .ytp-volume-panel, .ytp-volume-slider, .ytp-mute-button, .ytp-volume-area';

  const DRAG_THRESHOLD_PX = 6;
  const FAST_FORWARD_THRESHOLD_MS = 400;
  const DEFAULT_SLIDER_HANDLE_MAX = 40;
  const HUD_HIDE_DELAY_MS = 450;

  function isInlinePreview(el) {
    if (!el) return false;
    try {
      if (el.closest) {
        if (el.closest('ytd-inline-preview-renderer, #inline-preview-player, .inline-preview-player, [is-inline-preview]')) {
          return true;
        }
      }
      if (el.id === 'inline-preview-player' || (el.classList && el.classList.contains('inline-preview-player'))) {
        return true;
      }
    } catch (e) {}
    return false;
  }

  function toFiniteVolume(value, fallback = null) {
    const n = typeof value === 'number' ? value : parseFloat(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(1, n));
  }

  try {
    const extSaved = localStorage.getItem('yt_extension_saved_volume');
    if (extSaved !== null) {
      tabDesiredVolume = toFiniteVolume(extSaved, null);
      tabDesiredMuted = localStorage.getItem('yt_extension_saved_muted') === 'true';
    } else {
      const savedTabVol = sessionStorage.getItem('yt_tab_volume');
      if (savedTabVol !== null) {
        tabDesiredVolume = toFiniteVolume(savedTabVol, null);
        tabDesiredMuted = sessionStorage.getItem('yt_tab_muted') === 'true';
      } else {
        const ytStorage = localStorage.getItem('yt-player-volume');
        if (ytStorage) {
          const parsed = JSON.parse(ytStorage);
          const innerData = typeof parsed.data === 'string' ? JSON.parse(parsed.data) : parsed.data;
          if (innerData && typeof innerData.volume === 'number' && Number.isFinite(innerData.volume)) {
            tabDesiredVolume = toFiniteVolume(innerData.volume / 100, null);
            tabDesiredMuted = !!innerData.muted;
          }
        }
      }
    }
  } catch (e) {}

  function noteUserVolumeChange() {
    userVolumeHoldUntil = performance.now() + 2500;
  }

  function persistVolume(volumeFraction, isMuted) {
    const clamped = toFiniteVolume(volumeFraction, null);
    if (clamped === null) return;

    const muted = !!(isMuted || Math.round(clamped * 100) === 0);

    tabDesiredVolume = clamped;
    tabDesiredMuted = muted;

    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      try {
        localStorage.setItem('yt_extension_saved_volume', String(clamped));
        localStorage.setItem('yt_extension_saved_muted', String(muted));
        sessionStorage.setItem('yt_tab_volume', String(clamped));
        sessionStorage.setItem('yt_tab_muted', String(muted));
      } catch (e) {}
    }, 250);
  }

  if (tabDesiredVolume !== null) {
    persistVolume(tabDesiredVolume, tabDesiredMuted);
  }

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

  let outMsgSeq = 0;
  function dispatchToPage(name, detail) {
    const payload = detail && typeof detail === 'object' ? { ...detail } : {};
    payload.seq = ++outMsgSeq;
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

  function syncWithMainWorldPlayer(intVol, isMuted) {
    if (!Number.isFinite(intVol)) return;
    if (lastSyncedIntVol === intVol && lastSyncedMuted === isMuted) return;
    lastSyncedIntVol = intVol;
    lastSyncedMuted = isMuted;
    dispatchToPage('yt-vol-sync-player', {
      volume: intVol,
      isMuted: isMuted
    });
  }

  let lastInPlayerVolSeq = 0;
  function onPlayerVolumeChangedDetail(detail) {
    if (!detail || isDragging) return;

    if (typeof detail.seq === 'number') {
      if (detail.seq <= lastInPlayerVolSeq) return;
      lastInPlayerVolSeq = detail.seq;
    }

    const { volume, isMuted } = detail;
    if (typeof volume === 'number' && Number.isFinite(volume)) {
      const volFraction = toFiniteVolume(volume / 100, null);
      if (volFraction === null) return;

      noteUserVolumeChange();

      const storeFrac = (!!isMuted && volFraction === 0 && tabDesiredVolume !== null && tabDesiredVolume > 0.01)
        ? tabDesiredVolume
        : volFraction;

      tabDesiredVolume = storeFrac;
      tabDesiredMuted = !!isMuted;
      lastSyncedIntVol = Math.round(storeFrac * 100);
      lastSyncedMuted = !!isMuted;

      persistVolume(storeFrac, !!isMuted);
    }
  }

  window.addEventListener('yt-player-volume-changed', (e) => {
    onPlayerVolumeChangedDetail(e && e.detail);
  });

  window.addEventListener('message', (e) => {
    if (!e || e.source !== window || !e.data || e.data.source !== BRIDGE_SOURCE) return;
    if (e.data.name !== 'yt-player-volume-changed') return;
    onPlayerVolumeChangedDetail(e.data.detail);
  });

  function applyStorageItems(items) {
    if (!items) return;
    if (items[MASTER_KEY] !== undefined) {
      masterEnabled = items[MASTER_KEY] !== false;
    }
    for (const key of Object.keys(config)) {
      const prefixed = STORAGE_PREFIX + key;
      if (items[prefixed] !== undefined) {
        config[key] = items[prefixed];
      }
    }
    if (hud) {
      hud.setStyle(config.hudStyle);
    }
  }

  function loadConfig() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      const defaults = { [MASTER_KEY]: true };
      for (const [key, value] of Object.entries(config)) {
        defaults[STORAGE_PREFIX + key] = value;
      }
      chrome.storage.sync.get(defaults, (items) => {
        applyStorageItems(items);
      });
    }
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      if (changes[MASTER_KEY] && changes[MASTER_KEY].newValue !== undefined) {
        masterEnabled = changes[MASTER_KEY].newValue !== false;
      }
      for (const key of Object.keys(config)) {
        const prefixed = STORAGE_PREFIX + key;
        if (changes[prefixed] && changes[prefixed].newValue !== undefined) {
          config[key] = changes[prefixed].newValue;
        }
      }
      if (hud) {
        hud.setStyle(config.hudStyle);
      }
      if (!isVolumeEnabled() && (isDragging || isPointerDown)) {
        finishGesture(null);
      }
    });
  }

  const PLAYER_SELECTOR = '#movie_player, .html5-video-player, ytd-player, #ytd-player, #player-container-outer, #player';

  function resolvePlayerRoot(el) {
    if (!el) return null;
    if (el.id === 'movie_player' || (el.classList && el.classList.contains('html5-video-player'))) {
      return el;
    }
    return el.querySelector('#movie_player, .html5-video-player') || el;
  }

  function getPlayerElements() {
    const moviePlayer = document.getElementById('movie_player');
    if (moviePlayer && !isInlinePreview(moviePlayer)) {
      const video = moviePlayer.querySelector('video');
      return { player: moviePlayer, video: video || null };
    }

    const primaryContainer = document.querySelector('ytd-watch-flexy, ytd-watch-grid, #shorts-player, ytd-shorts, ytd-miniplayer');
    if (primaryContainer) {
      const player = resolvePlayerRoot(
        primaryContainer.querySelector('.html5-video-player') ||
        primaryContainer.querySelector('#player, #ytd-player, ytd-player, #player-container-outer, #player-container') ||
        primaryContainer
      );
      const video = primaryContainer.querySelector('video');
      if (player && !isInlinePreview(player)) {
        return { player, video: video || null };
      }
    }

    const player = document.querySelector('.html5-video-player:not(#inline-preview-player), #player:not([hidden]), #ytd-player, ytd-player');
    if (player && !isInlinePreview(player)) {
      const root = resolvePlayerRoot(player);
      const video = root.querySelector('video');
      return { player: root, video: video || null };
    }

    return { player: null, video: null };
  }

  function getPlayerFromTarget(target) {
    if (target && target.closest) {
      try {
        const hit = target.closest(PLAYER_SELECTOR);
        if (hit && !isInlinePreview(hit)) {
          const player = resolvePlayerRoot(hit);
          if (player && !isInlinePreview(player)) {
            const video = player.querySelector ? player.querySelector('video') : null;
            return { player, video: video || null };
          }
        }
      } catch (e) {}
    }
    return getPlayerElements();
  }

  function disableNativeVideoDrag(video) {
    if (!video) return;
    try {
      video.draggable = false;
      video.setAttribute('draggable', 'false');
    } catch (e) {}
  }

  function releasePointerCapture() {
    if (captureEl && activePointerId !== null) {
      try {
        if (!captureEl.hasPointerCapture || captureEl.hasPointerCapture(activePointerId)) {
          captureEl.releasePointerCapture(activePointerId);
        }
      } catch (e) {}
    }
    captureEl = null;
  }

  function setDraggingClass(on) {
    document.body.classList.toggle('yt-vol-dragging-active', on);
    if (activePlayer) activePlayer.classList.toggle('yt-vol-dragging-active', on);
  }

  function isInsidePlayerRect(clientX, clientY, playerRect) {
    if (!playerRect || playerRect.width === 0 || playerRect.height === 0) return false;
    return clientX >= playerRect.left &&
           clientX <= playerRect.right &&
           clientY >= playerRect.top &&
           clientY <= playerRect.bottom;
  }

  function getLivePlayerRect() {
    if (activePlayer) {
      try {
        const rect = activePlayer.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) return rect;
      } catch (e) {}
    }
    return cachedPlayerRect;
  }

  function hideHudIfPointerOutsidePlayer(clientX, clientY) {
    if (isDragging || isPointerDown) return;
    if (!hud || typeof hud.isShowing !== 'function' || !hud.isShowing()) return;
    if (typeof clientX !== 'number' || typeof clientY !== 'number') {
      hud.hide(0);
      return;
    }
    if (!isInsidePlayerRect(clientX, clientY, getLivePlayerRect())) {
      hud.hide(0);
    }
  }

  function onPlayerPointerLeave() {
    if (isDragging || isPointerDown) return;
    if (hud) hud.hide(0);
  }

  function attachPlayerLeaveWatcher(player) {
    if (playerLeaveBound === player) return;
    if (playerLeaveBound) {
      playerLeaveBound.removeEventListener('pointerleave', onPlayerPointerLeave);
      playerLeaveBound.removeEventListener('mouseleave', onPlayerPointerLeave);
    }
    playerLeaveBound = player || null;
    if (playerLeaveBound) {
      playerLeaveBound.addEventListener('pointerleave', onPlayerPointerLeave);
      playerLeaveBound.addEventListener('mouseleave', onPlayerPointerLeave);
    }
  }

  function tryActivatePendingEarlyHold(resolvedPlayer, resolvedVideo) {
    if (!pendingEarlyHold || isPointerDown || isDragging) return;
    if (!isVolumeEnabled()) {
      pendingEarlyHold = null;
      return;
    }

    const hold = pendingEarlyHold;
    const p = resolvedPlayer || activePlayer || getPlayerElements().player;
    if (!p) return;
    const v = resolvedVideo || activeVideo || getPlayerElements().video;

    const rect = p.getBoundingClientRect();
    const isTargetInPlayer = hold.target && p.contains && p.contains(hold.target);
    const isTargetInWatchArea = hold.target && hold.target.closest && !!hold.target.closest('ytd-watch-flexy, ytd-watch-grid, #player-container-outer, #player-container, #player, ytd-player, #movie_player');
    const isCoordInPlayer = isInsidePlayerRect(hold.clientX, hold.clientY, rect);

    if (isCoordInPlayer || isTargetInPlayer || isTargetInWatchArea) {
      pendingEarlyHold = null;
      startPointerGesture(p, v, { pointerId: hold.pointerId, target: hold.target, clientX: hold.clientX, clientY: hold.clientY }, true, hold.clientX, hold.clientY, hold.time);
    }
  }

  function ensureHUD() {
    const { player, video } = getPlayerElements();
    if (!player) {
      if (activeVideo) {
        activeVideo.removeEventListener('ratechange', onRateChange);
        detachPlayGuards();
        activeVideo = null;
      }
      activePlayer = null;
      return false;
    }

    if (video && activeVideo !== video) {
      if (activeVideo) {
        activeVideo.removeEventListener('ratechange', onRateChange);
      }
      activeVideo = video;
      disableNativeVideoDrag(activeVideo);
      activeVideo.addEventListener('ratechange', onRateChange, { passive: true });
      if (isPointerDown || isDragging) {
        attachPlayGuards(activeVideo);
      }

      if (tabDesiredVolume !== null) {
        const intVol = Math.round(tabDesiredVolume * 100);
        syncWithMainWorldPlayer(intVol, tabDesiredMuted);
      }
    }

    activePlayer = player;
    attachPlayerLeaveWatcher(player);
    setupNativeSliderWatchers();

    if (!hud) {
      if (window.VolumeVisualizerHUD) {
        hud = new window.VolumeVisualizerHUD();
        hud.setStyle(config.hudStyle);
        hud.mount(player);
      }
    } else {
      hud.mount(player);
    }

    tryActivatePendingEarlyHold(player, video);

    return true;
  }

  function scheduleEnsureHUD() {
    if (hudEnsureTimer != null) return;
    const delay = (activePlayer && activeVideo) ? 200 : 0;
    hudEnsureTimer = setTimeout(() => {
      hudEnsureTimer = null;
      ensureHUD();
    }, delay);
  }

  function clearPauseAssertTimers() {
    for (let i = 0; i < pauseAssertTimers.length; i++) {
      clearTimeout(pauseAssertTimers[i]);
    }
    pauseAssertTimers = [];
  }

  function markVolumeJustDragged() {
    try {
      document.documentElement.setAttribute('data-yt-vol-just-dragged', '1');
    } catch (e) {}
    if (justDraggedClearTimer) clearTimeout(justDraggedClearTimer);
    justDraggedClearTimer = setTimeout(() => {
      justDraggedClearTimer = null;
      try {
        document.documentElement.removeAttribute('data-yt-vol-just-dragged');
      } catch (e) {}
    }, 300);
  }

  function restoreSavedPlaybackRate() {
    if (!Number.isFinite(savedPlaybackRate) || savedPlaybackRate <= 0) return;
    if (activeVideo) {
      try {
        if (Math.abs(activeVideo.playbackRate - savedPlaybackRate) > 0.01) {
          activeVideo.playbackRate = savedPlaybackRate;
          dispatchToPage('yt-speed-sync-player', { rate: savedPlaybackRate });
        }
      } catch (e) {}
    }
  }

  function enforcePausedIfNeeded() {
    if (!wasPausedAtGestureStart || !activeVideo) return;
    if (!activeVideo.paused) {
      try {
        activeVideo.pause();
      } catch (e) {}
    }
  }

  function publishVolumeGestureState(active, suppressPlay) {
    dispatchToPage('yt-vol-gesture-state', {
      active: !!active,
      suppressPlay: !!suppressPlay,
      savedPlaybackRate: savedPlaybackRate
    });
  }

  function onGuardedPlay() {
    if (!isDragging) return;
    restoreSavedPlaybackRate();
    enforcePausedIfNeeded();
    cancelYouTubeSpeedmaster();
  }

  function detachPlayGuards() {
    if (!playGuardVideo) return;
    playGuardVideo.removeEventListener('play', onGuardedPlay);
    playGuardVideo.removeEventListener('playing', onGuardedPlay);
    playGuardVideo = null;
  }

  function attachPlayGuards(video) {
    if (playGuardVideo === video) return;
    detachPlayGuards();
    if (!video) return;
    playGuardVideo = video;
    video.addEventListener('play', onGuardedPlay);
    video.addEventListener('playing', onGuardedPlay);
  }

  function cancelYouTubeSpeedmaster() {
    restoreSavedPlaybackRate();
    if (activePlayer) {
      const overlay = activePlayer.querySelector('.ytp-speedmaster-overlay');
      if (overlay) {
        overlay.style.display = 'none';
      }
      activePlayer.classList.remove('ytp-speedmaster-active');
    }
    enforcePausedIfNeeded();
  }

  function onRateChange() {
    if (isDragging && activeVideo && Number.isFinite(savedPlaybackRate)) {
      if (Math.abs(activeVideo.playbackRate - savedPlaybackRate) > 0.01) {
        restoreSavedPlaybackRate();
        cancelYouTubeSpeedmaster();
      }
      enforcePausedIfNeeded();
    }
  }

  function isVideoSurfaceTarget(target) {
    if (!target || !target.closest) return false;
    return !!target.closest(
      'video, .html5-video-container, .html5-main-video, .ytp-cued-thumbnail-overlay, .ytp-large-play-button, .ytp-spinner, .ytp-spinner-container, .ytp-offline-slate, .ytp-player-content'
    );
  }

  function isInteractiveElement(target) {
    if (!target) return false;

    if (isVideoSurfaceTarget(target) && !target.closest('.ytp-chrome-bottom, .ytp-chrome-top, .ytp-popup, .ytp-settings-menu, .ytp-contextmenu, .ytp-volume-panel, .ytp-volume-slider')) {
      return false;
    }

    const excludedSelectors = [
      '.ytp-chrome-bottom',
      '.ytp-chrome-top',
      '.ytp-popup',
      '.ytp-settings-menu',
      '.ytp-contextmenu',
      '.ytp-caption-window-container',
      '.ytp-cards-teaser',
      '.ytp-ad-overlay-container',
      '.ytp-suggested-action',
      '.ytp-subtitles-player-content',
      '.ytp-live-badge',
      '.ytp-live-sync-button',
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

  function isPlayerControlTarget(target) {
    if (!target || !target.closest) return false;
    return !!target.closest(
      '.ytp-chrome-bottom, .ytp-chrome-top, .ytp-chrome-controls, .ytp-progress-bar, .ytp-progress-bar-container, .ytp-scrubber-container, .ytp-scrubber-button, .ytp-chapter-hover-container, .ytp-timed-markers-container, .ytp-tooltip, .ytp-preview, .ytp-gradient-bottom, .ytp-gradient-top'
    );
  }

  function markVolumeGestureSuppressed(pointerId) {
    suppressVolumePointerId = pointerId;
  }

  function isVolumeGestureSuppressed(e) {
    return suppressVolumePointerId !== null && e.pointerId === suppressVolumePointerId;
  }

  function clearVolumeGestureSuppressed(e) {
    if (suppressVolumePointerId === null) return;
    if (e && e.pointerId !== undefined && e.pointerId !== suppressVolumePointerId) return;
    suppressVolumePointerId = null;
  }

  function matchesTrigger(e) {
    const isDown = e.type === 'pointerdown' || e.type === 'mousedown';
    const hasButton = (btn) => isDown ? e.button === btn : (btn === 0 ? (e.buttons & 1) !== 0 : btn === 2 ? (e.buttons & 2) !== 0 : false);

    switch (config.dragTrigger) {
      case 'left':
        return hasButton(0) && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
      case 'right':
        return hasButton(2);
      case 'shift-left':
        return hasButton(0) && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
      case 'alt-left':
        return hasButton(0) && e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey;
      default:
        return hasButton(0) && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
    }
  }

  function updateCachedSliderHandleMax() {
    if (!activePlayer) return;
    const slider = activePlayer.querySelector('.ytp-volume-slider');
    if (!slider) return;
    const handle = slider.querySelector('.ytp-volume-slider-handle');
    const sliderWidth = slider.clientWidth || slider.offsetWidth;
    const handleWidth = handle ? (handle.offsetWidth || 12) : 12;
    if (sliderWidth && sliderWidth >= 40) {
      cachedSliderHandleMax = Math.max(DEFAULT_SLIDER_HANDLE_MAX, sliderWidth - handleWidth);
    }
  }

  function getSliderHandleMax() {
    return cachedSliderHandleMax || DEFAULT_SLIDER_HANDLE_MAX;
  }

  function syncNativeSliderUI(volumeFraction, isMuted, options) {
    if (!activePlayer) return;

    const clamped = toFiniteVolume(volumeFraction, 0);
    const percent = Math.round(clamped * 100);
    const effectiveMuted = isMuted || percent === 0;
    const skipHandle = options && options.skipHandle;

    const panel = activePlayer.querySelector('.ytp-volume-panel');
    if (panel) {
      panel.setAttribute('aria-valuenow', effectiveMuted ? '0' : String(percent));
      panel.setAttribute('aria-valuetext', effectiveMuted ? '0% volume' : `${percent}% volume`);
    }

    const slider = activePlayer.querySelector('.ytp-volume-slider');
    if (slider) {
      slider.setAttribute('aria-valuenow', effectiveMuted ? '0' : String(percent));
      slider.setAttribute('aria-valuetext', effectiveMuted ? '0% volume' : `${percent}% volume`);
    }

    const handle = activePlayer.querySelector('.ytp-volume-slider-handle');
    if (handle && !skipHandle) {
      const maxLimit = getSliderHandleMax();
      const handlePos = effectiveMuted ? 0 : Math.max(0, Math.min(maxLimit, clamped * maxLimit));
      handle.style.left = `${handlePos.toFixed(1)}px`;
    }

    const muteBtn = activePlayer.querySelector('.ytp-mute-button');
    if (muteBtn) {
      muteBtn.setAttribute('title', effectiveMuted ? 'Unmute (m)' : 'Mute (m)');
      muteBtn.setAttribute('aria-label', effectiveMuted ? 'Unmute' : 'Mute');
      muteBtn.setAttribute('data-title-no-tooltip', effectiveMuted ? 'Unmute' : 'Mute');
    }
  }

  function setupNativeSliderWatchers() {
    if (!activePlayer) return;

    const panel = activePlayer.querySelector('.ytp-volume-panel');
    const volumeArea = activePlayer.querySelector('.ytp-volume-area') || panel;

    const onEnter = () => {
      updateCachedSliderHandleMax();
    };

    if (volumeArea && !volumeArea.dataset.ytVolWatched) {
      volumeArea.dataset.ytVolWatched = 'true';
      volumeArea.addEventListener('mouseenter', onEnter, { passive: true });
      volumeArea.addEventListener('pointerenter', onEnter, { passive: true });
    }
  }

  function releaseNativeSlider() {
    if (!activePlayer) return;
    const panel = activePlayer.querySelector('.ytp-volume-panel');
    if (panel) {
      panel.classList.remove('ytp-volume-panel-expanded');
      panel.blur();
    }
    const slider = activePlayer.querySelector('.ytp-volume-slider');
    if (slider) {
      slider.blur();
    }
  }

  function scheduleVolumeUpdate() {
    const clampedNow = toFiniteVolume(pendingVolume, null);
    if (clampedNow !== null) {
      tabDesiredVolume = clampedNow;
      tabDesiredMuted = clampedNow === 0;
      noteUserVolumeChange();
    }

    if (rAFScheduled) return;
    rAFScheduled = true;

    requestAnimationFrame(() => {
      rAFScheduled = false;
      if (!activePlayer) return;

      const clamped = toFiniteVolume(pendingVolume, null);
      if (clamped === null) return;

      const intVol = Math.round(clamped * 100);
      const isMuted = clamped === 0;

      tabDesiredVolume = clamped;
      tabDesiredMuted = isMuted;

      syncWithMainWorldPlayer(intVol, isMuted);

      const sliderKey = `${intVol}:${isMuted ? 1 : 0}`;
      if (sliderKey !== lastNativeSliderKey) {
        lastNativeSliderKey = sliderKey;
        persistVolume(clamped, isMuted);
      }

      if (hud && cachedPlayerRect && isDragging) {
        const follow = config.followCursor !== false;
        hud.update(
          clamped,
          isMuted,
          follow ? pendingCursorX : hudAnchorX,
          follow ? pendingCursorY : hudAnchorY,
          cachedPlayerRect
        );
      }

      if (isDragging) {
        restoreSavedPlaybackRate();
        enforcePausedIfNeeded();
      }
    });
  }

  function pausePlayerObserver() {
    if (playerObserver) {
      playerObserver.disconnect();
    }
  }

  function resumePlayerObserver() {
    startPlayerObserver();
  }

  function startPlayerObserver() {
    if (playerObserver) {
      playerObserver.disconnect();
    }
    const target = document.getElementById('movie_player')
      || document.querySelector('ytd-player')
      || document.querySelector('ytd-watch-flexy')
      || document.documentElement;
    playerObserver = new MutationObserver(() => {
      scheduleEnsureHUD();
    });
    playerObserver.observe(target, { childList: true, subtree: false });
  }

  function beginVolumeDrag() {
    isDragging = true;
    noteUserVolumeChange();
    setDraggingClass(true);
    pausePlayerObserver();
    publishVolumeGestureState(true, wasPausedAtGestureStart);
    cancelYouTubeSpeedmaster();
    restoreSavedPlaybackRate();
    enforcePausedIfNeeded();

    if (captureEl && activePointerId !== null && captureEl.setPointerCapture) {
      try {
        captureEl.setPointerCapture(activePointerId);
      } catch (e) {}
    }
  }

  function armClickSuppression() {
    suppressNextClick = true;
    if (suppressClickTimer) clearTimeout(suppressClickTimer);
    suppressClickTimer = setTimeout(() => {
      suppressNextClick = false;
      suppressClickTimer = null;
    }, 120);
  }

  function armContextMenuSuppression() {
    suppressNextContextMenu = true;
    if (suppressContextTimer) clearTimeout(suppressContextTimer);
    suppressContextTimer = setTimeout(() => {
      suppressNextContextMenu = false;
      suppressContextTimer = null;
    }, 120);
  }

  function finishGesture(e, { fromLostCapture } = {}) {
    pendingEarlyHold = null;
    if (!isPointerDown && !isDragging) {
      fastForwardLocked = false;
      activePointerId = null;
      return;
    }

    const wasDragging = isDragging;
    isPointerDown = false;
    isDragging = false;
    fastForwardLocked = false;

    if (wasDragging) {
      armClickSuppression();
      if (config.dragTrigger === 'right' || (e && e.button === 2)) {
        armContextMenuSuppression();
      }
      markVolumeJustDragged();

      const clamped = toFiniteVolume(pendingVolume, tabDesiredVolume);
      if (clamped !== null) {
        const intVol = Math.round(clamped * 100);
        const isMuted = clamped === 0;
        persistVolume(clamped, isMuted);
        syncWithMainWorldPlayer(intVol, isMuted);
        syncNativeSliderUI(clamped, isMuted);
      }

      cancelYouTubeSpeedmaster();
      restoreSavedPlaybackRate();
      enforcePausedIfNeeded();
      publishVolumeGestureState(false, wasPausedAtGestureStart);
      releaseNativeSlider();
      setDraggingClass(false);
      resumePlayerObserver();

      if (hud) {
        const x = e && typeof e.clientX === 'number' ? e.clientX : pendingCursorX;
        const y = e && typeof e.clientY === 'number' ? e.clientY : pendingCursorY;
        const rect = getLivePlayerRect();
        const inside = !!(e && !document.hidden && isInsidePlayerRect(x, y, rect));
        hud.hide(inside ? HUD_HIDE_DELAY_MS : 0);
      }

      if (wasPausedAtGestureStart) {
        const reassert = () => {
          restoreSavedPlaybackRate();
          enforcePausedIfNeeded();
        };
        pauseAssertTimers.push(setTimeout(reassert, 0));
        pauseAssertTimers.push(setTimeout(reassert, 50));
        pauseAssertTimers.push(setTimeout(reassert, 160));
        pauseAssertTimers.push(setTimeout(reassert, 280));
        pauseAssertTimers.push(setTimeout(() => {
          reassert();
          publishVolumeGestureState(false, false);
        }, 360));
      }
    } else {
      publishVolumeGestureState(false, false);
      if (hud) {
        hud.hide(0);
      }
    }

    if (!fromLostCapture) {
      releasePointerCapture();
    } else {
      captureEl = null;
    }
    activePointerId = null;

    if (wasDragging) {
      handbackMouseToYouTube(e);
    }
  }

  function handbackMouseToYouTube(e) {
    if (!activePlayer) return;

    if (document.activeElement && activePlayer.contains(document.activeElement) && document.activeElement !== activePlayer) {
      try {
        document.activeElement.blur();
      } catch (err) {}
    }

    const clientX = e && typeof e.clientX === 'number' ? e.clientX : -1;
    const clientY = e && typeof e.clientY === 'number' ? e.clientY : -1;
    const playerRect = activePlayer.getBoundingClientRect();

    const isInside = clientX >= playerRect.left &&
                     clientX <= playerRect.right &&
                     clientY >= playerRect.top &&
                     clientY <= playerRect.bottom;

    if (!isInside) {
      const leaveEventNames = ['pointerout', 'pointerleave', 'mouseleave', 'mouseout'];
      for (const evtName of leaveEventNames) {
        try {
          const isPointer = evtName.startsWith('pointer');
          const evt = isPointer
            ? new PointerEvent(evtName, {
                bubbles: evtName !== 'pointerleave',
                cancelable: false,
                view: window,
                clientX: clientX,
                clientY: clientY,
                pointerType: 'mouse',
                isPrimary: true
              })
            : new MouseEvent(evtName, {
                bubbles: evtName !== 'mouseleave',
                cancelable: false,
                view: window,
                clientX: clientX,
                clientY: clientY
              });
          activePlayer.dispatchEvent(evt);
          if (activeVideo) activeVideo.dispatchEvent(evt);
        } catch (err) {}
      }

      if (clientX >= 0 && clientY >= 0) {
        try {
          const elUnderCursor = document.elementFromPoint(clientX, clientY);
          if (elUnderCursor && !activePlayer.contains(elUnderCursor)) {
            elUnderCursor.dispatchEvent(new PointerEvent('pointermove', {
              bubbles: true,
              cancelable: false,
              view: window,
              clientX,
              clientY,
              pointerType: 'mouse'
            }));
            elUnderCursor.dispatchEvent(new MouseEvent('mousemove', {
              bubbles: true,
              cancelable: false,
              view: window,
              clientX,
              clientY
            }));
          }
        } catch (err) {}
      }
    } else {
      try {
        activePlayer.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true,
          cancelable: false,
          view: window,
          clientX,
          clientY,
          pointerType: 'mouse'
        }));
        activePlayer.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true,
          cancelable: false,
          view: window,
          clientX,
          clientY
        }));
      } catch (err) {}
    }
  }

  function onTabInactive() {
    pendingEarlyHold = null;
    if (isDragging || isPointerDown) {
      finishGesture(null);
    } else {
      isPointerDown = false;
      fastForwardLocked = false;
      activePointerId = null;
      if (hud) hud.hide(0);
      releaseNativeSlider();
    }
  }

  function startPointerGesture(player, video, e, fromEarlyHold = false, startClientX = e.clientX, startClientY = e.clientY, startTime = performance.now()) {
    disableNativeVideoDrag(video);
    ensureHUD();
    activePlayer = player;
    if (video && activeVideo !== video) {
      if (activeVideo) {
        activeVideo.removeEventListener('ratechange', onRateChange);
      }
      activeVideo = video;
      activeVideo.addEventListener('ratechange', onRateChange, { passive: true });
    }

    isPointerDown = true;
    isDragging = false;
    fastForwardLocked = false;
    activePointerId = e.pointerId;
    captureEl = player;
    pointerDownTime = startTime;

    startX = startClientX;
    startY = startClientY;
    hudAnchorX = startClientX;
    hudAnchorY = startClientY;

    if (tabDesiredVolume !== null) {
      initialVolume = tabDesiredMuted ? 0 : tabDesiredVolume;
    } else if (video) {
      initialVolume = video.muted ? 0 : toFiniteVolume(video.volume, 1);
    } else {
      initialVolume = 1.0;
    }
    pendingVolume = initialVolume;

    if (video) {
      const rate = video.playbackRate;
      savedPlaybackRate = Number.isFinite(rate) && rate > 0 ? rate : 1.0;
      wasPausedAtGestureStart = !!video.paused;
      attachPlayGuards(video);
    } else {
      savedPlaybackRate = 1.0;
      wasPausedAtGestureStart = false;
    }
    clearPauseAssertTimers();

    cachedPlayerRect = player.getBoundingClientRect();
    if (cachedPlayerRect.width < 32 && e.target && e.target.getBoundingClientRect) {
      const targetRect = e.target.getBoundingClientRect();
      if (targetRect.width > cachedPlayerRect.width) {
        cachedPlayerRect = targetRect;
      }
    }
    const playerWidth = cachedPlayerRect.width > 0 ? cachedPlayerRect.width : window.innerWidth;
    const sensitivityRatio = Math.max(0.1, config.sensitivity / 100);
    cachedSpanWidth = playerWidth * sensitivityRatio;

    if (fromEarlyHold) {
      beginVolumeDrag();
      pendingCursorX = startClientX;
      pendingCursorY = startClientY;
      scheduleVolumeUpdate();
    }
  }

  function onPointerDown(e) {
    if (!e.isPrimary) return;
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;

    if (e.target && e.target.closest && e.target.closest(NATIVE_VOLUME_SELECTOR)) {
      isNativeSliderInteracting = true;
      noteUserVolumeChange();
      pendingEarlyHold = null;
      markVolumeGestureSuppressed(e.pointerId);
      return;
    }

    if (!isVolumeEnabled()) return;
    if (isInlinePreview(e.target)) return;
    if (isInteractiveElement(e.target) || isPlayerControlTarget(e.target)) {
      pendingEarlyHold = null;
      markVolumeGestureSuppressed(e.pointerId);
      return;
    }
    if (!matchesTrigger(e)) return;

    const { player, video } = getPlayerFromTarget(e.target);
    if (player) {
      if (!player.contains(e.target) && e.target !== player) {
        const rect = player.getBoundingClientRect();
        if (!isInsidePlayerRect(e.clientX, e.clientY, rect)) {
          return;
        }
      }
      pendingEarlyHold = null;
      startPointerGesture(player, video, e, false);
    } else {
      // Player not yet mounted or page is loading: store pending early hold
      pendingEarlyHold = {
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        clientX: e.clientX,
        clientY: e.clientY,
        time: performance.now(),
        target: e.target
      };
    }
  }

  function onPointerMove(e) {
    hideHudIfPointerOutsidePlayer(e.clientX, e.clientY);

    if (!isVolumeEnabled()) return;
    if (isVolumeGestureSuppressed(e)) return;

    if (!isPointerDown && !isDragging) {
      if (pendingEarlyHold || matchesTrigger(e)) {
        if (!isInteractiveElement(e.target)) {
          const { player, video } = getPlayerFromTarget(e.target);
          if (player) {
            const rect = player.getBoundingClientRect();
            const inside = isInsidePlayerRect(e.clientX, e.clientY, rect) ||
                           (player.contains && player.contains(e.target)) ||
                           (pendingEarlyHold && isInsidePlayerRect(pendingEarlyHold.clientX, pendingEarlyHold.clientY, rect));
            if (inside) {
              const startClientX = pendingEarlyHold ? pendingEarlyHold.clientX : e.clientX;
              const startClientY = pendingEarlyHold ? pendingEarlyHold.clientY : e.clientY;
              const startTime = pendingEarlyHold ? pendingEarlyHold.time : performance.now();
              pendingEarlyHold = null;
              startPointerGesture(player, video, e, true, startClientX, startClientY, startTime);
            }
          }
        }
      }
      if (!isPointerDown) return;
    }

    if (!isPointerDown || !activePlayer || fastForwardLocked) return;
    if (activePointerId !== null && e.pointerId !== activePointerId) return;

    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;
    const distance = Math.hypot(deltaX, deltaY);
    const elapsed = performance.now() - pointerDownTime;

    if (!isDragging) {
      // Still-hold is YouTube 2x. Horizontal movement is volume, even if
      // speedmaster already started (common on paused videos).
      if (elapsed > FAST_FORWARD_THRESHOLD_MS && distance <= DRAG_THRESHOLD_PX) {
        fastForwardLocked = true;
        return;
      }

      if (distance > DRAG_THRESHOLD_PX) {
        beginVolumeDrag();
      } else {
        if (distance > 2) {
          if (e.cancelable) e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
    }

    if (activeVideo && Number.isFinite(savedPlaybackRate) && Math.abs(activeVideo.playbackRate - savedPlaybackRate) > 0.01) {
      restoreSavedPlaybackRate();
      cancelYouTubeSpeedmaster();
    }
    enforcePausedIfNeeded();

    const volumeDelta = deltaX / cachedSpanWidth;
    const rawVolume = initialVolume + volumeDelta;

    if (rawVolume > 1.0) {
      initialVolume = 1.0;
      startX = e.clientX;
      pendingVolume = 1.0;
    } else if (rawVolume < 0.0) {
      initialVolume = 0.0;
      startX = e.clientX;
      pendingVolume = 0.0;
    } else {
      pendingVolume = rawVolume;
    }

    pendingCursorX = e.clientX;
    pendingCursorY = e.clientY;

    scheduleVolumeUpdate();

    if (e.cancelable) {
      e.preventDefault();
    }
    e.stopPropagation();
  }

  function onPointerUp(e) {
    pendingEarlyHold = null;
    clearVolumeGestureSuppressed(e);
    if (!isPointerDown && !isDragging) return;
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    if (e.type === 'pointercancel' && e.isTrusted === false) return;
    finishGesture(e);
  }

  function onLostPointerCapture(e) {
    pendingEarlyHold = null;
    clearVolumeGestureSuppressed(e);
    if (!isPointerDown && !isDragging) return;
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    finishGesture(e, { fromLostCapture: true });
  }

  // Allow mouseup to reach YouTube naturally to reset its internal mouse-down state.
  // The subsequent click event is intercepted by onClickCapture to prevent play/pause toggle.
  function onCompatMouseUp(e) {
    pendingEarlyHold = null;
    clearVolumeGestureSuppressed(e);
    if (isNativeSliderInteracting) {
      setTimeout(() => { isNativeSliderInteracting = false; }, 120);
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

  function onDragStartCapture(e) {
    if (!isVolumeEnabled()) return;
    if (isPointerDown || isDragging) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const target = e.target;
    if (target && target.closest && target.closest('#movie_player, .html5-video-player, ytd-player, video')) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function onSelectStartCapture(e) {
    if (isPointerDown || isDragging) {
      e.preventDefault();
    }
  }

  function onContextMenuCapture(e) {
    const blockForRightDrag = config.dragTrigger === 'right' && (isPointerDown || isDragging);
    if (suppressNextContextMenu || isDragging || blockForRightDrag) {
      e.stopPropagation();
      e.stopImmediatePropagation();
      e.preventDefault();
      if (suppressNextContextMenu) {
        suppressNextContextMenu = false;
        if (suppressContextTimer) {
          clearTimeout(suppressContextTimer);
          suppressContextTimer = null;
        }
      }
    }
  }

  function init() {
    loadConfig();

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove, { passive: false, capture: true });
    window.addEventListener('pointerup', (e) => {
      onPointerUp(e);
      if (isNativeSliderInteracting) {
        setTimeout(() => { isNativeSliderInteracting = false; }, 120);
      }
    }, true);
    window.addEventListener('pointercancel', onPointerUp, true);
    window.addEventListener('lostpointercapture', onLostPointerCapture, true);
    window.addEventListener('mouseup', (e) => {
      onCompatMouseUp(e);
      if (isNativeSliderInteracting) {
        setTimeout(() => { isNativeSliderInteracting = false; }, 120);
      }
    }, true);
    window.addEventListener('click', onClickCapture, true);
    window.addEventListener('auxclick', onClickCapture, true);
    window.addEventListener('contextmenu', onContextMenuCapture, true);
    window.addEventListener('dragstart', onDragStartCapture, true);
    document.addEventListener('selectstart', onSelectStartCapture, true);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'm' || e.key === 'M' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
        if (tag !== 'input' && tag !== 'textarea' && (!e.target.isContentEditable)) {
          isNativeSliderInteracting = true;
          noteUserVolumeChange();
          setTimeout(() => { isNativeSliderInteracting = false; }, 350);
        }
      }
    }, true);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        onTabInactive();
      }
    });
    document.addEventListener('mouseout', (e) => {
      if (e.relatedTarget) return;
      if (isDragging || isPointerDown) return;
      if (hud) hud.hide(0);
    }, true);

    window.addEventListener('yt-navigate-finish', () => {
      userVolumeHoldUntil = 0;
      setTimeout(ensureHUD, 100);
      setTimeout(ensureHUD, 500);
    });
    window.addEventListener('spfdone', () => {
      userVolumeHoldUntil = 0;
      setTimeout(ensureHUD, 100);
      setTimeout(ensureHUD, 500);
    });

    window.addEventListener('resize', () => {
      if (activePlayer) {
        cachedPlayerRect = activePlayer.getBoundingClientRect();
        updateCachedSliderHandleMax();
      }
    }, { passive: true });

    startPlayerObserver();
    ensureHUD();

    let bootAttempts = 0;
    const bootInterval = setInterval(() => {
      bootAttempts++;
      const ready = ensureHUD();
      if ((ready && activeVideo) || bootAttempts > 40) {
        clearInterval(bootInterval);
      }
    }, 50);
  }

  init();
})();
