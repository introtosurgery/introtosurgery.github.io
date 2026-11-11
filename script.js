(() => {
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasAnime = typeof window.anime === 'function';
  const animate = hasAnime && !reduced;
  if (!animate) root.classList.remove('js'); // nothing stays hidden without the animation library

  /* ── torn paper edges ─────────────────────────────────────────── */
  const rng = (seed) => () => {           // mulberry32
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // A ragged line across the top of a w × h strip, closed along `floor`.
  // Teeth never reach the last few pixels, so the bottom of the strip is always solid.
  const edge = (rand, w, h, base, amp, floor) => {
    let d = `M0 ${floor} L0 ${base.toFixed(1)}`;
    const drift = rand() * 6;
    for (let x = 0; x < w;) {
      x = Math.min(w, x + 3 + rand() * rand() * 22);   // mostly fine teeth, the odd long rip
      const wander = Math.sin(x / 110 + drift) * amp * 0.4 + Math.sin(x / 31 + drift * 2) * amp * 0.25;
      const jag = (rand() - 0.5) * amp * (rand() < 0.12 ? 1.5 : 0.8);
      d += ` L${x.toFixed(1)} ${Math.min(h - 10, base + wander + jag).toFixed(1)}`;
    }
    return `${d} L${w} ${floor} Z`;
  };
  const tears = [...document.querySelectorAll('.tear')];
  const drawTears = () => tears.forEach((el) => {
    const w = Math.ceil(el.getBoundingClientRect().width) + 1;
    const h = el.clientHeight;
    const rand = rng(Number(el.dataset.seed) || 1);
    const fibre = document.createElement('i');
    const body = document.createElement('i');
    fibre.className = 'fibre';
    body.className = 'body';
    fibre.style.clipPath = `path("${edge(rand, w, h, h * 0.31, h * 0.31, h)}")`;
    body.style.clipPath = `path("${edge(rand, w, h, h * 0.52, h * 0.35, h)}")`;
    // .cast holds the ragged layers and their shadow; .base is a plain strip of page colour
    // along the bottom, so the edge that meets the page carries no shadow and no white fibre
    const cast = document.createElement('div');
    const base = document.createElement('i');
    cast.className = 'cast';
    base.className = 'base';
    cast.append(fibre, body);
    el.replaceChildren(cast, base);
  });
  // line the edge's paper grain up with the page's, so the two read as one sheet
  const alignTears = () => tears.forEach((el) => {
    const box = el.getBoundingClientRect();
    const top = box.top + scrollY;
    el.style.setProperty('--gy', `${-(top % 220)}px`);
    el.style.setProperty('--gy-base', `${-((top + box.height - 8) % 220)}px`);
  });
  drawTears();
  alignTears();
  let resizeTimer;
  let lastWidth = innerWidth;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (innerWidth !== lastWidth) { lastWidth = innerWidth; drawTears(); }
      alignTears();
    }, 150);
  });
  addEventListener('load', alignTears);

  /* ── nav ──────────────────────────────────────────────────────── */
  const nav = document.getElementById('nav');
  const hero = document.querySelector('.hero');
  const onScroll = () => nav.classList.toggle('is-stuck', scrollY > hero.offsetHeight - 130);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const toggle = document.getElementById('navToggle');
  const links = document.getElementById('navLinks');
  const setMenu = (open) => {
    links.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => setMenu(!links.classList.contains('is-open')));
  links.addEventListener('click', (e) => e.target.closest('a') && setMenu(false));
  addEventListener('keydown', (e) => e.key === 'Escape' && setMenu(false));

  /* ── paper physics ────────────────────────────────────────────────
     Each sheet is a damped spring turning about its tape or pin. Hovering changes where the
     spring wants to rest (and, for pinned notes, gives it a push). The whole path to rest is
     worked out up front and handed to the browser as one animation, starting from wherever
     the sheet is and however fast it is moving, so it never snaps between two poses.
       data-sway="hover"   taped: eases into a hover pose, eases back when the cursor leaves
       data-sway="settle"  pinned: swings on the pin, comes to rest hanging straight, stays
     These are small, hover-only movements, so they run even when the visitor's system asks
     for reduced motion. The big entrance animations further down do respect that setting. */
  if (typeof Element.prototype.animate === 'function') {
    const FRAME = 1000 / 60;
    const DEG = 180 / Math.PI;
    const TAPED = { omega: 8, zeta: 0.58, travel: 15 };      // quick, with one soft overshoot
    const PINNED = { omega: 6.4, zeta: 0.23, travel: 16 };   // a pendulum: a few swings, then still
    // omega: natural frequency in rad/s. zeta: damping ratio. travel: px the farthest corner moves.

    // step the spring from (angle, speed) until it rests on `target`; one entry per frame
    const simulate = (angle, speed, target, omega, zeta) => {
      const frames = [];
      const h = FRAME / 4000;
      for (let f = 0; f < 60 * 6; f++) {
        frames.push([angle, speed]);
        for (let i = 0; i < 4; i++) {
          speed += (-omega * omega * (angle - target) - 2 * zeta * omega * speed) * h;
          angle += speed * h;
        }
        if (Math.abs(angle - target) < 0.004 && Math.abs(speed) < 0.03) break;
      }
      frames.push([target, 0]);
      return frames;
    };

    document.querySelectorAll('.stick[data-sway]').forEach((stick) => {
      const pinned = stick.dataset.sway === 'settle';
      const feel = pinned ? PINNED : TAPED;
      const tilt = parseFloat(getComputedStyle(stick).getPropertyValue('--r')) || 0;   // resting tilt, degrees
      const sheets = [...stick.querySelectorAll(':scope > .back, :scope > .note, :scope > .polaroid, :scope > .print')]
        .map((el) => ({ el, back: el.classList.contains('back'), angle: 0, target: 0, frames: null, anim: null }));
      const top = sheets.find((s) => !s.back);

      // angle and speed of a sheet right now, whether mid-move or at rest
      const now = (s) => {
        if (!s.anim) return [s.angle, 0];
        const at = Math.min(s.frames.length - 1, (s.anim.currentTime || 0) / FRAME);
        const a = s.frames[Math.floor(at)];
        const b = s.frames[Math.ceil(at)];
        const mix = at - Math.floor(at);
        return [a[0] + (b[0] - a[0]) * mix, a[1] + (b[1] - a[1]) * mix];
      };

      // send a sheet toward `target`, carrying on from its current angle and speed
      const move = (s, target, kick) => {
        const [angle, speed] = now(s);
        const omega = feel.omega * (s.back ? 0.9 : 1);          // the backing sheet trails the top one a touch
        const limit = Math.max(Math.abs(kick) * 2, 1);
        s.target = target;
        s.frames = simulate(angle, Math.max(-limit, Math.min(limit, speed + kick)), target, omega, feel.zeta);
        if (s.anim) s.anim.cancel();
        const anim = s.el.animate(
          s.frames.map(([a]) => ({ transform: `rotate(${a.toFixed(3)}deg)` })),
          { duration: (s.frames.length - 1) * FRAME, easing: 'linear', fill: 'forwards' },
        );
        s.anim = anim;
        anim.onfinish = () => {
          if (s.anim !== anim) return;
          s.angle = target;
          s.el.style.transform = target ? `rotate(${target}deg)` : '';   // hold the final pose
          anim.cancel();
          s.anim = null;
        };
      };

      // degrees this sheet may turn so that its farthest corner travels `feel.travel` px
      const turn = () => {
        const w = top.el.offsetWidth;
        const pivotX = parseFloat(getComputedStyle(top.el).transformOrigin) || w / 2;
        return Math.min(4, (feel.travel / Math.hypot(Math.max(pivotX, w - pivotX), top.el.offsetHeight)) * DEG);
      };

      stick.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'touch') return;
        const by = turn();
        if (pinned) {
          const box = stick.getBoundingClientRect();
          const push = e.clientX < box.left + box.width / 2 ? -1 : 1;     // nudged from the left, it swings right
          sheets.forEach((s) => move(s, -tilt, push * by * feel.omega * 1.37));   // rest straight up and down
        } else {
          const lean = tilt > 0 ? -1 : 1;                                 // top sheet leans back toward straight
          sheets.forEach((s) => move(s, s.back ? -lean * by * 0.7 : lean * by, 0));   // backing sheet fans the other way
        }
      });
      if (!pinned) stick.addEventListener('pointerleave', () => sheets.forEach((s) => move(s, 0, 0)));
    });
  }

  if (!animate) {
    document.querySelectorAll('[data-reveal]').forEach((el) => el.classList.add('is-in'));
    return;
  }

  /* ── hero entrance ────────────────────────────────────────────── */
  const seam = document.querySelector('.hero__stitch .seam');
  const ticks = document.querySelectorAll('.hero__stitch .ticks path');
  anime.set([seam, ...ticks], { strokeDashoffset: anime.setDashoffset });
  anime.set('.hero__title span', { opacity: 0, translateY: 40 });

  anime.timeline({ easing: 'easeOutExpo' })
    .add({
      targets: '.tile',
      opacity: [0, 1],
      scale: [1.35, 1],
      translateY: [() => anime.random(-60, 60), 0],
      duration: 1100,
      delay: anime.stagger(55, { grid: [5, 3], from: 'center' }),
    })
    .add({ targets: '.hero__title span', opacity: 1, translateY: 0, duration: 1000, delay: anime.stagger(140) }, 350)
    .add({ targets: seam, strokeDashoffset: 0, duration: 800, easing: 'easeInOutQuad' }, 1000)
    .add({ targets: ticks, strokeDashoffset: 0, duration: 260, delay: anime.stagger(70), easing: 'easeOutQuad' }, 1500);

  /* ── scroll reveals: things get dropped onto the page ─────────── */
  const io = new IntersectionObserver((entries) => {
    entries.filter((e) => e.isIntersecting).forEach((entry, i) => {
      const el = entry.target;
      io.unobserve(el);
      el.classList.add('is-in');
      anime({
        targets: el,
        opacity: [0, 1],
        translateY: [50, 0],
        rotate: [i % 2 ? 4 : -4, 0],
        scale: [0.94, 1],
        delay: i * 110,
        easing: 'spring(1, 70, 11, 0)',
        complete: () => { el.style.transform = ''; },
      });
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  document.querySelectorAll('[data-reveal]').forEach((el) => io.observe(el));
})();
