/* ============================================================
   Ponce Design — Craft, drifting lines
   Ten slim vertical strips in the site palette, each longer than
   the panel. Every strip drifts up and down on its own slow wave,
   and the boundaries between its colour blocks drift on theirs,
   so nothing moves in step. A strip's travel is clamped so it
   always spans the panel top to bottom.

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
    { x: 0.958, tilt:-0.006, double: true, colors: ['#6B6871','#E8630B','#2E2C33','#918E97','#F5B301','#46434C','#C24E05'] }
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

  function draw(t) {
    var W = host.clientWidth, H = host.clientHeight;
    if (!W || !H) return;
    var L = H * LEN;

    for (var k = 0; k < lines.length; k++) {
      var ln = lines[k], cfg = ln.cfg;
      /* offset spans 0 … -(L - H): the strip always covers the panel */
      var y = -(L - H) * (0.5 + 0.5 * ln.move(t));
      var w = Math.max(4, WIDTH * W) * (1 + 0.04 * ln.wobble(t));
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

  if (RM) {
    draw(0);
    window.addEventListener('resize', function () { draw(0); });
    return;
  }

  var running = false, raf = 0;
  function tick(ms) { draw(ms / 1000); raf = requestAnimationFrame(tick); }
  function start() { if (!running) { running = true; raf = requestAnimationFrame(tick); } }
  function stop() { if (running) { running = false; cancelAnimationFrame(raf); } }

  draw(performance.now() / 1000);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) {
      es[0].isIntersecting ? start() : stop();
    }).observe(host);
  } else {
    start();
  }
})();
