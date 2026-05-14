(function () {
  'use strict';

  /* ══════════════════════════════════════════
     LIGAYA — Performance-optimised JS
     
     KEY PERF RULES:
     1. ONE requestAnimationFrame loop handles
        carousel rotation + particles + drag tilt.
        (was 3 separate RAFs — now merged)
     2. Particles: 20 mobile / 50 desktop max.
     3. Lilies: pure CSS animations, JS only sets
        CSS vars once at startup (no ongoing RAF).
     4. Drag tilt lerped inside the same tick().
     5. All touch events passive:true.
  ══════════════════════════════════════════ */

  const IS_MOBILE = window.innerWidth < 600;

  /* ── Elements ── */
  const carousel   = document.getElementById('carousel');
  const scene      = document.getElementById('scene');
  const cards      = Array.from(document.querySelectorAll('.card'));
  const dots       = Array.from(document.querySelectorAll('.dot'));
  const prevBtn    = document.getElementById('prevBtn');
  const nextBtn    = document.getElementById('nextBtn');
  const musicBtn   = document.getElementById('musicBtn');
  const musicLabel = document.getElementById('musicLabel');
  const introEl    = document.getElementById('introOverlay');

  const N                = cards.length;   // 5
  const STEP             = 360 / N;        // 72 deg
  const SPIN_DEG_PER_SEC = 360 / 32;      // gentle auto-spin

  /* ── Carousel state ── */
  let currentAngle = 0;
  let targetAngle  = 0;
  let activeIndex  = 0;
  let isHovered    = false;
  let manualMode   = false;
  let manualTimer  = null;
  let lastTS       = null;

  /* ── Drag-tilt state (integrated into single RAF) ── */
  let dragCard      = null;
  let dragInner     = null;
  let isDragging    = false;
  let dragStartX    = 0;
  let dragStartY    = 0;
  let tiltX         = 0;   // current lerped tilt
  let tiltY         = 0;
  let tiltTargetX   = 0;   // target tilt
  let tiltTargetY   = 0;
  let pointerMoved  = false;

  const TILT_MAX   = 26;
  const LIFT_PX    = 16;
  const DRAG_SCALE = 1.06;
  const LERP_SPEED = 0.14;

  /* ── Get radius from CSS custom property ── */
  function getRadius () {
    return parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--radius')
    ) || 320;
  }

  /* ── Layout cards in 3D ring ── */
  function layoutCards () {
    const r = getRadius();
    cards.forEach((card, i) => {
      const a = STEP * i;
      card.style.transform = `rotateY(${a}deg) translateZ(${r}px) rotateY(${-a}deg)`;
    });
  }
  layoutCards();

  /* Debounced resize — avoids layout thrash on every pixel */
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layoutCards, 120);
  });

  /* ══════════════════════════════════════════
     SINGLE UNIFIED RAF TICK
     Handles: carousel spin · tilt lerp · particles
  ══════════════════════════════════════════ */
  function tick (ts) {
    if (!lastTS) lastTS = ts;
    const dt = Math.min((ts - lastTS) / 1000, 0.05);
    lastTS = ts;

    /* — Carousel rotation — */
    if (!isHovered && !manualMode) {
      currentAngle -= SPIN_DEG_PER_SEC * dt;
    } else if (manualMode) {
      const diff = targetAngle - currentAngle;
      currentAngle += diff * Math.min(1, dt * 5.5);
      if (Math.abs(diff) < 0.06) {
        currentAngle = targetAngle;
        manualMode = false;
      }
    }
    carousel.style.transform = `rotateY(${currentAngle}deg)`;
    updateActive();

    /* — Drag tilt lerp — */
    if (dragInner || Math.abs(tiltX) > 0.05 || Math.abs(tiltY) > 0.05) {
      tiltX += (tiltTargetX - tiltX) * LERP_SPEED;
      tiltY += (tiltTargetY - tiltY) * LERP_SPEED;

      if (Math.abs(tiltX) > 0.05 || Math.abs(tiltY) > 0.05 || isDragging) {
        if (dragInner) {
          const sc   = isDragging ? DRAG_SCALE : 1;
          const lift = isDragging ? -LIFT_PX   : 0;
          dragInner.style.transform =
            `rotateX(${tiltX}deg) rotateY(${tiltY}deg) translateY(${lift}px) scale(${sc})`;
        }
      } else if (dragInner) {
        /* Fully settled — clear */
        dragInner.style.transform = '';
        dragInner = null;
        dragCard  = null;
        if (!isDragging) isHovered = false;
      }
    }

    /* — Particles — */
    particleTick();

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  /* ── Active card detection ── */
  function updateActive () {
    let best = 0, bestDist = Infinity;
    cards.forEach((_, i) => {
      let eff = (STEP * i + currentAngle) % 360;
      if (eff < 0) eff += 360;
      const dist = Math.min(eff, 360 - eff);
      if (dist < bestDist) { bestDist = dist; best = i; }
    });
    if (best !== activeIndex) {
      activeIndex = best;
      cards.forEach((c, i) => c.classList.toggle('is-active', i === activeIndex));
      dots.forEach((d, i)  => d.classList.toggle('active',    i === activeIndex));
    }
  }

  /* ── Navigate ── */
  function goTo (idx) {
    idx = ((idx % N) + N) % N;
    let raw = -(STEP * idx);
    while (raw - currentAngle >  180) raw -= 360;
    while (raw - currentAngle < -180) raw += 360;
    targetAngle = raw;
    manualMode  = true;
    isHovered   = false;
    clearTimeout(manualTimer);
    manualTimer = setTimeout(() => { manualMode = false; }, 1200);
  }

  /* ══════════════════════════════════════════
     DRAG-TILT HANDLERS
  ══════════════════════════════════════════ */
  function startDrag (card, cx, cy) {
    dragCard    = card;
    dragInner   = card.querySelector('.card-inner');
    isDragging  = true;
    dragStartX  = cx;
    dragStartY  = cy;
    pointerMoved = false;
    card.classList.add('is-dragging');
    isHovered   = true;  /* pause auto-spin while held */
  }

  function moveDrag (cx, cy) {
    if (!isDragging) return;
    pointerMoved = true;
    const dx = cx - dragStartX;
    const dy = cy - dragStartY;
    const maxD = Math.min(window.innerWidth * 0.4, 240);
    tiltTargetX = -(dy / maxD) * TILT_MAX;
    tiltTargetY =  (dx / maxD) * TILT_MAX;
  }

  function endDrag (finalX, finalY) {
    if (!isDragging) return;
    isDragging    = false;
    tiltTargetX   = 0;
    tiltTargetY   = 0;
    if (dragCard) dragCard.classList.remove('is-dragging');
    /* dragInner + dragCard cleared by tick() once tilt settles */
  }

  /* ── Attach drag to each card ── */
  cards.forEach((card, i) => {
    let downTime = 0;

    /* Mouse */
    card.addEventListener('mousedown', (e) => {
      e.preventDefault();
      downTime = Date.now();
      startDrag(card, e.clientX, e.clientY);
    });
    card.addEventListener('mouseup', () => {
      const wasShortClick = !pointerMoved && (Date.now() - downTime < 250);
      endDrag();
      if (wasShortClick) goTo(i);
    });

    /* Touch */
    card.addEventListener('touchstart', (e) => {
      downTime = Date.now();
      const t = e.touches[0];
      startDrag(card, t.clientX, t.clientY);
    }, { passive: true });

    card.addEventListener('touchend', (e) => {
      const t   = e.changedTouches[0];
      const dx  = Math.abs(t.clientX - dragStartX);
      const dy  = Math.abs(t.clientY - dragStartY);
      const tap = dx < 12 && dy < 12 && (Date.now() - downTime < 300);
      endDrag(t.clientX, t.clientY);
      if (tap) goTo(i);
    }, { passive: true });
  });

  /* Global move/release */
  window.addEventListener('mousemove', (e) => moveDrag(e.clientX, e.clientY));
  window.addEventListener('mouseup',   ()  => endDrag());
  window.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    moveDrag(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  window.addEventListener('touchend', () => endDrag(), { passive: true });

  /* ── Nav controls ── */
  prevBtn.addEventListener('click', () => goTo(activeIndex - 1));
  nextBtn.addEventListener('click', () => goTo(activeIndex + 1));
  dots.forEach((d, i) => d.addEventListener('click', () => goTo(i)));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft')  goTo(activeIndex - 1);
    if (e.key === 'ArrowRight') goTo(activeIndex + 1);
  });

  /* ── Hover pause (pointer devices only) ── */
  scene.addEventListener('mouseenter', () => { if (!isDragging) isHovered = true; });
  scene.addEventListener('mouseleave', () => { if (!isDragging) isHovered = false; });

  /* ── Swipe on scene (coarse pointer / touch) ── */
  let swipeStartX = 0, swipeStartY = 0;
  scene.addEventListener('touchstart', (e) => {
    swipeStartX = e.touches[0].clientX;
    swipeStartY = e.touches[0].clientY;
    isHovered = true;
    clearTimeout(manualTimer);
    manualTimer = setTimeout(() => { isHovered = false; }, 1800);
  }, { passive: true });
  scene.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - swipeStartX;
    const dy = e.changedTouches[0].clientY - swipeStartY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 44) {
      goTo(activeIndex + (dx < 0 ? 1 : -1));
    }
  }, { passive: true });

  /* ── Init ── */
  cards[0].classList.add('is-active');
  dots[0].classList.add('active');

  /* Attempt music autoplay as the splash begins to fade (around 2 seconds in) */
  setTimeout(() => {
    attemptAutoplay();
  }, 2000);

  /* Fully hide intro element after animation finishes */
  setTimeout(() => {
    introEl.style.display = 'none';
  }, 3200);

  /* ══════════════════════════════════════════
     LILY FIELD — CSS vars randomised once.
     Animation fully handled by CSS keyframes.
     ZERO ongoing JS cost.
  ══════════════════════════════════════════ */
  (function initLilies () {
    const lilyEls = document.querySelectorAll('.lily');
    const isMobile = window.innerWidth < 600;

    lilyEls.forEach((el, i) => {
      /* Skip last 2 lilies on mobile to reduce element count */
      if (isMobile && i >= 6) { el.style.display = 'none'; return; }

      const size  = Math.random() * 70 + 35;          /* 35–105 px */
      const left  = Math.random() * 110 - 5;           /* -5% to 105% */
      const dur   = Math.random() * 14 + 10;           /* 10–24 s */
      const delay = -(Math.random() * 20);             /* pre-start stagger */
      const dx    = (Math.random() - 0.5) * 140;      /* drift */
      const r0    = (Math.random() - 0.5) * 18;
      const r1    = (Math.random() - 0.5) * 12;
      const r2    = (Math.random() - 0.5) * 22;
      const op    = Math.random() * 0.3 + 0.18;       /* 0.18–0.48 opacity */

      el.style.setProperty('--sz',     `${size}px`);
      el.style.setProperty('--dur',    `${dur}s`);
      el.style.setProperty('--delay',  `${delay}s`);
      el.style.setProperty('--dx',     `${dx}px`);
      el.style.setProperty('--r0',     `${r0}deg`);
      el.style.setProperty('--r1',     `${r1}deg`);
      el.style.setProperty('--r2',     `${r2}deg`);
      el.style.setProperty('--op',     `${op}`);
      el.style.left = `${left}%`;
    });
  })();

  /* ══════════════════════════════════════════
     PARTICLES — Merged into tick() above.
     Count: 20 mobile / 50 desktop.
     Canvas pixel-ratio aware (crisp on retina,
     but half-resolution to save fillRect cost).
  ══════════════════════════════════════════ */
  const canvas  = document.getElementById('particleCanvas');
  const ctx     = canvas.getContext('2d');
  let   cW = 0, cH = 0;

  function resizeCanvas () {
    /* Use devicePixelRatio capped at 2 — avoids 3x overdraw on high-DPI */
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cW = window.innerWidth;
    cH = window.innerHeight;
    canvas.width  = cW * dpr;
    canvas.height = cH * dpr;
    canvas.style.width  = cW + 'px';
    canvas.style.height = cH + 'px';
    ctx.scale(dpr, dpr);
  }
  resizeCanvas();
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);      /* reuse debounce timer */
    resizeTimer = setTimeout(resizeCanvas, 150);
  });

  const PINK_PALETTE = [
    [244,167,192],
    [232,120,154],
    [252,228,236],
    [232,197,160],
    [255,133,179],
  ];

  const P_COUNT = IS_MOBILE ? 20 : 50;

  /* Flat typed arrays are faster than class instances for hot loops */
  const px      = new Float32Array(P_COUNT);
  const py      = new Float32Array(P_COUNT);
  const pvx     = new Float32Array(P_COUNT);
  const pvy     = new Float32Array(P_COUNT);
  const pr      = new Float32Array(P_COUNT);
  const plife   = new Float32Array(P_COUNT);
  const pmaxlife= new Float32Array(P_COUNT);
  const pclr    = new Uint8Array(P_COUNT);     /* palette index */

  function resetParticle (i, initial) {
    px[i]       = Math.random() * cW;
    py[i]       = initial ? Math.random() * cH : cH + 4;
    pvx[i]      = (Math.random() - 0.5) * 0.18;
    pvy[i]      = -(Math.random() * 0.28 + 0.05);
    pr[i]       = Math.random() * 1.6 + 0.3;
    plife[i]    = 0;
    pmaxlife[i] = Math.random() * 200 + 100;
    pclr[i]     = Math.floor(Math.random() * PINK_PALETTE.length);
  }

  for (let i = 0; i < P_COUNT; i++) resetParticle(i, true);

  function particleTick () {
    ctx.clearRect(0, 0, cW, cH);
    for (let i = 0; i < P_COUNT; i++) {
      px[i]   += pvx[i];
      py[i]   += pvy[i];
      plife[i]++;
      if (plife[i] > pmaxlife[i] || py[i] < -8) {
        resetParticle(i, false);
        continue;
      }
      const a = Math.sin((plife[i] / pmaxlife[i]) * Math.PI) * 0.55;
      const [r,g,b] = PINK_PALETTE[pclr[i]];
      ctx.beginPath();
      ctx.arc(px[i], py[i], pr[i], 0, 6.2832);
      ctx.fillStyle = `rgba(${r},${g},${b},${a.toFixed(2)})`;
      ctx.fill();
    }
  }

  /* ══════════════════════════════════════════
     MUSIC — Iris.mp3

     AUTO-PLAY STRATEGY:
     1. After intro fades, call bgMusic.play().
     2. If browser allows it (user interacted or
        policy permits) → fade volume in, mark ON.
     3. If blocked (Promise rejected) → register
        a one-shot pointer/key listener so the
        VERY NEXT touch/click starts the song.
     4. Button always toggles play ↔ pause with
        a smooth 1.5 s volume fade.
  ══════════════════════════════════════════ */
  const bgMusic = document.getElementById('bgMusic');
  let musicOn   = false;
  let fadeTimer = null;
  let pendingAutoplay = false; /* waiting for first user gesture */

  /* ── Volume fade helper ── */
  function fadeTo (target, durationMs) {
    clearInterval(fadeTimer);
    const steps    = 40;
    const interval = durationMs / steps;
    const start    = bgMusic.volume;
    const delta    = (target - start) / steps;
    let   step     = 0;
    fadeTimer = setInterval(() => {
      step++;
      bgMusic.volume = Math.min(1, Math.max(0, start + delta * step));
      if (step >= steps) {
        bgMusic.volume = target;
        clearInterval(fadeTimer);
        if (target === 0) bgMusic.pause();
      }
    }, interval);
  }

  /* ── Mark UI as playing ── */
  function setPlaying (on) {
    musicOn = on;
    musicBtn.classList.toggle('active', on);
    musicLabel.textContent = on ? 'SOUND ON' : 'SOUND OFF';
  }

  /* ── Start playback with fade-in ── */
  function startMusic () {
    bgMusic.volume = 0;
    bgMusic.play().then(() => {
      setPlaying(true);
      fadeTo(0.75, 2000); /* 2 s fade-in to 75% volume */
    }).catch(() => {
      /* Still blocked — shouldn't reach here if called from gesture */
    });
  }

  /* ── Called once after intro fades ── */
  function attemptAutoplay () {
    bgMusic.volume = 0;
    bgMusic.play().then(() => {
      /* Autoplay allowed */
      setPlaying(true);
      fadeTo(0.75, 2500);
    }).catch(() => {
      /* Autoplay blocked — wait for first user gesture anywhere on page */
      pendingAutoplay = true;
      musicBtn.title = 'Tap to play music';
      /* Pulse the button gently to hint the user */
      musicBtn.style.borderColor = 'var(--clr-accent)';
      musicBtn.style.color       = 'var(--clr-accent)';
    });
  }

  /* ── One-shot gesture handler for blocked autoplay ── */
  function onFirstGesture () {
    if (!pendingAutoplay) return;
    pendingAutoplay = false;
    musicBtn.style.borderColor = '';
    musicBtn.style.color       = '';
    musicBtn.title             = '';
    startMusic();
    document.removeEventListener('pointerdown', onFirstGesture);
    document.removeEventListener('keydown',     onFirstGesture);
  }
  document.addEventListener('pointerdown', onFirstGesture, { once: true });
  document.addEventListener('keydown',     onFirstGesture, { once: true });

  /* ── Music button: toggle play / pause ── */
  musicBtn.addEventListener('click', () => {
    /* If we were waiting on autoplay, this click is the gesture — handled above.
       But we also want an immediate toggle, so check pending first. */
    if (pendingAutoplay) return; /* onFirstGesture() will run from this same click */

    if (musicOn) {
      /* Fade out then pause */
      setPlaying(false);
      fadeTo(0, 1400);
    } else {
      /* Resume with fade-in */
      bgMusic.play().then(() => {
        setPlaying(true);
        fadeTo(0.75, 1500);
      }).catch(() => {});
    }
  });

  /* ══════════════════════════════════════════
     LETTER MODAL
  ══════════════════════════════════════════ */
  const mailBtn        = document.getElementById('mailBtn');
  const letterOverlay  = document.getElementById('letterOverlay');
  const letterClose    = document.getElementById('letterClose');
  const letterBackdrop = document.getElementById('letterBackdrop');

  function openLetter() {
    letterOverlay.classList.add('is-open');
    letterOverlay.setAttribute('aria-hidden', 'false');
  }

  function closeLetter() {
    letterOverlay.classList.remove('is-open');
    letterOverlay.setAttribute('aria-hidden', 'true');
  }

  mailBtn.addEventListener('click', openLetter);
  letterClose.addEventListener('click', closeLetter);
  letterBackdrop.addEventListener('click', closeLetter);

})();
