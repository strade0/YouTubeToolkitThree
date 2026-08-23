// SkipIt content script: automatically clicks the native Jump Ahead button on skip.

(function () {
  'use strict';

  const STORAGE_PREFIX = 'skipit.';
  const MASTER_KEY = 'toolkit.masterEnabled';

  const settings = {
    enabled: true,
    delay: 600,
    keys: {
      ArrowRight: true,
      KeyL: true
    }
  };
  let masterEnabled = true;

  let skipTimer = null;
  let skipPressCount = 0;
  let resetTimer = null;

  function isSkipItEnabled() {
    return masterEnabled && settings.enabled;
  }

  function applyLocalItems(result) {
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
    if (result[STORAGE_PREFIX + 'keys'] !== undefined) {
      settings.keys = { ...settings.keys, ...result[STORAGE_PREFIX + 'keys'] };
    }
  }

  function loadSettings() {
    chrome.storage.local.get(
      {
        [STORAGE_PREFIX + 'enabled']: true,
        [STORAGE_PREFIX + 'delay']: 600,
        [STORAGE_PREFIX + 'keys']: { ArrowRight: true, KeyL: true }
      },
      (localResult) => {
        applyLocalItems(localResult);
        chrome.storage.sync.get({ [MASTER_KEY]: true }, (syncResult) => {
          applyLocalItems(syncResult);
        });
      }
    );
  }

  loadSettings();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[MASTER_KEY]) {
      masterEnabled = changes[MASTER_KEY].newValue !== false;
    }
    if (area === 'local') {
      if (changes[STORAGE_PREFIX + 'enabled']) {
        settings.enabled = changes[STORAGE_PREFIX + 'enabled'].newValue;
      }
      if (changes[STORAGE_PREFIX + 'delay']) {
        settings.delay = changes[STORAGE_PREFIX + 'delay'].newValue;
      }
      if (changes[STORAGE_PREFIX + 'keys']) {
        settings.keys = { ...settings.keys, ...changes[STORAGE_PREFIX + 'keys'].newValue };
      }
    }
  });

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

  function findJumpAheadButton() {
    const badges = document.querySelectorAll('.ytp-suggested-action-badge');
    for (const badge of badges) {
      if (badge.textContent && badge.textContent.toLowerCase().includes('jump ahead')) {
        return badge;
      }
    }

    const containers = document.querySelectorAll('.ytp-suggested-action');
    for (const container of containers) {
      if (container.textContent && container.textContent.toLowerCase().includes('jump ahead')) {
        const btn = container.querySelector('button') || container.querySelector('.ytp-suggested-action-badge');
        if (btn) return btn;
      }
    }

    const player = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
    if (player) {
      const buttons = player.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent && btn.textContent.toLowerCase().includes('jump ahead')) {
          return btn;
        }
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
      chrome.runtime.sendMessage({ action: 'skipit.jump_triggered' }, () => {
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

    chrome.storage.local.get(
      { [STORAGE_PREFIX + 'jumpsCount']: 0, [STORAGE_PREFIX + 'timeSaved']: 0 },
      (data) => {
        const newCount = (data[STORAGE_PREFIX + 'jumpsCount'] || 0) + 1;
        const newTimeSaved = (data[STORAGE_PREFIX + 'timeSaved'] || 0) + 25;
        chrome.storage.local.set({
          [STORAGE_PREFIX + 'jumpsCount']: newCount,
          [STORAGE_PREFIX + 'timeSaved']: newTimeSaved
        });
      }
    );
  }

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
        if (skipPressCount === 1) {
          const jumpButton = findJumpAheadButton();
          if (jumpButton && isElementVisible(jumpButton)) {
            triggerJump(jumpButton);
          }
        }
        skipPressCount = 0;
      }, settings.delay);
    } else {
      if (skipTimer) clearTimeout(skipTimer);
    }
  }, true);
})();
