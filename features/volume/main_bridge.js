// Main world bridge: interfaces directly with the YouTube player API.

(function () {
  'use strict';

  const VOLUME_STORAGE_KEYS = new Set([
    'yt_extension_saved_volume',
    'yt_extension_saved_muted',
    'yt_tab_volume',
    'yt_tab_muted',
    'yt-player-volume'
  ]);

  const NATIVE_VOLUME_SELECTOR = '.ytp-volume-control, .ytp-volume-panel, .ytp-volume-slider, .ytp-mute-button, .ytp-volume-area';

  let attachedPlayer = null;
  let attachedVideo = null;
  let isInternalBridgeChange = false;
  let isNativeSliderInteracting = false;
  let bridgeChangeGen = 0;
  let startupLockTimer = null;
  let isStartupPhase = true;
  let pendingStartupApplyTimers = [];
  let bootApplyTimer = null;
  let initIntervalId = null;

  window.addEventListener('storage', (e) => {
    if (e.key && VOLUME_STORAGE_KEYS.has(e.key)) {
      e.stopImmediatePropagation();
    }
  }, true);

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

  function getPlayer() {
    const moviePlayer = document.getElementById('movie_player');
    if (moviePlayer && !isInlinePreview(moviePlayer)) {
      return moviePlayer;
    }
    const watchPlayer = document.querySelector(
      'ytd-watch-flexy .html5-video-player, ytd-watch-grid .html5-video-player, ytd-player .html5-video-player, #shorts-player, ytd-miniplayer .html5-video-player'
    );
    if (watchPlayer && !isInlinePreview(watchPlayer)) {
      return watchPlayer;
    }
    return null;
  }

  function getPlayerVideo(player) {
    if (player && player.querySelector) {
      const nested = player.querySelector('video');
      if (nested) return nested;
    }
    return document.querySelector('#movie_player video, .html5-video-player video, ytd-player video');
  }

  function toFiniteIntVolume(value) {
    const n = typeof value === 'number' ? value : parseFloat(value);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function getSavedDesiredVolume() {
    try {
      const saved = localStorage.getItem('yt_extension_saved_volume');
      if (saved !== null) {
        const vol = parseFloat(saved);
        if (Number.isFinite(vol)) {
          const isMuted = localStorage.getItem('yt_extension_saved_muted') === 'true';
          return {
            volume: Math.max(0, Math.min(100, Math.round(vol * 100))),
            isMuted: isMuted
          };
        }
      }
    } catch (e) {}
    return null;
  }

  function onPlayerVolumeChange() {
    if (isInternalBridgeChange) return;

    if (isStartupPhase && !isNativeSliderInteracting) {
      const saved = getSavedDesiredVolume();
      if (saved !== null) {
        setYouTubePlayerVolume(saved.volume, saved.isMuted);
        return;
      }
    }

    try {
      const player = getPlayer();
      if (!player || typeof player.getVolume !== 'function') return;

      const vol = player.getVolume();
      if (!Number.isFinite(vol)) return;
      const isMuted = typeof player.isMuted === 'function' ? player.isMuted() : false;

      window.dispatchEvent(new CustomEvent('yt-player-volume-changed', {
        detail: {
          volume: vol,
          isMuted: isMuted,
          fromUserNativeInteraction: isNativeSliderInteracting
        }
      }));
    } catch (e) {}
  }

  function setupNativeInteractionListeners() {
    const onStart = (e) => {
      const target = e.target;
      if (target && target.closest && target.closest(NATIVE_VOLUME_SELECTOR)) {
        isNativeSliderInteracting = true;
        endStartupPhase();
      }
    };
    const onEnd = () => {
      if (isNativeSliderInteracting) {
        setTimeout(() => {
          isNativeSliderInteracting = false;
        }, 120);
      }
    };

    window.addEventListener('pointerdown', onStart, true);
    window.addEventListener('mousedown', onStart, true);
    window.addEventListener('pointerup', onEnd, true);
    window.addEventListener('mouseup', onEnd, true);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'm' || e.key === 'M' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
        if (tag !== 'input' && tag !== 'textarea' && (!e.target.isContentEditable)) {
          isNativeSliderInteracting = true;
          endStartupPhase();
          setTimeout(() => { isNativeSliderInteracting = false; }, 350);
        }
      }
    }, true);
  }

  function setupPlayerListeners() {
    const player = getPlayer();
    if (!player) return;

    if (attachedPlayer !== player) {
      if (attachedPlayer && typeof attachedPlayer.removeEventListener === 'function') {
        try {
          attachedPlayer.removeEventListener('onVolumeChange', onPlayerVolumeChange);
        } catch (e) {}
      }
      attachedPlayer = player;
      if (typeof player.addEventListener === 'function') {
        try {
          player.addEventListener('onVolumeChange', onPlayerVolumeChange);
        } catch (e) {}
      }
    }

    const video = player.querySelector ? player.querySelector('video') : null;
    if (video && attachedVideo !== video) {
      if (attachedVideo) {
        attachedVideo.removeEventListener('volumechange', onPlayerVolumeChange);
      }
      attachedVideo = video;
      video.addEventListener('volumechange', onPlayerVolumeChange, { passive: true });
      video.addEventListener('loadedmetadata', () => {
        applySavedVolumeOnStartup();
      }, { passive: true });
      video.addEventListener('playing', () => {
        if (isStartupPhase) applySavedVolumeOnStartup();
      }, { passive: true });
      applySavedVolumeOnStartup();
    }
  }

  function releaseInternalLock(gen) {
    if (gen === bridgeChangeGen) {
      isInternalBridgeChange = false;
    }
  }

  function setYouTubePlayerVolume(volume, isMuted) {
    const intVol = toFiniteIntVolume(volume);
    if (intVol === null) return;

    try {
      const player = getPlayer();
      const gen = ++bridgeChangeGen;
      isInternalBridgeChange = true;
      try {
        if (player && typeof player.setVolume === 'function') {
          player.setVolume(intVol);
          if (isMuted || intVol === 0) {
            if (typeof player.mute === 'function') player.mute();
          } else if (typeof player.isMuted === 'function' && player.isMuted()) {
            if (typeof player.unMute === 'function') player.unMute();
          }
        }

        const video = getPlayerVideo(player);
        if (video) {
          const fraction = intVol / 100;
          if (Math.abs(video.volume - fraction) > 0.01) {
            video.volume = fraction;
          }
          if (video.muted !== (isMuted || intVol === 0)) {
            video.muted = !!(isMuted || intVol === 0);
          }
        }
      } catch (inner) {}

      // Wait two frames so YouTube's own volumechange is still treated as internal.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => releaseInternalLock(gen));
      });
    } catch (e) {
      isInternalBridgeChange = false;
    }
  }

  function applySavedVolumeOnStartup() {
    if (!isStartupPhase) return;
    try {
      setupPlayerListeners();
      const saved = getSavedDesiredVolume();
      if (saved !== null) {
        setYouTubePlayerVolume(saved.volume, saved.isMuted);
      }
    } catch (e) {}
  }

  function clearPendingStartupApplies() {
    for (let i = 0; i < pendingStartupApplyTimers.length; i++) {
      clearTimeout(pendingStartupApplyTimers[i]);
    }
    pendingStartupApplyTimers = [];
    if (bootApplyTimer != null) {
      clearTimeout(bootApplyTimer);
      bootApplyTimer = null;
    }
  }

  function endStartupPhase() {
    isStartupPhase = false;
    if (startupLockTimer) {
      clearTimeout(startupLockTimer);
      startupLockTimer = null;
    }
    clearPendingStartupApplies();
    if (initIntervalId != null) {
      clearInterval(initIntervalId);
      initIntervalId = null;
    }
  }

  function scheduleStartupApply(delay) {
    const id = setTimeout(() => {
      pendingStartupApplyTimers = pendingStartupApplyTimers.filter((timerId) => timerId !== id);
      applySavedVolumeOnStartup();
    }, delay);
    pendingStartupApplyTimers.push(id);
  }

  function beginStartupPhase() {
    isStartupPhase = true;
    if (startupLockTimer) clearTimeout(startupLockTimer);
    clearPendingStartupApplies();
    startupLockTimer = setTimeout(() => {
      isStartupPhase = false;
      startupLockTimer = null;
    }, 8000);
  }

  setupNativeInteractionListeners();
  beginStartupPhase();

  let attempts = 0;
  initIntervalId = setInterval(() => {
    attempts++;
    setupPlayerListeners();
    const player = getPlayer();
    const hasApi = player && typeof player.setVolume === 'function';
    const hasVideo = !!getPlayerVideo(player);
    if (hasApi || hasVideo) {
      applySavedVolumeOnStartup();
    }
    if ((hasApi && hasVideo && attempts > 10) || attempts > 150) {
      if (initIntervalId != null) {
        clearInterval(initIntervalId);
        initIntervalId = null;
      }
    }
  }, 50);

  const playerBootObserver = new MutationObserver(() => {
    if (!isStartupPhase) {
      try { playerBootObserver.disconnect(); } catch (e) {}
      return;
    }
    setupPlayerListeners();
    if (bootApplyTimer != null) return;
    bootApplyTimer = setTimeout(() => {
      bootApplyTimer = null;
      if (!isStartupPhase) return;
      const player = getPlayer();
      if (player && (typeof player.setVolume === 'function' || getPlayerVideo(player))) {
        applySavedVolumeOnStartup();
        if (typeof player.setVolume === 'function' && getPlayerVideo(player)) {
          try { playerBootObserver.disconnect(); } catch (e) {}
        }
      }
    }, 50);
  });
  playerBootObserver.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => {
    try { playerBootObserver.disconnect(); } catch (e) {}
  }, 20000);

  function setYouTubePlayerPlaybackRate(rate) {
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return;
    try {
      const player = getPlayer();
      if (player && typeof player.setPlaybackRate === 'function') {
        player.setPlaybackRate(rate);
      }
      const video = getPlayerVideo(player);
      if (video && Math.abs(video.playbackRate - rate) > 0.01) {
        video.playbackRate = rate;
      }
    } catch (e) {}
  }

  window.addEventListener('yt-vol-sync-player', (e) => {
    if (!e || !e.detail) return;
    const { volume, isMuted } = e.detail;
    if (typeof volume === 'number' && Number.isFinite(volume)) {
      endStartupPhase();
      setYouTubePlayerVolume(volume, !!isMuted);
    }
  }, { passive: true });

  window.addEventListener('yt-speed-sync-player', (e) => {
    if (!e || !e.detail) return;
    const { rate } = e.detail;
    if (typeof rate === 'number' && Number.isFinite(rate)) {
      setYouTubePlayerPlaybackRate(rate);
    }
  }, { passive: true });

  window.addEventListener('yt-navigate-finish', () => {
    beginStartupPhase();
    setupPlayerListeners();
    scheduleStartupApply(50);
    scheduleStartupApply(100);
    scheduleStartupApply(500);
    scheduleStartupApply(1500);
  }, { passive: true });
})();
