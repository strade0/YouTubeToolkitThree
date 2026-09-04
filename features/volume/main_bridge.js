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
  }

  // Stay inert until the isolated content script has loaded the user's settings.
  let bridgeEnabled = false;
  let nativeInteractionListenersInstalled = false;
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
  let playerBootObserver = null;
  let lastAppliedVolume = null;
  let lastAppliedMuted = null;
  let lastNonZeroVolume = 100;
  let previewActive = false;
  let previewBase = 100;
  let volGesture = {
    active: false,
    suppressPlay: false,
    savedPlaybackRate: 1
  };
  const hookedPlayers = new WeakSet();

  // Chrome drops decoded video frames when HTMLMediaElement.muted or
  // volume=0 changes. After a user gesture we route audio through a GainNode
  // and keep the element unmuted so mute is silent without touching those
  // properties. Fall back to player.mute() before the tap is ready.
  let audioCtx = null;
  let outputGain = null;
  let audioUnlocked = false;
  let mutedDesc = null;
  let volumeDesc = null;
  const volumeTapped = new WeakSet();

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
    const musicPlayerBar = document.querySelector('ytmusic-player-bar');
    const musicPlayerApi = musicPlayerBar?.playerApi || document.querySelector('ytmusic-app')?.playerApi;
    if (musicPlayerApi && typeof musicPlayerApi.setVolume === 'function') {
      return musicPlayerApi;
    }
    return null;
  }

  function getPlayerVideo(player) {
    if (player && player.querySelector) {
      const nested = player.querySelector('video');
      if (nested) return nested;
    }
    return document.querySelector('#movie_player video, .html5-video-player video, ytd-player video, ytmusic-player-page video, ytmusic-app video');
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

  (function initLastNonZero() {
    const saved = getSavedDesiredVolume();
    if (saved && saved.volume > 0) lastNonZeroVolume = saved.volume;
  })();

  function mediaProp(name) {
    return Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, name)
      || Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, name);
  }

  function ensureAudioGraph() {
    if (!audioUnlocked) return null;
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      try {
        audioCtx = new Ctx();
        outputGain = audioCtx.createGain();
        outputGain.gain.value = 1;
        outputGain.connect(audioCtx.destination);
        mutedDesc = mediaProp('muted');
        volumeDesc = mediaProp('volume');
      } catch (e) {
        audioCtx = null;
        outputGain = null;
        return null;
      }
    }
    return audioCtx;
  }

  function resumeAudioContext() {
    const ctx = ensureAudioGraph();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  }

  function setTapGain(value) {
    if (previewActive) return;
    if (!outputGain || !audioCtx) return;
    const target = value <= 0 ? 0 : 1;
    try {
      const now = audioCtx.currentTime;
      outputGain.gain.cancelScheduledValues(now);
      outputGain.gain.setValueAtTime(target, now);
    } catch (e) {
      outputGain.gain.value = target;
    }
  }

  function installMediaGuards(video) {
    if (!video || video._ytTkGuarded) return;
    video._ytTkGuarded = true;

    if (mutedDesc && mutedDesc.get && mutedDesc.set) {
      Object.defineProperty(video, 'muted', {
        configurable: true,
        get() {
          if (this._ytTkSoftMuted) return true;
          return mutedDesc.get.call(this);
        },
        set(value) {
          if (volumeTapped.has(this)) {
            this._ytTkSoftMuted = !!value;
            setTapGain(value ? 0 : 1);
            if (mutedDesc.get.call(this)) mutedDesc.set.call(this, false);
            return;
          }
          mutedDesc.set.call(this, value);
        }
      });
    }

    if (volumeDesc && volumeDesc.get && volumeDesc.set) {
      Object.defineProperty(video, 'volume', {
        configurable: true,
        get() {
          return volumeDesc.get.call(this);
        },
        set(value) {
          if (volumeTapped.has(this) && this._ytTkSoftMuted && (!Number.isFinite(value) || value <= 0.0001)) {
            return;
          }
          volumeDesc.set.call(this, value);
        }
      });
    }
  }

  function attachVolumeTap(video) {
    if (!video) return false;
    if (volumeTapped.has(video)) return true;
    const ctx = ensureAudioGraph();
    if (!ctx || !outputGain) return false;
    resumeAudioContext();
    try {
      const source = ctx.createMediaElementSource(video);
      source.connect(outputGain);
      volumeTapped.add(video);
      installMediaGuards(video);
      if (mutedDesc && mutedDesc.get && mutedDesc.get.call(video) && mutedDesc.set) {
        mutedDesc.set.call(video, false);
      }
      if (lastAppliedMuted) {
        video._ytTkSoftMuted = true;
        setTapGain(0);
      }
      return true;
    } catch (e) {
      return volumeTapped.has(video);
    }
  }

  function unlockAudioFromGesture() {
    audioUnlocked = true;
    resumeAudioContext();
    attachVolumeTap(getPlayerVideo(getPlayer()) || attachedVideo);
  }

  function setSoftMute(video, muted) {
    const wantMuted = !!muted;
    if (video && volumeTapped.has(video)) {
      video._ytTkSoftMuted = wantMuted;
      setTapGain(wantMuted ? 0 : 1);
      if (mutedDesc && mutedDesc.get && mutedDesc.get.call(video) && mutedDesc.set) {
        mutedDesc.set.call(video, false);
      }
      return true;
    }
    if (outputGain) setTapGain(wantMuted ? 0 : 1);
    return false;
  }

  function currentPlayerVolume(player) {
    if (player && typeof player.getVolume === 'function') {
      const v = player.getVolume();
      if (Number.isFinite(v)) return Math.max(0, Math.min(100, Math.round(v)));
    }
    return null;
  }

  function onWatchVideoPlay() {
    if (!bridgeEnabled) return;
    if (!volGesture.suppressPlay) return;
    pauseWatchPlayerIfNeeded();
    if (volGesture.active) {
      setYouTubePlayerPlaybackRate(volGesture.savedPlaybackRate);
    }
  }

  function onVideoLoadedMetadata() {
    if (!bridgeEnabled) return;
    applySavedVolumeOnStartup();
  }

  function onVideoPlayingStartup() {
    if (!bridgeEnabled) return;
    if (isStartupPhase) applySavedVolumeOnStartup();
  }

  function onPlayerVolumeChange() {
    if (!bridgeEnabled) return;
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
      const rounded = Math.max(0, Math.min(100, Math.round(vol)));
      const isMuted = (typeof player.isMuted === 'function' ? player.isMuted() : false) || rounded === 0;

      if (rounded > 0) lastNonZeroVolume = rounded;
      lastAppliedVolume = rounded > 0 ? rounded : lastNonZeroVolume;
      lastAppliedMuted = isMuted;
      setSoftMute(getPlayerVideo(player) || attachedVideo, isMuted);

      dispatchToIsolated('yt-player-volume-changed', {
        volume: lastAppliedVolume,
        isMuted: isMuted,
        fromUserNativeInteraction: isNativeSliderInteracting
      });
    } catch (e) {}
  }

  function setupNativeInteractionListeners() {
    if (nativeInteractionListenersInstalled) return;
    nativeInteractionListenersInstalled = true;
    const onStart = (e) => {
      if (!bridgeEnabled) return;
      unlockAudioFromGesture();
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
      if (!bridgeEnabled) return;
      unlockAudioFromGesture();
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
    if (!bridgeEnabled) return;
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
        attachedVideo.removeEventListener('loadedmetadata', onVideoLoadedMetadata);
        attachedVideo.removeEventListener('playing', onVideoPlayingStartup);
      }
      attachedVideo = video;
      video.addEventListener('play', onWatchVideoPlay, true);
      video.addEventListener('playing', onWatchVideoPlay, true);
      video.addEventListener('loadedmetadata', onVideoLoadedMetadata, { passive: true });
      video.addEventListener('playing', onVideoPlayingStartup, { passive: true });
      if (audioUnlocked) attachVolumeTap(video);
      applySavedVolumeOnStartup();
    }
  }

  function releaseInternalLock(gen) {
    if (gen === bridgeChangeGen) {
      isInternalBridgeChange = false;
    }
  }

  function setPreviewLinear(linear) {
    const lin = Math.max(0, Math.min(1, Number(linear)));
    if (!Number.isFinite(lin)) return;
    unlockAudioFromGesture();
    if (!outputGain || !audioCtx) return;

    previewActive = true;
    const base = Math.max(previewBase, 1) / 100;
    let gain = lin / base;
    if (gain > 4) gain = 4;

    try {
      const now = audioCtx.currentTime;
      outputGain.gain.cancelScheduledValues(now);
      outputGain.gain.setValueAtTime(gain, now);
    } catch (e) {
      outputGain.gain.value = gain;
    }

    const video = getPlayerVideo(getPlayer()) || attachedVideo;
    if (video && volumeTapped.has(video) && mutedDesc && mutedDesc.get && mutedDesc.set) {
      if (mutedDesc.get.call(video)) mutedDesc.set.call(video, false);
    }
  }

  function beginVolumePreview(linear) {
    unlockAudioFromGesture();
    previewBase = Math.max(1, lastAppliedVolume || lastNonZeroVolume || 100);
    previewActive = true;
    if (typeof linear === 'number') setPreviewLinear(linear);
  }

  function endVolumePreview() {
    previewActive = false;
  }

  function setYouTubePlayerVolume(volume, isMuted, immediate) {
    if (!bridgeEnabled) return;
    if (immediate) previewActive = false;

    const intVol = toFiniteIntVolume(volume);
    if (intVol === null) return;

    const wantMuted = !!(isMuted || intVol === 0);
    if (intVol > 0) lastNonZeroVolume = intVol;
    const keepVol = intVol > 0 ? intVol : lastNonZeroVolume;

    if (!immediate && lastAppliedVolume === keepVol && lastAppliedMuted === wantMuted) {
      return;
    }

    const player = getPlayer();
    const video = getPlayerVideo(player) || attachedVideo;
    if (audioUnlocked) attachVolumeTap(video);

    try {
      const usedPlayerApi = player && typeof player.setVolume === 'function';

      if (usedPlayerApi) {
        const gen = ++bridgeChangeGen;
        isInternalBridgeChange = true;
        lastAppliedVolume = keepVol;
        lastAppliedMuted = wantMuted;

        const tapReady = !!(video && volumeTapped.has(video));
        setSoftMute(video, wantMuted);
        const current = currentPlayerVolume(player);

        if (wantMuted) {
          // Never setVolume(0): that rebuilds Chrome's media pipeline.
          if (!tapReady && current === 0 && keepVol > 0) {
            player.setVolume(keepVol);
          }
          if (typeof player.mute === 'function' && (typeof player.isMuted !== 'function' || !player.isMuted())) {
            player.mute();
          }
        } else {
          if (current !== intVol) {
            player.setVolume(intVol);
          }
          if (typeof player.isMuted === 'function' && player.isMuted() && typeof player.unMute === 'function') {
            player.unMute();
          }
        }

        requestAnimationFrame(() => {
          releaseInternalLock(gen);
        });
      } else if (isStartupPhase && video && !wantMuted) {
        video.volume = Math.max(0, Math.min(1, intVol / 100));
      }
    } catch (e) {
      isInternalBridgeChange = false;
    }
  }

  function applySavedVolumeOnStartup() {
    if (!bridgeEnabled) return;
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

  function stopBootWatchers() {
    if (initIntervalId != null) {
      clearInterval(initIntervalId);
      initIntervalId = null;
    }
    try {
      if (playerBootObserver) playerBootObserver.disconnect();
    } catch (e) {}
  }

  function ensureBootObserver() {
    if (playerBootObserver) return;
    playerBootObserver = new MutationObserver(() => {
      if (!bridgeEnabled || !isStartupPhase) {
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
  }

  function startBootWatchers() {
    stopBootWatchers();
    if (!bridgeEnabled) return;
    ensureBootObserver();
    let attempts = 0;
    initIntervalId = setInterval(() => {
      if (!bridgeEnabled) {
        endStartupPhase();
        return;
      }
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
    try {
      const target = document.getElementById('movie_player') || document.querySelector('ytd-player') || document.querySelector('ytmusic-player-page') || document.querySelector('ytmusic-player-bar') || document.querySelector('#player') || document.body || document.documentElement;
      playerBootObserver.observe(target, { childList: true, subtree: true });
    } catch (e) {}
  }

  function endStartupPhase() {
    isStartupPhase = false;
    if (startupLockTimer) {
      clearTimeout(startupLockTimer);
      startupLockTimer = null;
    }
    clearPendingStartupApplies();
    stopBootWatchers();
  }

  function scheduleStartupApply(delay) {
    if (!bridgeEnabled) return;
    const id = setTimeout(() => {
      pendingStartupApplyTimers = pendingStartupApplyTimers.filter((timerId) => timerId !== id);
      applySavedVolumeOnStartup();
    }, delay);
    pendingStartupApplyTimers.push(id);
  }

  function beginStartupPhase() {
    if (!bridgeEnabled) return;
    isStartupPhase = true;
    if (startupLockTimer) clearTimeout(startupLockTimer);
    clearPendingStartupApplies();
    startupLockTimer = setTimeout(() => {
      endStartupPhase();
    }, 4000);
    startBootWatchers();
  }

  function setBridgeEnabled(enabled) {
    enabled = !!enabled;
    if (bridgeEnabled === enabled) return;
    bridgeEnabled = enabled;
    if (!enabled) {
      volGesture.active = false;
      volGesture.suppressPlay = false;
      previewActive = false;
      endStartupPhase();
    } else {
      setupNativeInteractionListeners();
      beginStartupPhase();
      setupPlayerListeners();
      scheduleStartupApply(50);
      scheduleStartupApply(200);
    }
  }

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
    'yt-speed-sync-player': 0,
    'yt-vol-preview': 0,
    'yt-vol-preview-begin': 0,
    'yt-vol-preview-end': 0,
    'yt-vol-bridge-enable': 0
  };

  function shouldProcessInbound(name, detail) {
    if (!detail) return false;
    const seq = typeof detail.seq === 'number' ? detail.seq : 0;
    if (seq > 0) {
      if (seq <= (lastInSeq[name] || 0)) {
        return false;
      }
      lastInSeq[name] = seq;
    }
    return true;
  }

  function applyBridgeEnableDetail(detail) {
    if (!shouldProcessInbound('yt-vol-bridge-enable', detail)) return;
    setBridgeEnabled(!!(detail && detail.enabled));
  }

  function applyGestureStateDetail(detail) {
    if (!bridgeEnabled) return;
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
    if (!bridgeEnabled) return;
    if (!shouldProcessInbound('yt-vol-sync-player', detail)) return;
    const { volume, isMuted, immediate } = detail;
    if (typeof volume === 'number' && Number.isFinite(volume)) {
      endStartupPhase();
      setYouTubePlayerVolume(volume, !!isMuted, !!immediate);
    }
  }

  function applySpeedSyncDetail(detail) {
    if (!shouldProcessInbound('yt-speed-sync-player', detail)) return;
    const { rate } = detail;
    if (typeof rate === 'number' && Number.isFinite(rate)) {
      setYouTubePlayerPlaybackRate(rate);
    }
  }

  function applyPreviewBeginDetail(detail) {
    if (!bridgeEnabled) return;
    if (!shouldProcessInbound('yt-vol-preview-begin', detail)) return;
    beginVolumePreview(detail && detail.linear);
  }

  function applyPreviewDetail(detail) {
    if (!bridgeEnabled) return;
    if (!shouldProcessInbound('yt-vol-preview', detail)) return;
    if (detail && typeof detail.linear === 'number') {
      setPreviewLinear(detail.linear);
    }
  }

  function applyPreviewEndDetail(detail) {
    if (!bridgeEnabled) return;
    if (!shouldProcessInbound('yt-vol-preview-end', detail)) return;
    endVolumePreview();
  }

  window.addEventListener('yt-vol-bridge-enable', (e) => {
    applyBridgeEnableDetail(e && e.detail);
  }, { passive: true });

  window.addEventListener('yt-vol-gesture-state', (e) => {
    applyGestureStateDetail(e && e.detail);
  }, { passive: true });

  window.addEventListener('yt-vol-sync-player', (e) => {
    applyVolSyncDetail(e && e.detail);
  }, { passive: true });

  window.addEventListener('yt-speed-sync-player', (e) => {
    applySpeedSyncDetail(e && e.detail);
  }, { passive: true });

  window.addEventListener('yt-vol-preview-begin', (e) => {
    applyPreviewBeginDetail(e && e.detail);
  }, { passive: true });

  window.addEventListener('yt-vol-preview', (e) => {
    applyPreviewDetail(e && e.detail);
  }, { passive: true });

  window.addEventListener('yt-vol-preview-end', (e) => {
    applyPreviewEndDetail(e && e.detail);
  }, { passive: true });

  window.addEventListener('message', (e) => {
    if (!e || e.source !== window || !e.data || e.data.source !== BRIDGE_SOURCE) return;
    if (e.data.name === 'yt-vol-bridge-enable') {
      applyBridgeEnableDetail(e.data.detail);
    } else if (e.data.name === 'yt-vol-gesture-state') {
      applyGestureStateDetail(e.data.detail);
    } else if (e.data.name === 'yt-vol-sync-player') {
      applyVolSyncDetail(e.data.detail);
    } else if (e.data.name === 'yt-speed-sync-player') {
      applySpeedSyncDetail(e.data.detail);
    } else if (e.data.name === 'yt-vol-preview-begin') {
      applyPreviewBeginDetail(e.data.detail);
    } else if (e.data.name === 'yt-vol-preview') {
      applyPreviewDetail(e.data.detail);
    } else if (e.data.name === 'yt-vol-preview-end') {
      applyPreviewEndDetail(e.data.detail);
    }
  });

  window.addEventListener('yt-navigate-finish', () => {
    if (!bridgeEnabled) return;
    beginStartupPhase();
    setupPlayerListeners();
    scheduleStartupApply(50);
    scheduleStartupApply(200);
    scheduleStartupApply(800);
  }, { passive: true });
})();
