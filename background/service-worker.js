// Extension lifecycle, onboarding, and serialized statistics updates.

'use strict';

const extensionApi = globalThis.browser || globalThis.chrome;
const ONBOARDING_PENDING_KEY = 'toolkit.onboardingPending';
const YOUTUBE_URL = 'https://www.youtube.com/';
const SKIPIT_PREFIX = 'skipit.';
const SKIPIT_SETTING_KEYS = ['enabled', 'delay', 'mediaGestureEnabled', 'mediaGestureWindow', 'keys'];
const JUMPS_KEY = SKIPIT_PREFIX + 'jumpsCount';
const TIME_SAVED_KEY = SKIPIT_PREFIX + 'timeSaved';

let statsUpdateQueue = Promise.resolve();

function isYouTubeTab(tab) {
  const url = String(tab?.url || tab?.pendingUrl || '');
  try {
    const { hostname } = new URL(url);
    return hostname === 'youtube.com' || hostname.endsWith('.youtube.com');
  } catch (error) {
    return false;
  }
}

async function getActiveBrowserTab() {
  try {
    if (extensionApi.windows?.getLastFocused) {
      const currentWindow = await extensionApi.windows.getLastFocused({
        populate: true,
        windowTypes: ['normal']
      });
      const activeTab = currentWindow?.tabs?.find((tab) => tab.active);
      if (activeTab) return activeTab;
    }
  } catch (error) {
    // Fall through to tabs.query when the windows API is unavailable.
  }

  if (!extensionApi.tabs?.query) return undefined;
  try {
    const [lastFocused] = await extensionApi.tabs.query({ active: true, lastFocusedWindow: true });
    if (lastFocused) return lastFocused;
  } catch (error) {}
  try {
    const [current] = await extensionApi.tabs.query({ active: true, currentWindow: true });
    return current;
  } catch (error) {
    return undefined;
  }
}

async function showOnboardingInTab(tab, source) {
  if (tab?.id === undefined) return false;

  try {
    const response = await extensionApi.tabs.sendMessage(tab.id, {
      action: 'toolkit.show_onboarding'
    });
    if (response?.success) return true;
  } catch (error) {
    // Overlay host is not injected in this tab yet.
  }

  await extensionApi.storage.local.set({
    [ONBOARDING_PENDING_KEY]: { source, requestedAt: Date.now() }
  });
  if (extensionApi.tabs.reload) await extensionApi.tabs.reload(tab.id);
  return true;
}

async function openOnboarding(source = 'manual') {
  const activeTab = await getActiveBrowserTab();
  if (isYouTubeTab(activeTab)) {
    await showOnboardingInTab(activeTab, source);
    return { reusedTab: true, tabId: activeTab.id };
  }

  await extensionApi.storage.local.set({
    [ONBOARDING_PENDING_KEY]: { source, requestedAt: Date.now() }
  });
  const tab = await extensionApi.tabs.create({ url: YOUTUBE_URL });
  return { reusedTab: false, tabId: tab.id };
}

async function migrateSkipitSettings() {
  const keys = SKIPIT_SETTING_KEYS.map((key) => SKIPIT_PREFIX + key);
  const [syncItems, localItems] = await Promise.all([
    extensionApi.storage.sync.get(keys),
    extensionApi.storage.local.get(keys)
  ]);
  const updates = {};

  for (const key of keys) {
    if (syncItems[key] === undefined && localItems[key] !== undefined) {
      updates[key] = localItems[key];
    }
  }

  if (Object.keys(updates).length > 0) {
    await extensionApi.storage.sync.set(updates);
  }
}

function recordSkipitJump(secondsSaved = 25) {
  const safeSeconds = Number.isFinite(Number(secondsSaved))
    ? Math.max(0, Math.round(Number(secondsSaved)))
    : 25;

  const update = statsUpdateQueue.then(async () => {
    const data = await extensionApi.storage.local.get({
      [JUMPS_KEY]: 0,
      [TIME_SAVED_KEY]: 0
    });
    const result = {
      [JUMPS_KEY]: (Number(data[JUMPS_KEY]) || 0) + 1,
      [TIME_SAVED_KEY]: (Number(data[TIME_SAVED_KEY]) || 0) + safeSeconds
    };
    await extensionApi.storage.local.set(result);
    return result;
  });

  statsUpdateQueue = update.catch(() => undefined);
  return update;
}

extensionApi.runtime.onInstalled.addListener((details) => {
  migrateSkipitSettings().catch((error) => {
    console.warn('YouTube Toolkit: SkipIt settings migration failed.', error);
  });

  if (details.reason === 'install') {
    openOnboarding('install').catch((error) => {
      console.warn('YouTube Toolkit: onboarding could not be opened.', error);
    });
  }
});

extensionApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.action !== 'string') return undefined;

  if (message.action === 'toolkit.open_onboarding') {
    openOnboarding('popup')
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: String(error) }));
    return true;
  }

  if (message.action === 'toolkit.open_popup') {
    if (!extensionApi.action?.openPopup) {
      sendResponse({ success: false, unsupported: true });
      return false;
    }
    const options = sender.tab?.windowId === undefined ? undefined : { windowId: sender.tab.windowId };
    const openPopup = options ? extensionApi.action.openPopup(options) : extensionApi.action.openPopup();
    openPopup
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: String(error) }));
    return true;
  }

  if (message.action === 'skipit.jump_triggered') {
    recordSkipitJump(message.secondsSaved)
      .then((stats) => sendResponse({ success: true, stats }))
      .catch((error) => sendResponse({ success: false, error: String(error) }));
    return true;
  }

  return undefined;
});
