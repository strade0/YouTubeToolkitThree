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
    hudStyle: 'wave'
  };

  const TRIMMER_DEFAULTS = {
    enabled: true,
    maxWidth: 1440,
    sidebarWidth: 320,
    align: 'center',
    allPages: false,
    trimTheater: false,
    showHud: false,
    enableHotkeys: true
  };

  const SKIPIT_DEFAULTS = {
    enabled: true,
    delay: 600,
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

  const versionEl = document.getElementById('extension-version');
  if (versionEl && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
    versionEl.textContent = `v${chrome.runtime.getManifest().version}`;
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

  function saveSync(updates) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set(updates);
    }
  }

  function saveLocal(updates) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set(updates);
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
    updateSkipitStatus();
  }

  // Tabs
  const tabs = document.querySelectorAll('.tab');
  const panels = document.querySelectorAll('.panel');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const id = tab.dataset.tab;
      tabs.forEach((t) => {
        t.classList.toggle('active', t === tab);
        t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      });
      panels.forEach((panel) => {
        panel.classList.toggle('active', panel.id === `panel-${id}`);
      });
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
  const styleSelect = document.getElementById('style-select');
  const previewWaves = document.getElementById('preview-waves');

  function renderVolume() {
    volumeEnabled.checked = volumeConfig.enabled;
    sensitivitySlider.value = volumeConfig.sensitivity;
    sensitivityValue.textContent = `${volumeConfig.sensitivity}%`;
    triggerSelect.value = volumeConfig.dragTrigger;
    styleSelect.value = volumeConfig.hudStyle;
    if (previewWaves) {
      previewWaves.style.display = volumeConfig.hudStyle === 'minimal' ? 'none' : 'flex';
    }
  }

  function saveVolume(key, value) {
    volumeConfig[key] = value;
    saveSync({ [VOLUME_PREFIX + key]: value });
  }

  volumeEnabled.addEventListener('change', (e) => {
    saveVolume('enabled', e.target.checked);
    updateDisabledStates();
  });
  sensitivitySlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    sensitivityValue.textContent = `${val}%`;
    saveVolume('sensitivity', val);
  });
  triggerSelect.addEventListener('change', (e) => saveVolume('dragTrigger', e.target.value));
  styleSelect.addEventListener('change', (e) => {
    saveVolume('hudStyle', e.target.value);
    renderVolume();
  });

  // ----- Trimmer -----
  const trimmerEnabled = document.getElementById('trimmer-enabled');
  const widthSlider = document.getElementById('width-slider');
  const widthNumber = document.getElementById('width-number');
  const btnMinus = document.getElementById('btn-step-minus');
  const btnPlus = document.getElementById('btn-step-plus');
  const presetBtns = document.querySelectorAll('.preset-btn');
  const sidebarSlider = document.getElementById('sidebar-slider');
  const sidebarNumber = document.getElementById('sidebar-number');
  const btnSidebarMinus = document.getElementById('btn-sidebar-minus');
  const btnSidebarPlus = document.getElementById('btn-sidebar-plus');
  const sidebarPresetBtns = document.querySelectorAll('.sidebar-preset-btn');
  const alignBtns = document.querySelectorAll('.segment-btn');
  const toggleAllPages = document.getElementById('toggle-all-pages');
  const toggleTheater = document.getElementById('toggle-theater');
  const toggleHud = document.getElementById('toggle-hud');
  const btnTrimmerReset = document.getElementById('btn-trimmer-reset');

  function saveTrimmer(updates) {
    trimmerConfig = { ...trimmerConfig, ...updates };
    saveSync(prefixKeys(TRIMMER_PREFIX, updates));
  }

  function renderTrimmer() {
    trimmerEnabled.checked = trimmerConfig.enabled;
    widthSlider.value = trimmerConfig.maxWidth;
    widthNumber.value = trimmerConfig.maxWidth;
    presetBtns.forEach((btn) => {
      btn.classList.toggle('active', parseInt(btn.dataset.width, 10) === trimmerConfig.maxWidth);
    });
    const sidebarW = trimmerConfig.sidebarWidth || 320;
    sidebarSlider.value = sidebarW;
    sidebarNumber.value = sidebarW;
    sidebarPresetBtns.forEach((btn) => {
      btn.classList.toggle('active', parseInt(btn.dataset.sidebar, 10) === sidebarW);
    });
    alignBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.align === trimmerConfig.align);
    });
    toggleAllPages.checked = !!trimmerConfig.allPages;
    toggleTheater.checked = !!trimmerConfig.trimTheater;
    toggleHud.checked = !!trimmerConfig.showHud;
  }

  function applyWidth(newWidth, isLiveOnly = false) {
    newWidth = Math.max(960, Math.min(2560, newWidth));
    trimmerConfig.maxWidth = newWidth;
    widthSlider.value = newWidth;
    widthNumber.value = newWidth;
    presetBtns.forEach((btn) => {
      btn.classList.toggle('active', parseInt(btn.dataset.width, 10) === newWidth);
    });
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
    sidebarPresetBtns.forEach((btn) => {
      btn.classList.toggle('active', parseInt(btn.dataset.sidebar, 10) === newWidth);
    });
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
    if (isNaN(val)) val = 1440;
    applyWidth(val, false);
  });
  btnMinus.addEventListener('click', () => applyWidth(trimmerConfig.maxWidth - 50, false));
  btnPlus.addEventListener('click', () => applyWidth(trimmerConfig.maxWidth + 50, false));
  presetBtns.forEach((btn) => {
    btn.addEventListener('click', () => applyWidth(parseInt(btn.dataset.width, 10), false));
  });
  sidebarSlider.addEventListener('input', (e) => applySidebarWidth(parseInt(e.target.value, 10), true));
  sidebarSlider.addEventListener('change', (e) => applySidebarWidth(parseInt(e.target.value, 10), false));
  sidebarNumber.addEventListener('change', (e) => {
    let val = parseInt(e.target.value, 10);
    if (isNaN(val)) val = 320;
    applySidebarWidth(val, false);
  });
  btnSidebarMinus.addEventListener('click', () => applySidebarWidth((trimmerConfig.sidebarWidth || 320) - 20, false));
  btnSidebarPlus.addEventListener('click', () => applySidebarWidth((trimmerConfig.sidebarWidth || 320) + 20, false));
  sidebarPresetBtns.forEach((btn) => {
    btn.addEventListener('click', () => applySidebarWidth(parseInt(btn.dataset.sidebar, 10), false));
  });
  alignBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      saveTrimmer({ align: btn.dataset.align });
      renderTrimmer();
      broadcastTrimmer();
    });
  });
  toggleAllPages.addEventListener('change', () => {
    saveTrimmer({ allPages: toggleAllPages.checked });
    broadcastTrimmer();
  });
  toggleTheater.addEventListener('change', () => {
    saveTrimmer({ trimTheater: toggleTheater.checked });
    broadcastTrimmer();
  });
  toggleHud.addEventListener('change', () => {
    saveTrimmer({ showHud: toggleHud.checked });
    broadcastTrimmer();
  });
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
  const keyArrow = document.getElementById('key-arrow');
  const keyL = document.getElementById('key-l');
  const btnSkipitReset = document.getElementById('btn-skipit-reset');
  const radarContainer = document.getElementById('radar-container');
  const radarMessage = document.getElementById('radar-message');
  const skipitStatus = document.getElementById('skipit-status');
  let radarTimeout = null;

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
    keyArrow.checked = skipitConfig.keys.ArrowRight;
    keyL.checked = skipitConfig.keys.KeyL;
  }

  function updateSkipitStatus() {
    const active = masterEnabled && skipitConfig.enabled;
    if (!skipitStatus) return;
    if (active) {
      skipitStatus.innerHTML = '<span class="status-dot pulsing"></span>Active';
      radarMessage.textContent = 'Listening for skips...';
    } else {
      skipitStatus.innerHTML = '<span class="status-dot" style="background:#ef4444"></span>Disabled';
      radarMessage.textContent = 'Extension is inactive';
      radarContainer.classList.remove('pulsing');
    }
  }

  function saveSkipit() {
    skipitConfig = {
      enabled: skipitEnabled.checked,
      delay: parseInt(delaySlider.value, 10),
      keys: {
        ArrowRight: keyArrow.checked,
        KeyL: keyL.checked
      }
    };
    saveLocal(prefixKeys(SKIPIT_PREFIX, skipitConfig));
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

  function showRadarActivity(message, type) {
    if (radarTimeout) clearTimeout(radarTimeout);
    radarMessage.textContent = message;
    radarContainer.classList.remove('pulsing');
    radarContainer.style.background = 'rgba(0, 0, 0, 0.25)';
    radarContainer.style.borderColor = 'rgba(255, 255, 255, 0.1)';
    radarMessage.style.color = '';

    if (type === 'skip') {
      radarContainer.classList.add('pulsing');
      radarTimeout = setTimeout(() => {
        radarContainer.classList.remove('pulsing');
        if (masterEnabled && skipitConfig.enabled) {
          radarMessage.textContent = 'Listening for skips...';
        }
      }, 1500);
    } else if (type === 'jump') {
      radarMessage.style.color = '#10b981';
      radarTimeout = setTimeout(() => {
        radarMessage.style.color = '';
        if (masterEnabled && skipitConfig.enabled) {
          radarMessage.textContent = 'Listening for skips...';
        }
      }, 2000);
    }
  }

  skipitEnabled.addEventListener('change', saveSkipit);
  delaySlider.addEventListener('input', (e) => {
    delayValue.textContent = formatDelay(parseInt(e.target.value, 10));
  });
  delaySlider.addEventListener('change', saveSkipit);
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
  btnSkipitReset.addEventListener('click', () => {
    saveLocal({ [SKIPIT_PREFIX + 'jumpsCount']: 0, [SKIPIT_PREFIX + 'timeSaved']: 0 });
    updateStatsDisplay();
    showRadarActivity('Stats reset', 'jump');
  });

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (changes[SKIPIT_PREFIX + 'jumpsCount'] || changes[SKIPIT_PREFIX + 'timeSaved'])) {
        updateStatsDisplay();
      }
    });
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (!masterEnabled || !skipitConfig.enabled) return;
      if (message.action === 'skipit.skip_detected') {
        const keyName = message.key === ' ' ? 'Space' : message.key;
        showRadarActivity(`Skip detected (${keyName})`, 'skip');
      } else if (message.action === 'skipit.jump_triggered') {
        showRadarActivity('Jump Ahead auto-triggered', 'jump');
      }
    });
  }

  // ----- Speed -----
  const speedEnabled = document.getElementById('speed-enabled');
  const speedTargetSelect = document.getElementById('speed-target-select');
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

  // Load
  function init() {
    const syncDefaults = {
      [MASTER_KEY]: true,
      ...prefixKeys(VOLUME_PREFIX, VOLUME_DEFAULTS),
      ...prefixKeys(TRIMMER_PREFIX, TRIMMER_DEFAULTS),
      ...prefixKeys(SPEED_PREFIX, SPEED_DEFAULTS)
    };

    const apply = () => {
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
      volumeConfig = unprefix(VOLUME_PREFIX, syncItems, VOLUME_DEFAULTS);
      trimmerConfig = unprefix(TRIMMER_PREFIX, syncItems, TRIMMER_DEFAULTS);
      speedConfig = unprefix(SPEED_PREFIX, syncItems, SPEED_DEFAULTS);
      chrome.storage.local.get(prefixKeys(SKIPIT_PREFIX, SKIPIT_DEFAULTS), (localItems) => {
        skipitConfig = unprefix(SKIPIT_PREFIX, localItems, SKIPIT_DEFAULTS);
        apply();
      });
    });
  }

  init();
});
