// Volume visualizer HUD component.

class VolumeVisualizerHUD {
  constructor() {
    this.wrapper = null;
    this.fill = null;
    this.badge = null;
    this.iconBox = null;
    this.header = null;
    this.waveform = null;
    this.waveBars = [];
    this.hideTimeout = null;
    this.options = { showIcon: true, showWaveform: true, showPercentage: true };
    this.numBars = 6;
    this.isMounted = false;

    this.lastSpeakerState = null;
    this.lastPercent = -1;
    this.lastMuted = null;
    this.lastX = null;
    this.lastY = null;
    this.lastBelow = null;
    this.cardWidth = 0;
    this.cardHeight = 0;
    this.trackWidth = 0;
    this.visible = false;
  }

  getSpeakerState(level, isMuted) {
    if (isMuted || level === 0) return 'muted';
    if (level < 0.34) return 'low';
    if (level < 0.67) return 'mid';
    return 'high';
  }

  getSpeakerSvg(state) {
    switch (state) {
      case 'muted':
        return `
          <svg viewBox="0 0 24 24">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
            <line x1="22" y1="9" x2="16" y2="15"/>
            <line x1="16" y1="9" x2="22" y2="15"/>
          </svg>
        `;
      case 'low':
        return `
          <svg viewBox="0 0 24 24">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
            <path d="M15 9a5 5 0 0 1 0 6"/>
          </svg>
        `;
      case 'mid':
        return `
          <svg viewBox="0 0 24 24">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
            <path d="M15 9a5 5 0 0 1 0 6"/>
            <path d="M18 7a8.5 8.5 0 0 1 0 10"/>
          </svg>
        `;
      case 'high':
      default:
        return `
          <svg viewBox="0 0 24 24">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
            <path d="M15 9a5 5 0 0 1 0 6"/>
            <path d="M18 7a8.5 8.5 0 0 1 0 10"/>
            <path d="M21 5a12 12 0 0 1 0 14"/>
          </svg>
        `;
    }
  }

