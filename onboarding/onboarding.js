'use strict';

function createVolumePractice(reducedMotion, t, onComplete) {
  const player = document.getElementById('volume-practice');
  const fill = document.getElementById('practice-volume-fill');
  const value = document.getElementById('practice-volume-value');
  const cursor = document.getElementById('volume-cursor');
  const status = document.getElementById('volume-practice-status');
  let volume = 64;
  let dragging = false;
  let startX = 0;
  let startVolume = 64;
  let animationFrame = null;
  let animationTimer = null;
  let loopTimer = null;
  let dragDistance = 0;

  function setVolume(nextVolume) {
    volume = Math.max(0, Math.min(100, Math.round(nextVolume)));
    fill.style.transform = 'scaleX(' + (volume / 100) + ')';
    value.textContent = volume === 0 ? t('muted') : volume + '%';
    player.setAttribute('aria-valuenow', String(volume));
  }

  function stop() {
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    if (animationTimer !== null) clearTimeout(animationTimer);
    if (loopTimer !== null) clearTimeout(loopTimer);
    animationFrame = null;
    animationTimer = null;
    loopTimer = null;
    dragging = false;
    player.classList.remove('is-demonstrating', 'is-practising');
  }

  function playDemo() {
    stop();
    setVolume(28);
    cursor.style.left = '24%';
    if (reducedMotion) {
      setVolume(64);
      status.textContent = t('volumeTry');
      return;
    }

    player.classList.add('is-demonstrating');
    status.textContent = t('volumeWatch');
    const startedAt = performance.now();
    const pressDuration = 480;
    const duration = 2400;

    function completeDemo() {
      if (!player.classList.contains('is-demonstrating')) return;
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      if (animationTimer !== null) clearTimeout(animationTimer);
      animationFrame = null;
      animationTimer = null;
      setVolume(78);
      cursor.style.left = '74%';
      player.classList.remove('is-demonstrating');
      status.textContent = t('volumeYourTurn');
      loopTimer = setTimeout(playDemo, 1100);
    }

    function animate(now) {
      const elapsed = now - startedAt;
      const progress = Math.min(1, Math.max(0, (elapsed - pressDuration) / (duration - pressDuration)));
      const eased = 0.5 - Math.cos(progress * Math.PI) / 2;
      setVolume(28 + eased * 50);
      cursor.style.left = (24 + eased * 50) + '%';
      if (progress < 1) animationFrame = requestAnimationFrame(animate);
      else completeDemo();
    }

    animationFrame = requestAnimationFrame(animate);
    animationTimer = setTimeout(completeDemo, duration + 100);
  }

  player.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    stop();
    dragging = true;
    startX = event.clientX;
    startVolume = volume;
    dragDistance = 0;
    player.classList.add('is-practising');
    status.textContent = t('volumeHolding');
    try {
      player.setPointerCapture(event.pointerId);
    } catch (error) {}
    event.preventDefault();
  });

  player.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    dragDistance = Math.max(dragDistance, Math.abs(event.clientX - startX));
    const span = Math.max(180, player.clientWidth * 0.65);
    setVolume(startVolume + ((event.clientX - startX) / span) * 100);
    const rect = player.getBoundingClientRect();
    const cursorPercent = ((event.clientX - rect.left) / rect.width) * 100;
    cursor.style.left = Math.max(4, Math.min(92, cursorPercent)) + '%';
    event.preventDefault();
  });

  function finishDrag() {
    if (!dragging) return;
    dragging = false;
    player.classList.remove('is-practising');
    status.textContent = t('volumeSet', { volume });
    if (dragDistance >= 4) onComplete();
    loopTimer = setTimeout(playDemo, 1100);
  }

  player.addEventListener('pointerup', finishDrag);
  player.addEventListener('pointercancel', finishDrag);
  player.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    stop();
    setVolume(volume + (event.key === 'ArrowRight' ? 5 : -5));
    status.textContent = t('volumeValue', { volume });
    onComplete();
    loopTimer = setTimeout(playDemo, 1100);
  });

  setVolume(volume);
  return { start: playDemo, stop };
}

