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
  const BRIDGE_SOURCE = 'yt-toolkit-volume-bridge';
  let bridgeOutSeq = 0;
  function dispatchToIsolated(name, detail) {
    const payload = detail && typeof detail === 'object' ? { ...detail } : {};
    payload.seq = ++bridgeOutSeq;
    try {
      window.dispatchEvent(new CustomEvent(name, { detail: payload }));
    } catch (e) {}
    try {
      window.postMessage({ source: BRIDGE_SOURCE, name: name, detail: payload }, '*');
    } catch (e) {}
  }

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
  let lastAppliedVolume = null;
  let lastAppliedMuted = null;
  let volGesture = {
    active: false,
    suppressPlay: false,
    savedPlaybackRate: 1
  };
  const hookedPlayers = new WeakSet();

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

  function onWatchVideoPlay() {
    if (!volGesture.suppressPlay) return;
    pauseWatchPlayerIfNeeded();
    if (volGesture.active) {
      setYouTubePlayerPlaybackRate(volGesture.savedPlaybackRate);
    }
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

      lastAppliedVolume = vol;
      lastAppliedMuted = isMuted;

      dispatchToIsolated('yt-player-volume-changed', {
        volume: vol,
        isMuted: isMuted,
        fromUserNativeInteraction: isNativeSliderInteracting
      });
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
      hookPlayerPlaybackGuards(player);
    }

    const video = player.querySelector ? player.querySelector('video') : null;
    if (video && attachedVideo !== video) {
      if (attachedVideo) {
        attachedVideo.removeEventListener('play', onWatchVideoPlay, true);
        attachedVideo.removeEventListener('playing', onWatchVideoPlay, true);
      }
      attachedVideo = video;
      video.addEventListener('play', onWatchVideoPlay, true);
      video.addEventListener('playing', onWatchVideoPlay, true);
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

    if (lastAppliedVolume === intVol) {
      return;
    }

    try {
      const player = getPlayer();
      const usedPlayerApi = player && typeof player.setVolume === 'function';

      if (usedPlayerApi) {
        const gen = ++bridgeChangeGen;
        isInternalBridgeChange = true;
        lastAppliedVolume = intVol;

        // If player was hard-muted (e.g. native 'm' key or mute button), un-mute once when raising volume
        if (intVol > 0 && typeof player.isMuted === 'function' && player.isMuted() && typeof player.unMute === 'function') {
          player.unMute();
        }

        // Setting volume directly scales the gain without resetting the Web Audio clock or dropping frames
        player.setVolume(intVol);

        requestAnimationFrame(() => {
          requestAnimationFrame(() => releaseInternalLock(gen));
        });
      } else if (isStartupPhase) {
        // Only set video element volume during early pre-mount startup when player API is not yet available
        const video = getPlayerVideo(player);
        if (video) {
          video.volume = Math.max(0, Math.min(1, intVol / 100));
        }
      }
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
    try {
      if (playerBootObserver) playerBootObserver.disconnect();
    } catch (e) {}
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
      endStartupPhase();
    }, 4000);
  }

  setupNativeInteractionListeners();
  beginStartupPhase();

  let attempts = 0;
  initIntervalId = setInterval(() => {
    attempts++;
    setupPlayerListeners();
    const player = getPlayer();
    const hasApi = player && typeof player.setVolume === 'function';
    if (hasApi) {
      applySavedVolumeOnStartup();
      if (attempts > 5) {
        endStartupPhase();
      }
    }
    if (attempts > 60) {
      endStartupPhase();
    }
  }, 50);

  const playerBootObserver = new MutationObserver(() => {
    if (!isStartupPhase) {
      try { playerBootObserver.disconnect(); } catch (e) {}
      return;
    }
    setupPlayerListeners();
    const player = getPlayer();
    if (player && typeof player.setVolume === 'function') {
      applySavedVolumeOnStartup();
      endStartupPhase();
    }
  });

  try {
    const target = document.getElementById('movie_player') || document.querySelector('ytd-player') || document.querySelector('#player') || document.body || document.documentElement;
    playerBootObserver.observe(target, { childList: true, subtree: false });
  } catch (e) {}

  setTimeout(() => {
    endStartupPhase();
  }, 3000);

  function setYouTubePlayerPlaybackRate(rate) {
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return;
    try {
      const player = getPlayer();
      if (player && typeof player.getPlaybackRate === 'function' && typeof player.setPlaybackRate === 'function') {
        const curRate = player.getPlaybackRate();
        if (Math.abs(curRate - rate) > 0.01) {
          player.setPlaybackRate(rate);
        }
      }
    } catch (e) {}
  }

  function isWatchPlayerVideo(el) {
    if (!el) return false;
    const player = getPlayer();
    return el === attachedVideo || el === getPlayerVideo(player);
  }

  function pauseWatchPlayerIfNeeded() {
    if (!volGesture.suppressPlay) return;
    try {
      const player = getPlayer();
      if (player && typeof player.pauseVideo === 'function') {
        player.pauseVideo();
      }
      const video = getPlayerVideo(player) || attachedVideo;
      if (video && !video.paused) {
        video.pause();
      }
    } catch (e) {}
  }

  function applyVolumeGestureGuards() {
    if (volGesture.active) {
      setYouTubePlayerPlaybackRate(volGesture.savedPlaybackRate);
    }
    pauseWatchPlayerIfNeeded();
  }

  function hookPlayerPlaybackGuards(player) {
    if (!player || hookedPlayers.has(player)) return;
    hookedPlayers.add(player);

    if (typeof player.playVideo === 'function') {
      const origPlayVideo = player.playVideo.bind(player);
      player.playVideo = function (...args) {
        if (volGesture.suppressPlay) return;
        return origPlayVideo(...args);
      };
    }

    if (typeof player.setPlaybackRate === 'function') {
      const origSetRate = player.setPlaybackRate.bind(player);
      player.setPlaybackRate = function (rate, ...rest) {
        if (volGesture.active && Number.isFinite(volGesture.savedPlaybackRate)) {
          return origSetRate(volGesture.savedPlaybackRate, ...rest);
        }
        return origSetRate(rate, ...rest);
      };
    }
  }

  const origMediaPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    if (volGesture.suppressPlay && isWatchPlayerVideo(this)) {
      return Promise.resolve();
    }
    return origMediaPlay.apply(this, args);
  };

  const lastInSeq = {
    'yt-vol-sync-player': 0,
    'yt-vol-gesture-state': 0,
    'yt-speed-sync-player': 0
  };

  function shouldProcessInbound(name, detail) {
    if (!detail) return false;
    const seq = typeof detail.seq === 'number' ? detail.seq : 0;
    if (seq > 0) {
      if (seq <= (lastInSeq[name] || 0)) {
        return false; // older or duplicate message (e.g. delayed postMessage), discard!
      }
      lastInSeq[name] = seq;
    }
    return true;
  }

  function applyGestureStateDetail(detail) {
    if (!shouldProcessInbound('yt-vol-gesture-state', detail)) return;
    const { active, suppressPlay, savedPlaybackRate } = detail;
    volGesture.active = !!active;
    volGesture.suppressPlay = !!suppressPlay;
    if (typeof savedPlaybackRate === 'number' && Number.isFinite(savedPlaybackRate) && savedPlaybackRate > 0) {
      volGesture.savedPlaybackRate = savedPlaybackRate;
    }
    hookPlayerPlaybackGuards(getPlayer());
    applyVolumeGestureGuards();
  }

  function applyVolSyncDetail(detail) {
    if (!shouldProcessInbound('yt-vol-sync-player', detail)) return;
    const { volume, isMuted } = detail;
    if (typeof volume === 'number' && Number.isFinite(volume)) {
      endStartupPhase();
      setYouTubePlayerVolume(volume, !!isMuted);
    }
  }

  function applySpeedSyncDetail(detail) {
    if (!shouldProcessInbound('yt-speed-sync-player', detail)) return;
    const { rate } = detail;
    if (typeof rate === 'number' && Number.isFinite(rate)) {
      setYouTubePlayerPlaybackRate(rate);
    }
  }

  window.addEventListener('yt-vol-gesture-state', (e) => {
    applyGestureStateDetail(e && e.detail);
  }, { passive: true });

  window.addEventListener('yt-vol-sync-player', (e) => {
    applyVolSyncDetail(e && e.detail);
  }, { passive: true });

  window.addEventListener('yt-speed-sync-player', (e) => {
    applySpeedSyncDetail(e && e.detail);
  }, { passive: true });

  window.addEventListener('message', (e) => {
    if (!e || e.source !== window || !e.data || e.data.source !== BRIDGE_SOURCE) return;
    if (e.data.name === 'yt-vol-gesture-state') {
      applyGestureStateDetail(e.data.detail);
    } else if (e.data.name === 'yt-vol-sync-player') {
      applyVolSyncDetail(e.data.detail);
    } else if (e.data.name === 'yt-speed-sync-player') {
      applySpeedSyncDetail(e.data.detail);
    }
  });

  window.addEventListener('yt-navigate-finish', () => {
    beginStartupPhase();
    setupPlayerListeners();
    scheduleStartupApply(50);
    scheduleStartupApply(200);
    scheduleStartupApply(800);
  }, { passive: true });
})();