  createDOM() {
    if (this.wrapper && this.wrapper.parentElement) {
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'yt-vol-hud-wrapper';
    wrapper.setAttribute('aria-hidden', 'true');

    const card = document.createElement('div');
    card.className = 'yt-vol-hud-card';

    const iconBox = document.createElement('div');
    iconBox.className = 'yt-vol-icon-box';
    iconBox.innerHTML = this.getSpeakerSvg('high');
    this.lastSpeakerState = 'high';

    const body = document.createElement('div');
    body.className = 'yt-vol-body';

    const header = document.createElement('div');
    header.className = 'yt-vol-header';

    const waveform = document.createElement('div');
    waveform.className = 'yt-vol-waveform';
    this.waveBars = [];
    const baseWeights = [0.4, 0.75, 1.0, 0.65, 0.9, 0.5];
    for (let i = 0; i < this.numBars; i++) {
      const bar = document.createElement('div');
      bar.className = 'yt-vol-bar';
      bar._weight = baseWeights[i % baseWeights.length];
      waveform.appendChild(bar);
      this.waveBars.push(bar);
    }

    const badge = document.createElement('div');
    badge.className = 'yt-vol-badge';
    badge.textContent = '100%';

    header.appendChild(waveform);
    header.appendChild(badge);

    const sliderWrap = document.createElement('div');
    sliderWrap.className = 'yt-vol-slider-wrap';

    const sliderFill = document.createElement('div');
    sliderFill.className = 'yt-vol-slider-fill';

    const sliderThumb = document.createElement('div');
    sliderThumb.className = 'yt-vol-slider-thumb';

    sliderWrap.appendChild(sliderFill);
    sliderWrap.appendChild(sliderThumb);

    body.appendChild(header);
    body.appendChild(sliderWrap);

    card.appendChild(iconBox);
    card.appendChild(body);
    wrapper.appendChild(card);

    this.wrapper = wrapper;
    this.fill = sliderFill;
    this.thumb = sliderThumb;
    this.badge = badge;
    this.iconBox = iconBox;
    this.header = header;
    this.waveform = waveform;
    this.setOptions(this.options);
  }

  mount(targetContainer) {
    if (!targetContainer) return;
    this.createDOM();
    if (this.wrapper.parentElement !== targetContainer) {
      targetContainer.appendChild(this.wrapper);
      this.isMounted = true;
    }
  }

  setOptions(options = {}) {
    this.options = { ...this.options, ...options };
    const noHeader = !this.options.showWaveform && !this.options.showPercentage;
    const compactTrack = !this.options.showIcon && noHeader;
    this.cardWidth = compactTrack ? 200 : 300;
    this.cardHeight = compactTrack ? 26 : 55;
    this.trackWidth = 0;
    this.lastPercent = -1;
    if (this.wrapper) {
      this.wrapper.classList.toggle('yt-vol-hide-icon', !this.options.showIcon);
      this.wrapper.classList.toggle('yt-vol-hide-waveform', !this.options.showWaveform);
      this.wrapper.classList.toggle('yt-vol-hide-percentage', !this.options.showPercentage);
      this.wrapper.classList.toggle('yt-vol-no-header', noHeader);
      this.wrapper.classList.toggle('yt-vol-compact-track', compactTrack);
    }
    if (this.iconBox) this.iconBox.style.display = this.options.showIcon ? 'flex' : 'none';
    if (this.waveform) this.waveform.style.display = this.options.showWaveform ? 'flex' : 'none';
    if (this.badge) this.badge.style.display = this.options.showPercentage ? 'block' : 'none';
    if (this.header) this.header.style.display = noHeader ? 'none' : 'flex';
  }

  show() {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
    if (this.wrapper && !this.visible) {
      this.visible = true;
      this.wrapper.classList.add('yt-vol-visible');
    }
  }

  isShowing() {
    if (this.hideTimeout) return true;
    return this.visible;
  }

  applyTransform(posX, posY) {
    if (!this.wrapper) return;
    this.wrapper.style.transform = `translate3d(${posX}px, ${posY}px, 0)`;
  }

  setPosition(cursorX, cursorY, playerRect) {
    if (!this.wrapper || !playerRect || typeof cursorX !== 'number' || typeof cursorY !== 'number') {
      return;
    }

    const relX = cursorX - playerRect.left;
    const relY = cursorY - playerRect.top;

    const isCompact = !this.options.showIcon && !this.options.showWaveform && !this.options.showPercentage;
    const cardWidth = isCompact ? 200 : 300;
    const cardHeight = isCompact ? 26 : 55;
    const halfWidth = isCompact ? 100 : 150;
    const gap = 16;

    const minX = halfWidth + 12;
    const maxX = Math.max(minX, playerRect.width - halfWidth - 12);
    const clampedX = Math.max(minX, Math.min(maxX, relX));

    const spaceAbove = relY - gap;
    const flipBelow = spaceAbove < cardHeight + 10;

    let clampedY;
    if (flipBelow) {
      const maxY = Math.max(gap, playerRect.height - cardHeight - 10);
      clampedY = Math.max(gap, Math.min(maxY, relY + gap));
    } else {
      clampedY = Math.max(cardHeight + 10, Math.min(playerRect.height - 10, relY - gap));
    }

    const posX = playerRect.left + clampedX - halfWidth;
    const posY = playerRect.top + (flipBelow ? (clampedY + 8) : (clampedY - cardHeight));

    if (posX !== this.lastX || posY !== this.lastY || flipBelow !== this.lastBelow) {
      this.lastX = posX;
      this.lastY = posY;
      if (flipBelow !== this.lastBelow) {
        this.lastBelow = flipBelow;
        this.wrapper.classList.toggle('yt-vol-hud-below', flipBelow);
      }
      this.applyTransform(posX, posY);
    }
  }

  applyWaveBars(level, effectiveMuted) {
    if (!this.options.showWaveform || !this.waveBars.length) return;
    const minScale = 0.166;
    const t = (effectiveMuted || level <= 0) ? 0 : Math.max(0, Math.min(1, level));
    for (let i = 0; i < this.waveBars.length; i++) {
      const bar = this.waveBars[i];
      const maxScale = Math.max(minScale, bar._weight || 0.5);
      const scale = minScale + (maxScale - minScale) * t;
      bar.style.transform = `scaleY(${scale})`;
    }
  }

  applySpeakerIcon(level, effectiveMuted) {
    if (!this.options.showIcon || !this.iconBox) return;
    const speakerState = this.getSpeakerState(level, effectiveMuted);
    if (speakerState === this.lastSpeakerState) return;
    this.lastSpeakerState = speakerState;
    this.iconBox.innerHTML = this.getSpeakerSvg(speakerState);
  }

  setLevel(volumeFraction, isMuted) {
    const clampedVol = Math.max(0, Math.min(1, volumeFraction));
    const percent = Math.round(clampedVol * 100);
    const effectiveMuted = isMuted || percent === 0;
    const level = effectiveMuted ? 0 : clampedVol;

    if (percent === this.lastPercent && effectiveMuted === this.lastMuted) {
      return;
    }

    this.lastPercent = percent;
    this.lastMuted = effectiveMuted;

    if (this.fill) {
      this.fill.style.transform = `scaleX(${level})`;
    }
    if (this.thumb) {
      if (!this.trackWidth && this.thumb.parentElement) {
        this.trackWidth = this.thumb.parentElement.offsetWidth || 0;
      }
      const x = this.trackWidth ? level * this.trackWidth : 0;
      this.thumb.style.transform = `translate3d(${x - 5}px, 0, 0)`;
    }

    if (this.badge) {
      if (effectiveMuted) {
        this.badge.textContent = 'Muted';
        this.badge.classList.add('is-muted');
      } else {
        this.badge.textContent = `${percent}%`;
        this.badge.classList.remove('is-muted');
      }
    }

    this.applyWaveBars(level, effectiveMuted);
    this.applySpeakerIcon(level, effectiveMuted);
  }

  // Drag tick: compositor transforms + percent text. No innerHTML, no layout left/%.
  paint(cursorX, cursorY, playerRect, volumeFraction) {
    this.setPosition(cursorX, cursorY, playerRect);
    this.setLevel(volumeFraction, volumeFraction === 0);
  }

  update(volumeFraction, isMuted, cursorX, cursorY, playerRect) {
    if (typeof cursorX === 'number' && typeof cursorY === 'number' && playerRect) {
      this.setPosition(cursorX, cursorY, playerRect);
    }
    this.show();
    this.setLevel(volumeFraction, isMuted);
  }

  hide(delay = 450) {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
    const hideNow = () => {
      this.visible = false;
      if (this.wrapper) {
        this.wrapper.classList.remove('yt-vol-visible', 'yt-vol-hud-below');
      }
    };

    if (delay === 0) {
      hideNow();
      return;
    }
    this.hideTimeout = setTimeout(() => {
      this.hideTimeout = null;
      hideNow();
    }, delay);
  }

  destroy() {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
    if (this.wrapper && this.wrapper.parentElement) {
      this.wrapper.parentElement.removeChild(this.wrapper);
    }
    this.wrapper = null;
    this.fill = null;
    this.thumb = null;
    this.badge = null;
    this.iconBox = null;
    this.header = null;
    this.waveform = null;
    this.waveBars = [];
    this.isMounted = false;
    this.visible = false;
    this.lastSpeakerState = null;
    this.lastPercent = -1;
    this.lastMuted = null;
    this.lastX = null;
    this.lastY = null;
    this.lastBelow = null;
    this.trackWidth = 0;
  }
}

window.VolumeVisualizerHUD = VolumeVisualizerHUD;
