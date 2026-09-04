// SkipIt content script: automatically clicks the native Jump Ahead button on skip.

(function () {
  'use strict';

  const STORAGE_PREFIX = 'skipit.';
  const MASTER_KEY = 'toolkit.masterEnabled';
  const JUMP_AHEAD_LABELS = ['jump ahead', 'avanzar', 'avancer', 'vorspulen', 'avançar'];

  const settings = {
    enabled: true,
    delay: 600,
    mediaGestureEnabled: true,
    mediaGestureWindow: 1000,
    keys: {
      ArrowRight: true,
      KeyL: true
    }
  };
  let masterEnabled = true;
  let settingsLoaded = false;

  let skipTimer = null;
  let skipPressCount = 0;
  let resetTimer = null;
  let mediaGestureTimer = null;
  let mediaGestureVideo = null;
  let mediaGesturePausedAt = 0;
  let mediaGesturePausedTime = 0;
  let mediaGestureSkipTimer = null;

  function isSkipItEnabled() {
    return settingsLoaded && masterEnabled && settings.enabled;
  }

  function applyStorageItems(result) {
    if (!result) return;
    if (result[MASTER_KEY] !== undefined) {
      masterEnabled = result[MASTER_KEY] !== false;
    }
    if (result[STORAGE_PREFIX + 'enabled'] !== undefined) {
      settings.enabled = result[STORAGE_PREFIX + 'enabled'];
    }
    if (result[STORAGE_PREFIX + 'delay'] !== undefined) {
      settings.delay = result[STORAGE_PREFIX + 'delay'];
    }
    if (result[STORAGE_PREFIX + 'mediaGestureEnabled'] !== undefined) {
      settings.mediaGestureEnabled = result[STORAGE_PREFIX + 'mediaGestureEnabled'];
    }
    if (result[STORAGE_PREFIX + 'mediaGestureWindow'] !== undefined) {
      settings.mediaGestureWindow = result[STORAGE_PREFIX + 'mediaGestureWindow'];
    }
    if (result[STORAGE_PREFIX + 'keys'] !== undefined) {
      settings.keys = { ...settings.keys, ...result[STORAGE_PREFIX + 'keys'] };
    }
  }

  function loadSettings() {
    chrome.storage.sync.get(
      {
        [MASTER_KEY]: true,
        [STORAGE_PREFIX + 'enabled']: true,
        [STORAGE_PREFIX + 'delay']: 600,
        [STORAGE_PREFIX + 'mediaGestureEnabled']: false,
        [STORAGE_PREFIX + 'mediaGestureWindow']: 1000,
        [STORAGE_PREFIX + 'keys']: { ArrowRight: true, KeyL: true }
      },
      (result) => {
        applyStorageItems(result);
        settingsLoaded = true;
      }
    );
  }

  loadSettings();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes[MASTER_KEY]) {
      masterEnabled = changes[MASTER_KEY].newValue !== false;
    }
    if (changes[STORAGE_PREFIX + 'enabled']) {
      settings.enabled = changes[STORAGE_PREFIX + 'enabled'].newValue;
    }
    if (changes[STORAGE_PREFIX + 'delay']) {
      settings.delay = changes[STORAGE_PREFIX + 'delay'].newValue;
    }
    if (changes[STORAGE_PREFIX + 'mediaGestureEnabled']) {
      settings.mediaGestureEnabled = changes[STORAGE_PREFIX + 'mediaGestureEnabled'].newValue;
      if (!settings.mediaGestureEnabled) {
        clearMediaGesture();
        if (mediaGestureSkipTimer) clearTimeout(mediaGestureSkipTimer);
        mediaGestureSkipTimer = null;
      }
    }
    if (changes[STORAGE_PREFIX + 'mediaGestureWindow']) {
      settings.mediaGestureWindow = changes[STORAGE_PREFIX + 'mediaGestureWindow'].newValue;
      clearMediaGesture();
    }
    if (changes[STORAGE_PREFIX + 'keys']) {
      settings.keys = { ...settings.keys, ...changes[STORAGE_PREFIX + 'keys'].newValue };
    }
    if (!masterEnabled || !settings.enabled) {
      cancelPendingSkip();
    }
  });

  function cancelPendingSkip() {
    if (skipTimer) clearTimeout(skipTimer);
    if (resetTimer) clearTimeout(resetTimer);
    if (mediaGestureSkipTimer) clearTimeout(mediaGestureSkipTimer);
    skipTimer = null;
    resetTimer = null;
    mediaGestureSkipTimer = null;
    skipPressCount = 0;
    clearMediaGesture();
  }

  function clearMediaGesture() {
    if (mediaGestureTimer) clearTimeout(mediaGestureTimer);
    mediaGestureTimer = null;
    mediaGestureVideo = null;
    mediaGesturePausedAt = 0;
    mediaGesturePausedTime = 0;
  }

  function isTypingInInput() {
    const activeEl = document.activeElement;
    if (!activeEl) return false;
    const tag = activeEl.tagName.toLowerCase();
    return (
      tag === 'input' ||
      tag === 'textarea' ||
      activeEl.isContentEditable ||
      activeEl.getAttribute('contenteditable') === 'true'
    );
  }

  function clickableAction(element) {
    if (!element) return null;
    return (element.closest && element.closest('button')) || element;
  }

  function isRecognizedJumpAheadAction(element) {
    if (!element) return false;
    const container = element.closest && element.closest('.ytp-suggested-action');
    const candidates = container && container !== element ? [element, container] : [element];
    const text = candidates.map((candidate) => [
      candidate.textContent,
      candidate.getAttribute && candidate.getAttribute('aria-label'),
      candidate.getAttribute && candidate.getAttribute('title')
    ].filter(Boolean).join(' ')).join(' ').toLowerCase();
    if (!container && !text.includes('jump ahead')) return false;
    return JUMP_AHEAD_LABELS.some((label) => text.includes(label));
  }

  function findJumpAheadButton() {
    const badges = document.querySelectorAll('.ytp-suggested-action-badge');
    for (const badge of badges) {
      if (isRecognizedJumpAheadAction(badge)) {
        return clickableAction(badge);
      }
    }

    const containers = document.querySelectorAll('.ytp-suggested-action');
    for (const container of containers) {
      if (isRecognizedJumpAheadAction(container)) {
        const btn = container.querySelector('button') || clickableAction(container.querySelector('.ytp-suggested-action-badge'));
        if (btn) return btn;
      }
    }

    const player = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
    if (player) {
      const buttons = player.querySelectorAll('button');
      for (const btn of buttons) {
        if (isRecognizedJumpAheadAction(btn)) {
          return btn;
        }
      }
    }

    // YouTube translates the visible label but retains the native suggested-action
    // structure. Restrict the language-neutral fallback to a visible action badge.
    for (const badge of badges) {
      if (badge.closest('.ytp-suggested-action') && isElementVisible(badge)) {
        return clickableAction(badge);
      }
    }

    return null;
  }

  function isElementVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0'
    );
  }

  function triggerJump(button) {
    if (!button) return;

    try {
      chrome.runtime.sendMessage({ action: 'skipit.jump_triggered', secondsSaved: 25 }, () => {
        void chrome.runtime.lastError;
      });
    } catch (err) {}

    const originalTransition = button.style.transition;
    const originalTransform = button.style.transform;
    button.style.transition = 'transform 0.1s ease';
    button.style.transform = 'scale(1.15)';

    setTimeout(() => {
      button.style.transform = originalTransform;
      button.style.transition = originalTransition;
    }, 100);

    ['mousedown', 'mouseup', 'click'].forEach((eventType) => {
      button.dispatchEvent(new MouseEvent(eventType, {
        view: window,
        bubbles: true,
        cancelable: true
      }));
    });

  }

  function attemptJump() {
    if (!isSkipItEnabled()) return;
    const jumpButton = findJumpAheadButton();
    if (jumpButton && (isElementVisible(jumpButton) || isRecognizedJumpAheadAction(jumpButton))) {
      triggerJump(jumpButton);
    }
  }

  function isVideoElement(element) {
    return Boolean(element && String(element.tagName || '').toLowerCase() === 'video');
  }

  function isAdPlaying(video) {
    const player = video && video.closest && video.closest('.html5-video-player');
    return Boolean(player && (
      player.classList.contains('ad-showing') ||
      player.classList.contains('ad-interrupting')
    ));
  }

  function notifyMediaGesture() {
    try {
      chrome.runtime.sendMessage({
        action: 'skipit.skip_detected',
        trigger: 'Quick pause/play'
      }, () => {
        void chrome.runtime.lastError;
      });
    } catch (err) {}
  }

  function handleVideoPause(event) {
    const video = event.target;
    if (!isSkipItEnabled() || !settings.mediaGestureEnabled || !isVideoElement(video)) return;

    clearMediaGesture();
    if (video.ended || video.seeking || isAdPlaying(video)) return;

    mediaGestureVideo = video;
    mediaGesturePausedAt = Date.now();
    mediaGesturePausedTime = Number(video.currentTime) || 0;
    mediaGestureTimer = setTimeout(clearMediaGesture, settings.mediaGestureWindow);
  }

  function handleVideoPlay(event) {
    const video = event.target;
    if (!isSkipItEnabled() || !settings.mediaGestureEnabled || video !== mediaGestureVideo) return;

    const elapsed = Date.now() - mediaGesturePausedAt;
    const playTime = Number(video.currentTime) || 0;
    const stayedAtSamePosition = Math.abs(playTime - mediaGesturePausedTime) <= 1.5;
    const completedInTime = elapsed >= 0 && elapsed <= settings.mediaGestureWindow;
    const canTrigger = completedInTime && stayedAtSamePosition && !video.ended && !video.seeking && !isAdPlaying(video);
    clearMediaGesture();

    if (!canTrigger) return;
    notifyMediaGesture();
    if (mediaGestureSkipTimer) clearTimeout(mediaGestureSkipTimer);
    mediaGestureSkipTimer = setTimeout(() => {
      mediaGestureSkipTimer = null;
      attemptJump();
    }, settings.delay);
  }

  // Headset media buttons reach the page as ordinary video pause/play events.
  // Capture listeners work across YouTube's single-page navigation and replaced
  // video elements without taking over the site's Media Session handlers.
  document.addEventListener('pause', handleVideoPause, true);
  document.addEventListener('play', handleVideoPlay, true);

  window.addEventListener('keydown', (event) => {
    if (!isSkipItEnabled() || isTypingInInput()) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;

    const isArrowRight = event.key === 'ArrowRight' && settings.keys.ArrowRight;
    const isKeyL = event.key.toLowerCase() === 'l' && settings.keys.KeyL;

    if (!isArrowRight && !isKeyL) return;

    try {
      chrome.runtime.sendMessage({ action: 'skipit.skip_detected', key: event.key }, () => {
        void chrome.runtime.lastError;
      });
    } catch (err) {}

    if (resetTimer) clearTimeout(resetTimer);

    skipPressCount++;

    resetTimer = setTimeout(() => {
      skipPressCount = 0;
    }, Math.max(1200, settings.delay + 500));

    if (skipPressCount === 1) {
      if (skipTimer) clearTimeout(skipTimer);

      skipTimer = setTimeout(() => {
        skipTimer = null;
        if (skipPressCount === 1 && isSkipItEnabled()) {
          attemptJump();
        }
        skipPressCount = 0;
      }, settings.delay);
    } else {
      if (skipTimer) clearTimeout(skipTimer);
    }
  }, true);
})();