function createSpeedPractice(reducedMotion, t, onComplete) {
  const player = document.getElementById('speed-practice');
  const status = document.getElementById('speed-practice-status');
  const lockedRate = document.getElementById('practice-locked-rate');
  const pills = Array.from(player.querySelectorAll('.practice-speed-pill'));
  const centerPill = player.querySelector('.center-pill');
  let holding = false;
  let highlightedPill = null;
  let dwellTimer = null;
  let demoTimers = [];

  function clearTimers() {
    if (dwellTimer !== null) clearTimeout(dwellTimer);
    dwellTimer = null;
    demoTimers.forEach((timer) => clearTimeout(timer));
    demoTimers = [];
  }

  function highlight(pill) {
    highlightedPill = pill || null;
    pills.forEach((item) => item.classList.toggle('is-highlighted', item === pill));
  }

  function setLockedRate(rate) {
    lockedRate.textContent = rate;
    lockedRate.classList.add('is-visible');
  }

  function resetInteraction() {
    clearTimers();
    holding = false;
    highlight(null);
    player.classList.remove('is-demonstrating', 'is-holding', 'is-expanded');
  }

  function stop() {
    resetInteraction();
  }

  function playDemo() {
    resetInteraction();
    setLockedRate('1x');
    if (reducedMotion) {
      status.textContent = t('speedTry');
      return;
    }

    player.classList.add('is-demonstrating');
    status.textContent = t('speedHoldWatch');
    demoTimers.push(setTimeout(() => {
      player.classList.add('is-holding');
      status.textContent = t('speedPillAppears');
    }, 250));
    demoTimers.push(setTimeout(() => player.classList.add('is-expanded'), 760));
    demoTimers.push(setTimeout(() => {
      highlight(centerPill);
      status.textContent = t('speedReleaseLock');
    }, 1300));
    demoTimers.push(setTimeout(() => {
      setLockedRate('2x');
      holding = false;
      highlight(null);
      player.classList.remove('is-demonstrating', 'is-holding', 'is-expanded');
      status.textContent = t('speedYourTurn');
      demoTimers = [];
      demoTimers.push(setTimeout(playDemo, 1100));
    }, 2000));
  }

  function pillAtPoint(event) {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    return element && element.closest ? element.closest('.practice-speed-pill') : null;
  }

  player.addEventListener('pointerdown', (event) => {
    const directPill = event.target instanceof Element ? event.target.closest('.practice-speed-pill') : null;
    if (event.button !== 0 || directPill) return;
    resetInteraction();
    holding = true;
    player.classList.add('is-holding');
    status.textContent = t('speedHolding');
    dwellTimer = setTimeout(() => {
      dwellTimer = null;
      if (!holding) return;
      player.classList.add('is-expanded');
      status.textContent = t('speedOpen');
    }, 300);
    try {
      player.setPointerCapture(event.pointerId);
    } catch (error) {}
    event.preventDefault();
  });

  player.addEventListener('pointermove', (event) => {
    if (!holding) return;
    const pill = pillAtPoint(event);
    highlight(pill);
    if (pill) status.textContent = t('speedReleaseRate', { rate: pill.dataset.rate });
  });

  player.addEventListener('pointerup', (event) => {
    if (!holding) return;
    const selected = highlightedPill || pillAtPoint(event);
    holding = false;
    if (dwellTimer !== null) clearTimeout(dwellTimer);
    dwellTimer = null;
    player.classList.remove('is-holding', 'is-expanded');
    if (selected) {
      setLockedRate(selected.dataset.rate + 'x');
      status.textContent = t('speedSuccess', { rate: selected.dataset.rate });
      onComplete();
    } else {
      status.textContent = t('speedAlmost');
    }
    highlight(null);
    demoTimers.push(setTimeout(playDemo, 1100));
  });

  player.addEventListener('pointercancel', () => {
    resetInteraction();
    status.textContent = t('speedTryAgain');
    demoTimers.push(setTimeout(playDemo, 1100));
  });
  player.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    resetInteraction();
    setLockedRate('2x');
    status.textContent = t('speedSuccess', { rate: '2' });
    onComplete();
    demoTimers.push(setTimeout(playDemo, 1100));
  });

  return { start: playDemo, stop };
}

