/* ============================================================
   Ponce Design — Craft, drifting lines
   Twenty slim vertical strips in the site palette, each longer than
   the panel. Every strip drifts up and down on its own slow wave,
   and the boundaries between its colour blocks drift on theirs,
   so nothing moves in step. A strip's travel is clamped so it
   always spans the panel top to bottom.

   Hovering speeds up the strips nearest the cursor, up to ten
   times, and swells them to three times their width; they ease
   back to normal once it moves away.

   Purely decorative (the host is aria-hidden). Under reduced
   motion it draws one still frame; off screen it stops ticking.
   ============================================================ */
(function () {
  'use strict';

  var host = document.querySelector('.craft-lines');
  if (!host) return;

  var RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* palette: ink #16151A · ink-2 #3A383F · ink-3 #6B6871 · muted #918E97
     line-strong #D5D0C4 · orange #E8630B · orange-deep #C24E05 · yellow #F5B301
     x = position across the panel, tilt in radians, colours top to bottom */
  var LINES = [
    { x: 0.068, tilt: 0.004, colors: ['#16151A','#D5D0C4','#918E97','#E8630B','#3A383F','#A7A3AC','#CDC7BA','#6B6871'] },
    { x: 0.148, tilt: 0.006, colors: ['#16151A','#D5D0C4','#2E2C33','#918E97','#1D1C22','#CFC9BC','#E8630B','#A7A3AC','#222026','#C9C3B6','#3A383F','#848189','#16151A','#D5D0C4'] },
    { x: 0.225, tilt: 0.003, colors: ['#524F58','#3A383F','#F5B301','#2A2830','#9C99A2','#C9C3B6','#16151A','#E07A2E'] },
    { x: 0.320, tilt:-0.002, colors: ['#F5B301','#EE9A12','#F3BC3A','#E8630B'] },
    { x: 0.415, tilt: 0.001, colors: ['#6B6871','#46434C','#1D1C22','#C24E05','#BDB7AA','#5C5962','#F0943F','#2E2C33'] },
    { x: 0.528, tilt: 0.000, colors: ['#16151A','#2A2830','#1D1C22','#E8630B','#26242B','#1A191E'] },
    { x: 0.638, tilt:-0.002, colors: ['#16151A','#D0CABD','#E8630B','#524F58','#B8B2A5','#848189','#262429','#E9A30C'] },
    { x: 0.765, tilt: 0.003, colors: ['#16151A','#3A383F','#6B6871','#918E97','#C24E05','#E8630B','#F5B301','#E8630B','#C24E05','#918E97','#6B6871','#3A383F'] },
    { x: 0.890, tilt:-0.004, colors: ['#918E97','#C24E05','#46434C','#3A383F','#F5B301','#6B6871','#C8C2B5','#1F1E24'] },
    { x: 0.958, tilt:-0.006, double: true, colors: ['#6B6871','#E8630B','#2E2C33','#918E97','#F5B301','#46434C','#C24E05'] },
    /* ten more, in the gaps — each its own character */
    /* ember: deep oranges fading into ink */
    { x: 0.030, tilt: 0.005, colors: ['#C24E05','#A8440A','#E8630B','#3A383F','#16151A','#D5D0C4','#C24E05'] },
    /* morse: short ink dots on long pale runs */
    { x: 0.108, tilt:-0.003, colors: ['#D5D0C4','#16151A','#CFC9BC','#16151A','#D5D0C4','#2E2C33','#C9C3B6','#16151A','#D0CABD'] },
    /* dusk: purple-greys only, soft and quiet */
    { x: 0.187, tilt: 0.002, colors: ['#6B6871','#848189','#5C5962','#9C99A2','#46434C','#A7A3AC'] },
    /* flare: one long yellow run with dark caps */
    { x: 0.272, tilt:-0.004, colors: ['#16151A','#F5B301','#F3BC3A','#E9A30C','#16151A'] },
    /* checker: strict ink / cream alternation */
    { x: 0.368, tilt: 0.003, colors: ['#16151A','#D5D0C4','#16151A','#D5D0C4','#16151A','#D5D0C4','#16151A','#D5D0C4','#16151A','#D5D0C4'] },
    /* sunset ladder: yellow down to deep orange, one way only */
    { x: 0.472, tilt:-0.001, colors: ['#F5B301','#F3A51C','#EE8C1A','#E8630B','#D45808','#C24E05','#A8440A'] },
    /* ash: light warm greys with a single ink stroke */
    { x: 0.583, tilt: 0.004, colors: ['#C9C3B6','#BDB7AA','#D5D0C4','#16151A','#B8B2A5','#CDC7BA'] },
    /* signal: orange and ink in quick pairs */
    { x: 0.702, tilt:-0.005, colors: ['#E8630B','#16151A','#E8630B','#2A2830','#F0943F','#16151A','#E8630B','#3A383F'] },
    /* double ink: twin strips in near-blacks and one yellow */
    { x: 0.828, tilt: 0.002, double: true, colors: ['#16151A','#2E2C33','#3A383F','#F5B301','#1D1C22','#46434C'] },
    /* spectrum: one of each palette colour */
    { x: 0.925, tilt: 0.005, colors: ['#16151A','#3A383F','#6B6871','#918E97','#D5D0C4','#F5B301','#E8630B','#C24E05'] }
  ];

  var LEN = 2.0;       /* strip length as a multiple of the panel height */
  var WIDTH = 0.011;   /* strip width as a fraction of the panel width   */
  var MIN_GAP = 0.06;  /* smallest block, as a fraction of the strip     */

  function rand(a, b) { return a + Math.random() * (b - a); }

  /* smooth pseudo-random wave in [-1, 1]: incommensurate sines, random phases */
  function wave(speed) {
    var parts = [], norm = 0;
    for (var i = 0; i < 3; i++) {
      parts.push({ f: speed * rand(0.6, 1.4) / (i + 1), p: rand(0, Math.PI * 2), a: 1 / (i + 1) });
      norm += 1 / (i + 1);
    }
    return function (t) {
      var s = 0;
      for (var i = 0; i < parts.length; i++) s += parts[i].a * Math.sin(t * parts[i].f + parts[i].p);
      return s / norm;
    };
  }

  var lines = LINES.map(function (cfg) {
    var el = document.createElement('div');
    el.className = 'cl-line';
    host.appendChild(el);

    var n = cfg.colors.length, base = [0], i;
    var cuts = [];
    for (i = 0; i < n - 1; i++) cuts.push(Math.random());
    cuts.sort();
    base = base.concat(cuts, [1]);
    for (i = 1; i < base.length; i++) base[i] = Math.max(base[i], base[i - 1] + MIN_GAP);
    var scale = 1 / base[base.length - 1];
    for (i = 0; i < base.length; i++) base[i] *= scale;

    var segs = cfg.colors.map(function (c) {
      var s = document.createElement('div');
      s.className = 'cl-seg';
      s.style.background = cfg.double
        ? 'linear-gradient(90deg, ' + c + ' 0 38%, transparent 38% 62%, ' + c + ' 62%)'
        : c;
      el.appendChild(s);
      return s;
    });

    /* each inner boundary drifts within 40% of its neighbouring gaps */
    var bounds = base.map(function (b, i) {
      if (i === 0 || i === base.length - 1) return { b: b, amp: 0, w: function () { return 0; } };
      return { b: b, amp: 0.4 * Math.min(b - base[i - 1], base[i + 1] - b), w: wave(rand(0.35, 1.0)) };
    });

    return { el: el, cfg: cfg, segs: segs, bounds: bounds,
             move: wave(rand(0.25, 0.6)), wobble: wave(rand(0.4, 0.9)) };
  });

  /* hover: strips near the cursor run up to BOOST× faster — quick to spin
     up, slow to wind back down once the cursor moves away */
  var BOOST   = 10;
  var REACH   = 60;    /* px either side of the cursor that feels it   */
  var RISE    = 6;     /* per second, easing toward a higher speed     */
  var FALL    = 0.7;   /* per second, easing back toward normal speed  */
  /* …and swell up to GROW× wider, following the cursor more closely */
  var GROW    = 3;
  var W_RISE  = 8;     /* per second, widening                          */
  var W_FALL  = 3;     /* per second, narrowing back                    */
  var pointer = null;  /* cursor x within the panel, or null           */

  lines.forEach(function (ln) { ln.t = rand(0, 1000); ln.speed = 1; ln.grow = 1; });

  function draw() {
    var W = host.clientWidth, H = host.clientHeight;
    if (!W || !H) return;
    var L = H * LEN;

    for (var k = 0; k < lines.length; k++) {
      var ln = lines[k], cfg = ln.cfg, t = ln.t;
      /* offset spans 0 … -(L - H): the strip always covers the panel */
      var y = -(L - H) * (0.5 + 0.5 * ln.move(t));
      var w = Math.max(4, WIDTH * W) * (1 + 0.04 * ln.wobble(t)) * ln.grow;
      var st = ln.el.style;
      st.left = (cfg.x * W - w / 2) + 'px';
      st.width = w + 'px';
      st.height = L + 'px';
      st.transform = 'translate3d(0,' + y + 'px,0) rotate(' + cfg.tilt + 'rad)';

      var pos = ln.bounds.map(function (bd) { return (bd.b + bd.amp * bd.w(t)) * L; });
      for (var i = 0; i < ln.segs.length; i++) {
        ln.segs[i].style.transform = 'translateY(' + pos[i] + 'px)';
        ln.segs[i].style.height = (pos[i + 1] - pos[i] + 0.5) + 'px';
      }
    }
  }

  /* advance each strip's own clock by dt × its current speed */
  function step(dt) {
    var W = host.clientWidth;
    for (var k = 0; k < lines.length; k++) {
      var ln = lines[k], near = 0;
      if (pointer !== null) {
        var d = Math.abs(pointer - ln.cfg.x * W) / REACH;
        near = Math.exp(-d * d);   /* gaussian falloff, 1 under the cursor */
      }
      var target = 1 + (BOOST - 1) * near;
      var rate = target > ln.speed ? RISE : FALL;
      ln.speed += (target - ln.speed) * (1 - Math.exp(-rate * dt));
      ln.t += dt * ln.speed;

      var gTarget = 1 + (GROW - 1) * near;
      var gRate = gTarget > ln.grow ? W_RISE : W_FALL;
      ln.grow += (gTarget - ln.grow) * (1 - Math.exp(-gRate * dt));
    }
  }

  if (RM) {
    draw();
    window.addEventListener('resize', draw);
    return;
  }

  host.addEventListener('pointermove', function (e) {
    pointer = e.clientX - host.getBoundingClientRect().left;
  });
  host.addEventListener('pointerleave', function () { pointer = null; });

  var running = false, raf = 0, last = 0;
  function tick(ms) {
    var dt = Math.min(0.1, (ms - last) / 1000);   /* clamp after tab switches */
    last = ms;
    step(dt);
    draw();
    raf = requestAnimationFrame(tick);
  }
  function start() {
    if (running) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }
  function stop() { if (running) { running = false; cancelAnimationFrame(raf); } }

  draw();
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) {
      es[0].isIntersecting ? start() : stop();
    }).observe(host);
  } else {
    start();
  }
})();
