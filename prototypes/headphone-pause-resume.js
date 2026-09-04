(() => {
  'use strict';

  const hand = document.getElementById('animated-hand');
  const rings = Array.from(document.querySelectorAll('.tap-ring'));
  const mediaState = document.getElementById('media-state');
  const stateIcon = document.getElementById('state-icon');
  const status = document.getElementById('animation-status');
  const pauseStep = document.getElementById('pause-step');
  const resumeStep = document.getElementById('resume-step');
  const replayButton = document.getElementById('replay-animation');
  const animationLayer = document.querySelector('.headphone-animation');
  const layoutValues = document.getElementById('layout-values');
  const tuningStatus = document.getElementById('tuning-status');
  const saveLayoutButton = document.getElementById('save-layout');
  const resetLayoutButton = document.getElementById('reset-layout');
  const timers = [];
  let runId = 0;

  const STORAGE_KEY = 'headphone-prototype-layout';
  const DEFAULT_LAYOUT = {
    headphonesSize: 340,
    headphonesX: 50,
    headphonesY: 49,
    handSize: 370,
    handX: 66,
    handY: 31,
    handAngle: 8,
    tapX: 71,
    tapY: 60
  };
  let layout = { ...DEFAULT_LAYOUT };

  const controls = {
    headphonesSize: document.getElementById('headphones-size'),
    headphonesX: document.getElementById('headphones-x'),
    headphonesY: document.getElementById('headphones-y'),
    handSize: document.getElementById('hand-size'),
    handX: document.getElementById('hand-x'),
    handY: document.getElementById('hand-y'),
    handAngle: document.getElementById('hand-angle'),
    tapX: document.getElementById('tap-x'),
    tapY: document.getElementById('tap-y')
  };

  const valueOutputs = {
    headphonesSize: document.getElementById('headphones-size-value'),
    headphonesX: document.getElementById('headphones-x-value'),
    headphonesY: document.getElementById('headphones-y-value'),
    handSize: document.getElementById('hand-size-value'),
    handX: document.getElementById('hand-x-value'),
    handY: document.getElementById('hand-y-value'),
    handAngle: document.getElementById('hand-angle-value'),
    tapX: document.getElementById('tap-x-value'),
    tapY: document.getElementById('tap-y-value')
  };

  function later(callback, delay, id) {
    timers.push(setTimeout(() => {
      if (id === runId) callback();
    }, delay));
  }

  function clearSequence() {
    timers.splice(0).forEach(clearTimeout);
    hand.getAnimations().forEach((animation) => animation.cancel());
    rings.forEach((ring) => ring.getAnimations().forEach((animation) => animation.cancel()));
  }

  function setMediaState(state) {
    const paused = state === 'paused';
    mediaState.dataset.state = state;
    stateIcon.textContent = paused ? 'Ⅱ' : '▶';
    status.textContent = paused ? 'Paused' : 'Playing';
  }

  function angleTransform(offset) {
    return `translateX(${offset}px) rotate(${layout.handAngle}deg)`;
  }

  function approachHand() {
    hand.animate([
      { transform: angleTransform(76), opacity: 0 },
      { transform: angleTransform(22), opacity: 1 }
    ], { duration: 500, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
  }

  function tap(index) {
    hand.animate([
      { transform: angleTransform(22), opacity: 1 },
      { transform: angleTransform(6), opacity: 1, offset: .45 },
      { transform: angleTransform(22), opacity: 1 }
    ], { duration: 220, easing: 'ease-in-out', fill: 'forwards' });

    rings[index].animate([
      { transform: 'scale(.65)', opacity: .95 },
      { transform: 'scale(2.25)', opacity: 0 }
    ], { duration: 360, easing: 'ease-out' });
  }

  function retractHand() {
    hand.animate([
      { transform: angleTransform(22), opacity: 1 },
      { transform: angleTransform(76), opacity: 0 }
    ], { duration: 420, easing: 'ease-in', fill: 'forwards' });
  }

  function playSequence() {
    clearSequence();
    runId += 1;
    const id = runId;
    hand.style.opacity = '0';
    hand.style.transform = angleTransform(76);
    setMediaState('playing');
    pauseStep.className = 'sequence-step is-active';
    resumeStep.className = 'sequence-step';

    later(approachHand, 500, id);
    later(() => tap(0), 1120, id);
    later(() => tap(1), 1460, id);
    later(() => {
      setMediaState('paused');
      pauseStep.className = 'sequence-step is-done';
      resumeStep.className = 'sequence-step is-active';
      retractHand();
    }, 1810, id);

    later(approachHand, 2850, id);
    later(() => tap(0), 3470, id);
    later(() => tap(1), 3810, id);
    later(() => {
      setMediaState('playing');
      resumeStep.className = 'sequence-step is-done';
      retractHand();
    }, 4160, id);

    later(playSequence, 5700, id);
  }

  function formatValue(key, value) {
    if (key.endsWith('Size')) return `${value}px`;
    if (key === 'handAngle') return `${value}°`;
    return `${value}%`;
  }

  function applyLayout(editing = false) {
    animationLayer.style.setProperty('--headphones-size', `${layout.headphonesSize}px`);
    animationLayer.style.setProperty('--headphones-x', `${layout.headphonesX}%`);
    animationLayer.style.setProperty('--headphones-y', `${layout.headphonesY}%`);
    animationLayer.style.setProperty('--hand-size', `${layout.handSize}px`);
    animationLayer.style.setProperty('--hand-x', `${layout.handX}%`);
    animationLayer.style.setProperty('--hand-y', `${layout.handY}%`);
    animationLayer.style.setProperty('--tap-x', `${layout.tapX}%`);
    animationLayer.style.setProperty('--tap-y', `${layout.tapY}%`);

    for (const [key, control] of Object.entries(controls)) {
      control.value = layout[key];
      valueOutputs[key].textContent = formatValue(key, layout[key]);
    }

    layoutValues.textContent = `Headphones ${layout.headphonesSize}px @ ${layout.headphonesX}%, ${layout.headphonesY}% · Hand ${layout.handSize}px @ ${layout.handX}%, ${layout.handY}% · ${layout.handAngle}° · Tap ${layout.tapX}%, ${layout.tapY}%`;

    if (editing) {
      clearSequence();
      runId += 1;
      hand.style.opacity = '1';
      hand.style.transform = angleTransform(6);
      rings[0].style.opacity = '.8';
      rings[0].style.transform = 'scale(1)';
      rings[1].style.opacity = '0';
      tuningStatus.textContent = 'Editing pose — Replay to test';
    }
  }

  function readHashLayout() {
    if (!window.location.hash.startsWith('#layout=')) return null;
    try {
      return JSON.parse(decodeURIComponent(window.location.hash.slice(8)));
    } catch (error) {
      return null;
    }
  }

  function loadSavedLayout() {
    const hashLayout = readHashLayout();
    if (hashLayout) return hashLayout;
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null;
    } catch (error) {
      return null;
    }
  }

  Object.entries(controls).forEach(([key, control]) => {
    control.addEventListener('input', () => {
      layout[key] = Number(control.value);
      applyLayout(true);
    });
  });

  saveLayoutButton.addEventListener('click', () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch (error) {}
    history.replaceState(null, '', `#layout=${encodeURIComponent(JSON.stringify(layout))}`);
    tuningStatus.textContent = 'Saved — tell me to make it permanent';
  });

  resetLayoutButton.addEventListener('click', () => {
    layout = { ...DEFAULT_LAYOUT };
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {}
    history.replaceState(null, '', window.location.pathname + window.location.search);
    applyLayout(true);
    tuningStatus.textContent = 'Reset to defaults';
  });

  replayButton.addEventListener('click', () => {
    rings.forEach((ring) => {
      ring.style.opacity = '0';
      ring.style.transform = '';
    });
    tuningStatus.textContent = 'Playing current pose';
    playSequence();
  });
  layout = { ...DEFAULT_LAYOUT, ...(loadSavedLayout() || {}) };
  applyLayout();
  playSequence();
})();