function createHeadphoneDemo(reducedMotion, t) {
  const hand = document.getElementById('headphone-hand');
  const rings = Array.from(document.querySelectorAll('.headphone-tap-ring'));
  const mediaState = document.getElementById('headphone-media-state');
  const stateIcon = document.getElementById('headphone-state-icon');
  const status = document.getElementById('headphone-animation-status');
  const skipResult = document.getElementById('headphone-skip-result');
  let timers = [];
  let runId = 0;

  function later(callback, delay, id) {
    timers.push(setTimeout(() => {
      if (id === runId) callback();
    }, delay));
  }

  function clearSequence() {
    timers.forEach(clearTimeout);
    timers = [];
    hand.getAnimations().forEach((animation) => animation.cancel());
    rings.forEach((ring) => ring.getAnimations().forEach((animation) => animation.cancel()));
  }

  function setMediaState(state, showPill = true) {
    const paused = state === 'paused';
    mediaState.dataset.state = state;
    stateIcon.textContent = paused ? 'Ⅱ' : '▶';
    status.textContent = t(paused ? 'paused' : 'playing');
    mediaState.classList.remove('is-visible');
    if (!showPill) return;
    void mediaState.offsetWidth;
    mediaState.classList.add('is-visible');
  }

  function handTransform(offset) {
    return `translateX(${offset}px) rotate(68deg)`;
  }

  function approachHand() {
    hand.animate([
      { transform: handTransform(76), opacity: 0 },
      { transform: handTransform(22), opacity: 1 }
    ], { duration: 330, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
  }

  function tap(index) {
    hand.animate([
      { transform: handTransform(22), opacity: 1 },
      { transform: handTransform(6), opacity: 1, offset: .45 },
      { transform: handTransform(22), opacity: 1 }
    ], { duration: 150, easing: 'ease-in-out', fill: 'forwards' });

    rings[index].animate([
      { transform: 'scale(.65)', opacity: .95 },
      { transform: 'scale(2.25)', opacity: 0 }
    ], { duration: 360, easing: 'ease-out' });
  }

  function retractHand() {
    hand.animate([
      { transform: handTransform(22), opacity: 1 },
      { transform: handTransform(76), opacity: 0 }
    ], { duration: 280, easing: 'ease-in', fill: 'forwards' });
  }

  function playDemo() {
    clearSequence();
    runId += 1;
    const id = runId;
    hand.style.opacity = '0';
    hand.style.transform = handTransform(76);
    rings.forEach((ring) => {
      ring.style.opacity = '0';
      ring.style.transform = '';
    });
    skipResult.classList.remove('is-visible');
    mediaState.classList.remove('is-visible');
    setMediaState('playing', false);
    if (reducedMotion) return;

    later(approachHand, 220, id);
    later(() => tap(0), 620, id);
    later(() => tap(1), 800, id);
    later(() => {
      setMediaState('paused');
      retractHand();
    }, 1020, id);
    later(approachHand, 1660, id);
    later(() => tap(0), 2060, id);
    later(() => tap(1), 2240, id);
    later(() => {
      setMediaState('playing', false);
      skipResult.classList.add('is-visible');
      retractHand();
    }, 2460, id);
    later(playDemo, 4740, id);
  }

  function stop() {
    runId += 1;
    clearSequence();
    hand.style.opacity = '0';
    hand.style.transform = handTransform(76);
    rings.forEach((ring) => {
      ring.style.opacity = '0';
      ring.style.transform = '';
    });
    skipResult.classList.remove('is-visible');
    mediaState.classList.remove('is-visible');
  }

  return { start: playDemo, stop };
}

document.addEventListener('DOMContentLoaded', () => {
  const i18n = globalThis.OnboardingI18n;
  i18n.localize();
  const { t } = i18n;
  const steps = Array.from(document.querySelectorAll('.step'));
  const backButton = document.getElementById('back-button');
  const nextButton = document.getElementById('next-button');
  const closeButton = document.getElementById('close-guide');
  const closeConfirmation = document.getElementById('close-confirmation');
  const closeConfirmationYes = document.getElementById('close-confirmation-yes');
  const closeConfirmationNo = document.getElementById('close-confirmation-no');
  const stepLabel = document.getElementById('step-label');
  const stepName = document.getElementById('step-name');
  const progressFill = document.getElementById('progress-fill');
  const dotsContainer = document.getElementById('step-dots');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isOverlay = new URLSearchParams(window.location.search).get('overlay') === '1';
  let currentStep = 0;
  let wheelDelta = 0;
  let finalPageScrolls = 0;
  let finalPageScrollDelta = 0;
  let finalPageScrollStopTimer = null;
  let finalPageScrollResetTimer = null;
  let isFinishing = false;
  let confirmationOpen = false;
  let outsideClickCount = 0;
  let outsideClickResetTimer = null;

  const FINAL_SCROLL_THRESHOLD = 120;
  // Treat 0.1 seconds without a wheel event as the end of one gesture.
  const SCROLL_STOP_DELAY = 100;
  const INTERACTION_RESET_DELAY = 1200;

  function highlightNextButton(expectedStepId) {
    if (steps[currentStep].id !== expectedStepId) return;
    nextButton.classList.remove('is-ready');
    void nextButton.offsetWidth;
    nextButton.classList.add('is-ready');
    nextButton.focus({ preventScroll: true });
  }

  const volumePractice = createVolumePractice(reducedMotion, t, () => highlightNextButton('volume'));
  const speedPractice = createSpeedPractice(reducedMotion, t, () => highlightNextButton('speed'));
  const headphoneDemo = createHeadphoneDemo(reducedMotion, t);

  function closeGuide() {
    if (isOverlay) {
      window.parent.postMessage({ type: 'youtube-toolkit.close-onboarding' }, '*');
    } else {
      window.location.assign('https://www.youtube.com/');
    }
  }

  async function finishGuide() {
    if (isFinishing) return;
    isFinishing = true;
    if (isOverlay && globalThis.chrome?.runtime?.sendMessage) {
      try {
        await chrome.runtime.sendMessage({ action: 'toolkit.open_popup' });
      } catch (error) {
        // Older Chrome versions may not support opening an action popup.
      }
    }
    closeGuide();
  }

  function showCloseConfirmation() {
    if (confirmationOpen || isFinishing) return;
    confirmationOpen = true;
    outsideClickCount = 0;
    if (outsideClickResetTimer) clearTimeout(outsideClickResetTimer);
    outsideClickResetTimer = null;
    if (finalPageScrollResetTimer) clearTimeout(finalPageScrollResetTimer);
    finalPageScrollResetTimer = null;
    closeConfirmation.hidden = false;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  function hideCloseConfirmation() {
    confirmationOpen = false;
    closeConfirmation.hidden = true;
    finalPageScrolls = 0;
    finalPageScrollDelta = 0;
    outsideClickCount = 0;
    if (outsideClickResetTimer) clearTimeout(outsideClickResetTimer);
    outsideClickResetTimer = null;
    if (finalPageScrollResetTimer) clearTimeout(finalPageScrollResetTimer);
    finalPageScrollResetTimer = null;
    nextButton.focus({ preventScroll: true });
  }

  const dots = steps.map((step, index) => {
    const dot = document.createElement('button');
    const name = t(step.dataset.titleKey);
    dot.type = 'button';
    dot.className = 'step-dot';
    dot.setAttribute('aria-label', t('goToStep', { step: index + 1, name }));
    dot.addEventListener('click', () => showStep(index));
    dotsContainer.appendChild(dot);
    return dot;
  });

  function showStep(index, moveFocus = true) {
    volumePractice.stop();
    speedPractice.stop();
    headphoneDemo.stop();
    nextButton.classList.remove('is-ready');
    wheelDelta = 0;
    finalPageScrolls = 0;
    finalPageScrollDelta = 0;
    if (finalPageScrollStopTimer) clearTimeout(finalPageScrollStopTimer);
    finalPageScrollStopTimer = null;
    if (finalPageScrollResetTimer) clearTimeout(finalPageScrollResetTimer);
    finalPageScrollResetTimer = null;
    currentStep = Math.max(0, Math.min(steps.length - 1, index));
    steps.forEach((step, stepIndex) => {
      const active = stepIndex === currentStep;
      step.hidden = !active;
      step.classList.toggle('is-active', active);
      step.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
    dots.forEach((dot, dotIndex) => {
      const active = dotIndex === currentStep;
      dot.classList.toggle('is-active', active);
      dot.setAttribute('aria-current', active ? 'step' : 'false');
    });

    const activeStep = steps[currentStep];
    stepLabel.textContent = t('stepLabel', { current: currentStep + 1, total: steps.length });
    stepName.textContent = t(activeStep.dataset.titleKey);
    progressFill.style.transform = 'scaleX(' + ((currentStep + 1) / steps.length) + ')';
    backButton.disabled = currentStep === 0;
    nextButton.textContent = currentStep === steps.length - 1 ? t('finish') : t('next');
    history.replaceState(null, '', '#' + activeStep.id);

    if (activeStep.id === 'volume') volumePractice.start();
    if (activeStep.id === 'speed') speedPractice.start();
    if (activeStep.id === 'headphones') headphoneDemo.start();

    if (moveFocus) {
      const heading = activeStep.querySelector('h1');
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    }
  }

  backButton.addEventListener('click', () => showStep(currentStep - 1));
  nextButton.addEventListener('click', () => {
    if (currentStep === steps.length - 1) finishGuide();
    else showStep(currentStep + 1);
  });
  closeButton.addEventListener('click', closeGuide);
  closeConfirmationYes.addEventListener('click', finishGuide);
  closeConfirmationNo.addEventListener('click', hideCloseConfirmation);

  document.addEventListener('pointerdown', (event) => {
    if (confirmationOpen || isFinishing) return;
    const target = event.target;
    if (target instanceof Element && target.closest('.onboarding-shell')) {
      outsideClickCount = 0;
      if (outsideClickResetTimer) clearTimeout(outsideClickResetTimer);
      outsideClickResetTimer = null;
      return;
    }
    outsideClickCount += 1;
    if (outsideClickResetTimer) clearTimeout(outsideClickResetTimer);
    if (outsideClickCount >= 3) {
      showCloseConfirmation();
    } else {
      outsideClickResetTimer = setTimeout(() => {
        outsideClickResetTimer = null;
        outsideClickCount = 0;
      }, INTERACTION_RESET_DELAY);
    }
  }, true);

  document.querySelectorAll('[data-go]').forEach((control) => {
    control.addEventListener('click', (event) => {
      event.preventDefault();
      showStep(Number(control.dataset.go));
    });
  });

  document.addEventListener('keydown', (event) => {
    if (confirmationOpen) {
      if (event.key === 'Escape') {
        event.preventDefault();
        hideCloseConfirmation();
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeGuide();
      return;
    }
    const target = event.target;
    if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
    if (target && target.closest && target.closest('.practice-player')) return;
    if (event.key === 'ArrowLeft' && currentStep > 0) {
      event.preventDefault();
      showStep(currentStep - 1);
    } else if (event.key === 'ArrowRight' && currentStep < steps.length - 1) {
      event.preventDefault();
      showStep(currentStep + 1);
    }
  });

  document.addEventListener('wheel', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (confirmationOpen) return;

    if (currentStep === steps.length - 1) {
      if (event.deltaY < 0) {
        finalPageScrolls = 0;
        finalPageScrollDelta = 0;
        if (finalPageScrollStopTimer) clearTimeout(finalPageScrollStopTimer);
        finalPageScrollStopTimer = null;
        if (finalPageScrollResetTimer) clearTimeout(finalPageScrollResetTimer);
        finalPageScrollResetTimer = null;
        wheelDelta += event.deltaY;
        if (Math.abs(wheelDelta) >= 45) {
          wheelDelta = 0;
          showStep(currentStep - 1, false);
        }
      } else if (event.deltaY > 0) {
        finalPageScrollDelta += event.deltaY;
        if (finalPageScrollResetTimer) clearTimeout(finalPageScrollResetTimer);
        finalPageScrollResetTimer = setTimeout(() => {
          finalPageScrollResetTimer = null;
          finalPageScrolls = 0;
          finalPageScrollDelta = 0;
        }, INTERACTION_RESET_DELAY);
        if (finalPageScrollStopTimer) clearTimeout(finalPageScrollStopTimer);
        finalPageScrollStopTimer = setTimeout(() => {
          finalPageScrollStopTimer = null;
          if (finalPageScrollDelta >= FINAL_SCROLL_THRESHOLD) {
            finalPageScrolls += 1;
            if (finalPageScrolls >= 2) showCloseConfirmation();
          }
          finalPageScrollDelta = 0;
        }, SCROLL_STOP_DELAY);
      }
      return;
    }

    wheelDelta += event.deltaY;

    if (Math.abs(wheelDelta) < 45) return;

    const direction = wheelDelta > 0 ? 1 : -1;
    wheelDelta = 0;

    const nextStep = currentStep + direction;
    if (nextStep < 0 || nextStep >= steps.length) return;

    showStep(nextStep, false);
  }, { passive: false });

  const hashIndex = steps.findIndex((step) => '#' + step.id === window.location.hash);
  showStep(hashIndex >= 0 ? hashIndex : 0, false);
});
