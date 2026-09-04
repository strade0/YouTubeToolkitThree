// Extension popup settings controller.

document.addEventListener('DOMContentLoaded', () => {
  const MASTER_KEY = 'toolkit.masterEnabled';
  const VOLUME_PREFIX = 'volume.';
  const TRIMMER_PREFIX = 'trimmer.';
  const SKIPIT_PREFIX = 'skipit.';
  const SPEED_PREFIX = 'speed.';

  const VOLUME_DEFAULTS = {
    enabled: true,
    sensitivity: 60,
    dragTrigger: 'left',
    hudStyle: 'wave',
    showIcon: null,
    showWaveform: null,
    showPercentage: null,
    followCursor: true
  };

  const TRIMMER_DEFAULTS = {
    enabled: true,
    maxWidth: 2000,
    sidebarWidth: 500
  };

  const SKIPIT_DEFAULTS = {
    enabled: true,
    delay: 600,
    mediaGestureEnabled: true,
    mediaGestureWindow: 1000,
    keys: { ArrowRight: true, KeyL: true }
  };

  const SPEED_DEFAULTS = {
    enabled: true,
    targetSpeed: 2.0
  };

  let masterEnabled = true;
  let volumeConfig = { ...VOLUME_DEFAULTS };
  let trimmerConfig = { ...TRIMMER_DEFAULTS };
  let skipitConfig = { ...SKIPIT_DEFAULTS };
  let speedConfig = { ...SPEED_DEFAULTS };
  let sensitivitySaveTimer = null;

  function openOnboarding() {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ action: 'toolkit.open_onboarding' }, (response) => {
        if (chrome.runtime.lastError || !response || !response.success) {
          console.warn('YouTube Toolkit: the guide could not be opened.');
          return;
        }
        window.close();
      });
    }
  }

  const onboardingButton = document.getElementById('open-onboarding');
  if (onboardingButton) {
    onboardingButton.addEventListener('click', openOnboarding);
  }

  function prefixKeys(prefix, obj) {
    const out = {};
    for (const [key, value] of Object.entries(obj)) {
      out[prefix + key] = value;
    }
    return out;
  }

  function unprefix(prefix, items, defaults) {
    const out = { ...defaults };
    for (const key of Object.keys(defaults)) {
      const prefixed = prefix + key;
      if (items[prefixed] !== undefined) {
        out[key] = items[prefixed];
      }
    }
    return out;
  }

  function saveSync(updates, callback) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set(updates, () => {
        if (chrome.runtime.lastError) {
          console.warn('YouTube Toolkit: settings could not be saved.', chrome.runtime.lastError.message);
        }
        if (callback) callback(!chrome.runtime.lastError);
      });
    } else if (callback) {
      callback(false);
    }
  }

  function sendToActiveTab(message) {
    if (typeof chrome === 'undefined' || !chrome.tabs) return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, message, () => {
          if (chrome.runtime.lastError) {
            // Ignore when the active tab is not YouTube.
          }
        });
      }
    });
  }

  function setDisabled(el, disabled) {
    if (!el) return;
    el.classList.toggle('is-disabled', disabled);
  }

  function updateDisabledStates() {
    document.body.classList.toggle('toolkit-off', !masterEnabled);
    setDisabled(document.getElementById('volume-controls'), !volumeConfig.enabled);
    setDisabled(document.getElementById('trimmer-controls'), !trimmerConfig.enabled);
    setDisabled(document.getElementById('skipit-controls'), !skipitConfig.enabled);
    setDisabled(document.getElementById('speed-controls'), !speedConfig.enabled);
  }

  // Tabs
  const tabs = Array.from(document.querySelectorAll('.tab'));
  const panels = document.querySelectorAll('.panel');

  function activateTab(tab, moveFocus = false) {
    const id = tab.dataset.tab;
    tabs.forEach((item) => {
      const active = item === tab;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', active ? 'true' : 'false');
      item.tabIndex = active ? 0 : -1;
    });
    panels.forEach((panel) => {
      panel.classList.toggle('active', panel.id === `panel-${id}`);
    });
    if (moveFocus) tab.focus();
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => activateTab(tab));
    tab.addEventListener('keydown', (event) => {
      const index = tabs.indexOf(tab);
      let nextIndex = null;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = tabs.length - 1;
      if (nextIndex !== null) {
        event.preventDefault();
        activateTab(tabs[nextIndex], true);
      }
    });
  });

  // Master
  const masterToggle = document.getElementById('master-toggle');
  masterToggle.addEventListener('change', () => {
    masterEnabled = masterToggle.checked;
    saveSync({ [MASTER_KEY]: masterEnabled });
    updateDisabledStates();
  });

  // ----- Volume -----
  const volumeEnabled = document.getElementById('volume-enabled');
  const sensitivitySlider = document.getElementById('sensitivity-slider');
  const sensitivityValue = document.getElementById('sensitivity-value');
  const triggerSelect = document.getElementById('trigger-select');
  const hudShowIcon = document.getElementById('hud-show-icon');
  const hudShowWaveform = document.getElementById('hud-show-waveform');
  const hudShowPercentage = document.getElementById('hud-show-percentage');
  const hudPreviewIcon = document.getElementById('hud-preview-icon');
  const hudPreviewWaveform = document.getElementById('hud-preview-waveform');
  const hudPreviewPercentage = document.getElementById('hud-preview-percentage');
  const hudPreviewTop = document.getElementById('hud-preview-top');
  const followCursorToggle = document.getElementById('volume-follow-cursor');

  function normalizeVolumeConfig(config) {
    const legacyVisible = config.hudStyle !== 'minimal';
    if (typeof config.showIcon !== 'boolean') config.showIcon = legacyVisible;
    if (typeof config.showWaveform !== 'boolean') config.showWaveform = legacyVisible;
    if (typeof config.showPercentage !== 'boolean') config.showPercentage = legacyVisible;
    return config;
  }

  function renderHudPreview() {
    hudPreviewIcon.hidden = !volumeConfig.showIcon;
    hudPreviewWaveform.hidden = !volumeConfig.showWaveform;
    hudPreviewPercentage.hidden = !volumeConfig.showPercentage;
    hudPreviewTop.hidden = !volumeConfig.showWaveform && !volumeConfig.showPercentage;
  }

  function renderVolume() {
    volumeEnabled.checked = volumeConfig.enabled;
    sensitivitySlider.value = volumeConfig.sensitivity;
    sensitivityValue.textContent = `${volumeConfig.sensitivity}%`;
    triggerSelect.value = volumeConfig.dragTrigger;
    hudShowIcon.checked = volumeConfig.showIcon;
    hudShowWaveform.checked = volumeConfig.showWaveform;
    hudShowPercentage.checked = volumeConfig.showPercentage;
    renderHudPreview();
    if (followCursorToggle) {
      followCursorToggle.checked = volumeConfig.followCursor !== false;
    }
  }

  function saveVolume(key, value) {
    volumeConfig[key] = value;
    saveSync({ [VOLUME_PREFIX + key]: value });
  }

  function queueSensitivitySave(value) {
    volumeConfig.sensitivity = value;
    if (sensitivitySaveTimer) clearTimeout(sensitivitySaveTimer);
    sensitivitySaveTimer = setTimeout(() => {
      sensitivitySaveTimer = null;
      saveSync({ [VOLUME_PREFIX + 'sensitivity']: volumeConfig.sensitivity });
    }, 200);
  }

  function flushSensitivitySave() {
    if (sensitivitySaveTimer) {
      clearTimeout(sensitivitySaveTimer);
      sensitivitySaveTimer = null;
    }
    saveSync({ [VOLUME_PREFIX + 'sensitivity']: volumeConfig.sensitivity });
  }

  volumeEnabled.addEventListener('change', (e) => {
    saveVolume('enabled', e.target.checked);
    updateDisabledStates();
  });
  sensitivitySlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    sensitivityValue.textContent = `${val}%`;
    queueSensitivitySave(val);
  });
  sensitivitySlider.addEventListener('change', flushSensitivitySave);
  triggerSelect.addEventListener('change', (e) => saveVolume('dragTrigger', e.target.value));
  [
    [hudShowIcon, 'showIcon'],
    [hudShowWaveform, 'showWaveform'],
    [hudShowPercentage, 'showPercentage']
  ].forEach(([toggle, key]) => {
    toggle.addEventListener('change', () => {
      saveVolume(key, toggle.checked);
      renderHudPreview();
    });
  });
  if (followCursorToggle) {
    followCursorToggle.addEventListener('change', (e) => {
      saveVolume('followCursor', e.target.checked);
    });
  }

  // ----- Trimmer -----
  const trimmerEnabled = document.getElementById('trimmer-enabled');
  const widthSlider = document.getElementById('width-slider');
  const widthNumber = document.getElementById('width-number');
  const btnMinus = document.getElementById('btn-step-minus');
  const btnPlus = document.getElementById('btn-step-plus');
  const sidebarSlider = document.getElementById('sidebar-slider');
  const sidebarNumber = document.getElementById('sidebar-number');
  const btnSidebarMinus = document.getElementById('btn-sidebar-minus');
  const btnSidebarPlus = document.getElementById('btn-sidebar-plus');
  const btnTrimmerReset = document.getElementById('btn-trimmer-reset');

  function saveTrimmer(updates) {
    trimmerConfig = { ...trimmerConfig, ...updates };
    saveSync(prefixKeys(TRIMMER_PREFIX, updates));
  }

  function renderTrimmer() {
    trimmerEnabled.checked = trimmerConfig.enabled;
    widthSlider.value = trimmerConfig.maxWidth;
    widthNumber.value = trimmerConfig.maxWidth;
    const sidebarW = trimmerConfig.sidebarWidth || 500;
    sidebarSlider.value = sidebarW;
    sidebarNumber.value = sidebarW;
  }

  function applyWidth(newWidth, isLiveOnly = false) {
    newWidth = Math.max(960, Math.min(2560, newWidth));
    trimmerConfig.maxWidth = newWidth;
    widthSlider.value = newWidth;
    widthNumber.value = newWidth;
    sendToActiveTab({
      action: 'trimmer.SET_WIDTH',
      maxWidth: newWidth,
      enabled: trimmerConfig.enabled
    });
    if (!isLiveOnly) {
      saveTrimmer({ maxWidth: newWidth });
    }
  }

  function applySidebarWidth(newWidth, isLiveOnly = false) {
    newWidth = Math.max(200, Math.min(800, newWidth));
    trimmerConfig.sidebarWidth = newWidth;
    sidebarSlider.value = newWidth;
    sidebarNumber.value = newWidth;
    sendToActiveTab({
      action: 'trimmer.SET_SIDEBAR_WIDTH',
      sidebarWidth: newWidth
    });
    if (!isLiveOnly) {
      saveTrimmer({ sidebarWidth: newWidth });
    }
  }

  function broadcastTrimmer() {
    sendToActiveTab({ action: 'trimmer.UPDATE_CONFIG', config: trimmerConfig });
  }

  trimmerEnabled.addEventListener('change', () => {
    saveTrimmer({ enabled: trimmerEnabled.checked });
    broadcastTrimmer();
    updateDisabledStates();
  });
  widthSlider.addEventListener('input', (e) => applyWidth(parseInt(e.target.value, 10), true));
  widthSlider.addEventListener('change', (e) => applyWidth(parseInt(e.target.value, 10), false));
  widthNumber.addEventListener('change', (e) => {
    let val = parseInt(e.target.value, 10);
    if (isNaN(val)) val = 2000;
    applyWidth(val, false);
  });
  btnMinus.addEventListener('click', () => applyWidth(trimmerConfig.maxWidth - 50, false));
  btnPlus.addEventListener('click', () => applyWidth(trimmerConfig.maxWidth + 50, false));
  sidebarSlider.addEventListener('input', (e) => applySidebarWidth(parseInt(e.target.value, 10), true));
  sidebarSlider.addEventListener('change', (e) => applySidebarWidth(parseInt(e.target.value, 10), false));
  sidebarNumber.addEventListener('change', (e) => {
    let val = parseInt(e.target.value, 10);
    if (isNaN(val)) val = 500;
    applySidebarWidth(val, false);
  });
  btnSidebarMinus.addEventListener('click', () => applySidebarWidth((trimmerConfig.sidebarWidth || 500) - 20, false));
  btnSidebarPlus.addEventListener('click', () => applySidebarWidth((trimmerConfig.sidebarWidth || 500) + 20, false));
  btnTrimmerReset.addEventListener('click', () => {
    trimmerConfig = { ...TRIMMER_DEFAULTS };
    renderTrimmer();
    saveSync(prefixKeys(TRIMMER_PREFIX, TRIMMER_DEFAULTS));
    broadcastTrimmer();
    updateDisabledStates();
  });

  // ----- SkipIt -----
  const skipitEnabled = document.getElementById('skipit-enabled');
  const jumpsStat = document.getElementById('stat-jumps');
  const timeStat = document.getElementById('stat-time');
  const delaySlider = document.getElementById('delay-slider');
  const delayValue = document.getElementById('delay-value');
  const mediaGestureEnabled = document.getElementById('media-gesture-enabled');
  const mediaGestureWindow = document.getElementById('media-gesture-window');
  const mediaGestureWindowValue = document.getElementById('media-gesture-window-value');
  const keyArrow = document.getElementById('key-arrow');
  const keyL = document.getElementById('key-l');

  function formatTime(seconds) {
    if (!seconds || seconds <= 0) return '0s';
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) {
      return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  function formatDelay(ms) {
    if (ms >= 1000) return `${parseFloat((ms / 1000).toFixed(2))}s`;
    return `${ms}ms`;
  }

  function renderSkipit() {
    skipitEnabled.checked = skipitConfig.enabled;
    delaySlider.value = skipitConfig.delay;
    delayValue.textContent = formatDelay(skipitConfig.delay);
    mediaGestureEnabled.checked = skipitConfig.mediaGestureEnabled;
    mediaGestureWindow.value = skipitConfig.mediaGestureWindow;
    mediaGestureWindowValue.textContent = formatDelay(skipitConfig.mediaGestureWindow);
    mediaGestureWindow.disabled = !skipitConfig.mediaGestureEnabled;
    keyArrow.checked = skipitConfig.keys.ArrowRight;
    keyL.checked = skipitConfig.keys.KeyL;
  }

  function saveSkipit() {
    skipitConfig = {
      enabled: skipitEnabled.checked,
      delay: parseInt(delaySlider.value, 10),
      mediaGestureEnabled: mediaGestureEnabled.checked,
      mediaGestureWindow: parseInt(mediaGestureWindow.value, 10),
      keys: {
        ArrowRight: keyArrow.checked,
        KeyL: keyL.checked
      }
    };
    mediaGestureWindow.disabled = !skipitConfig.mediaGestureEnabled;
    saveSync(prefixKeys(SKIPIT_PREFIX, skipitConfig));
    updateDisabledStates();
  }

  function updateStatsDisplay() {
    chrome.storage.local.get(
      { [SKIPIT_PREFIX + 'jumpsCount']: 0, [SKIPIT_PREFIX + 'timeSaved']: 0 },
      (data) => {
        jumpsStat.textContent = (data[SKIPIT_PREFIX + 'jumpsCount'] || 0).toLocaleString();
        timeStat.textContent = formatTime(data[SKIPIT_PREFIX + 'timeSaved'] || 0);
      }
    );
  }

  skipitEnabled.addEventListener('change', saveSkipit);
  delaySlider.addEventListener('input', (e) => {
    delayValue.textContent = formatDelay(parseInt(e.target.value, 10));
  });
  delaySlider.addEventListener('change', saveSkipit);
  mediaGestureEnabled.addEventListener('change', saveSkipit);
  mediaGestureWindow.addEventListener('input', (e) => {
    mediaGestureWindowValue.textContent = formatDelay(parseInt(e.target.value, 10));
  });
  mediaGestureWindow.addEventListener('change', saveSkipit);
  keyArrow.addEventListener('change', () => {
    if (!keyArrow.checked && !keyL.checked) {
      keyArrow.checked = true;
      return;
    }
    saveSkipit();
  });
  keyL.addEventListener('change', () => {
    if (!keyArrow.checked && !keyL.checked) {
      keyL.checked = true;
      return;
    }
    saveSkipit();
  });
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (changes[SKIPIT_PREFIX + 'jumpsCount'] || changes[SKIPIT_PREFIX + 'timeSaved'])) {
        updateStatsDisplay();
      }
    });
  }

  // ----- Speed -----
  const speedEnabled = document.getElementById('speed-enabled');
  const speedTargetSelect = document.getElementById('speed-target-select');
  const speedOnboardingButton = document.getElementById('speed-open-onboarding');
  const speedVersionEl = document.getElementById('speed-version');
  if (speedVersionEl && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
    speedVersionEl.textContent = `v${chrome.runtime.getManifest().version}`;
  }

  function renderSpeed() {
    if (speedEnabled) speedEnabled.checked = speedConfig.enabled;
    if (speedTargetSelect) speedTargetSelect.value = String(speedConfig.targetSpeed || 2);
  }

  function saveSpeed(key, value) {
    speedConfig[key] = value;
    saveSync({ [SPEED_PREFIX + key]: value });
  }

  if (speedEnabled) {
    speedEnabled.addEventListener('change', (e) => {
      saveSpeed('enabled', e.target.checked);
      updateDisabledStates();
    });
  }

  if (speedTargetSelect) {
    speedTargetSelect.addEventListener('change', (e) => {
      saveSpeed('targetSpeed', parseFloat(e.target.value) || 2.0);
    });
  }

  if (speedOnboardingButton) {
    speedOnboardingButton.addEventListener('click', openOnboarding);
  }

  // Load
  function init() {
    const syncDefaults = {
      [MASTER_KEY]: true,
      ...prefixKeys(VOLUME_PREFIX, VOLUME_DEFAULTS),
      ...prefixKeys(TRIMMER_PREFIX, TRIMMER_DEFAULTS),
      ...prefixKeys(SKIPIT_PREFIX, SKIPIT_DEFAULTS),
      ...prefixKeys(SPEED_PREFIX, SPEED_DEFAULTS)
    };

    const apply = () => {
      volumeConfig = normalizeVolumeConfig(volumeConfig);
      masterToggle.checked = masterEnabled;
      renderVolume();
      renderTrimmer();
      renderSkipit();
      renderSpeed();
      updateStatsDisplay();
      updateDisabledStates();
    };

    if (typeof chrome === 'undefined' || !chrome.storage) {
      apply();
      return;
    }

    chrome.storage.sync.get(syncDefaults, (syncItems) => {
      masterEnabled = syncItems[MASTER_KEY] !== false;
      volumeConfig = normalizeVolumeConfig(unprefix(VOLUME_PREFIX, syncItems, VOLUME_DEFAULTS));
      trimmerConfig = unprefix(TRIMMER_PREFIX, syncItems, TRIMMER_DEFAULTS);
      skipitConfig = unprefix(SKIPIT_PREFIX, syncItems, SKIPIT_DEFAULTS);
      speedConfig = unprefix(SPEED_PREFIX, syncItems, SPEED_DEFAULTS);
      apply();
    });
  }

  init();
});
