// Hosts the onboarding guide above the native YouTube page.

(() => {
  'use strict';

  const OVERLAY_ID = 'youtube-toolkit-onboarding-overlay';
  const PENDING_KEY = 'toolkit.onboardingPending';
  let overlay = null;
  let frame = null;

  function closeOnboarding() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    frame = null;
  }

  function showOnboarding() {
    if (overlay && overlay.isConnected) {
      frame?.focus();
      return;
    }

    overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'YouTube Toolkit guide');
    Object.assign(overlay.style, {
      all: 'initial',
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      display: 'block',
      width: '100vw',
      height: '100vh',
      background: 'rgba(0, 0, 0, 0.12)',
      isolation: 'isolate'
    });

    frame = document.createElement('iframe');
    frame.src = chrome.runtime.getURL('onboarding/onboarding.html?overlay=1');
    frame.title = 'YouTube Toolkit guide';
    frame.setAttribute('allow', 'clipboard-read; clipboard-write');
    Object.assign(frame.style, {
      display: 'block',
      width: '100%',
      height: '100%',
      border: '0',
      background: 'transparent',
      colorScheme: 'dark'
    });
    frame.addEventListener('load', () => frame?.focus(), { once: true });

    overlay.appendChild(frame);
    document.documentElement.appendChild(overlay);
  }

  window.addEventListener('message', (event) => {
    if (!frame || event.source !== frame.contentWindow) return;
    if (event.data?.type === 'youtube-toolkit.close-onboarding') closeOnboarding();
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.action !== 'toolkit.show_onboarding') return undefined;
    showOnboarding();
    sendResponse({ success: true });
    return false;
  });

  chrome.storage.local.get(PENDING_KEY, (items) => {
    if (!items[PENDING_KEY]) return;
    chrome.storage.local.remove(PENDING_KEY, () => showOnboarding());
  });
})();
