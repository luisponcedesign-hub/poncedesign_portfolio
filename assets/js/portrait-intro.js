/* ============================================================
   Ponce Design — full-page halftone portrait intro
   Plays the authored dot composition exactly once across the
   whole viewport as the home page loads: the field drifts in
   fully dispersed, gathers into the face, breathes, ripples,
   then scatters back apart and fades away for good. Motion math
   is ported from the Halftone Portrait composition; rendering
   is canvas. No-ops under prefers-reduced-motion.
   ============================================================ */
(function () {
  'use strict';

  var D    = window.PORTRAIT_DOTS;
  var host = document.getElementById('portrait-intro');
  if (!host) return;
  if (!D || !D.dots || !D.dots.length) { host.remove(); return; }
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { host.remove(); return; }

  var cvs = host.querySelector('canvas');
  var ctx = cvs && cvs.getContext ? cvs.getContext('2d') : null;
  if (!ctx || typeof window.Path2D !== 'function') { host.remove(); return; }

  var W = D.w, H = D.h;
  var CX = W * 0.5, CY = H * 0.40;
  var TAU = Math.PI * 2;

  var INK    = '#16151A';
  var ACCENT = '#E8630B';

  /* Timeline, seconds.
     0 ──gather──► settle/breathe ──ripple──► scatter ──► gone      */
  var GATHER  = 4.0;    /* dispersed field eases into the portrait  */
  var RIP_A   = 7.0;    /* radial ripples start                     */
  var RIP_B   = 10.5;   /* …and have travelled through              */
  var SCATTER = 10.5;   /* the face comes apart again               */
  var TOTAL   = 17.0;
  var EXIT_K  = 1.5;    /* dots overshoot their scatter positions so
                           they keep expanding while they fade       */
  var OUT_AT  = SCATTER;         /* fade runs the whole expansion    */
  var FADE_OUT = TOTAL - OUT_AT; /* 6.5s — matches the CSS .is-out   */
  var LEAD    = 0.35;   /* let the hero copy start landing first    */

  function clamp(n, a, b) { return n < a ? a : (n > b ? b : n); }
  function hash(i, s) { var v = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453; return v - Math.floor(v); }
  function enter(t) { return 1 - Math.pow(1 - clamp(t, 0, 1), 3); }
  function wave(t)  { return 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1)); }
  function smooth(t) { var u = clamp(t, 0, 1); return u * u * (3 - 2 * u); }

  /* ---- per-dot statics ------------------------------------- */
  var N = D.dots.length;
  var dots = new Array(N);
  for (var i = 0; i < N; i++) {
    var src = D.dots[i];
    var x = src[0], y = src[1];
    var dist = Math.hypot(x - CX, y - CY);
    var ang  = Math.atan2(y - CY, x - CX);
    var h1 = hash(i, 1), h2 = hash(i, 2), h3 = hash(i, 3);
    var sang  = ang + 0.75 + h1 * 0.7;
    var sdist = dist * 1.06 + 70 + h2 * 250;
    dots[i] = {
      x: x, y: y, r: src[2], dist: dist, ang: ang, h1: h1, h2: h2, h3: h3,
      sx: CX + Math.cos(sang) * sdist,
      sy: CY + Math.sin(sang) * sdist * 0.88,
      ph: h3 * TAU
    };
  }

  /* ---- fit the portrait into the hero ---------------------- */
  var vw = 0, vh = 0, dpr = 1, scale = 1, ox = 0, oy = 0;
  function measure() {
    var box = host.getBoundingClientRect();
    vw = Math.max(1, Math.round(box.width));
    vh = Math.max(1, Math.round(box.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cvs.width  = Math.round(vw * dpr);
    cvs.height = Math.round(vh * dpr);
    cvs.style.width  = vw + 'px';
    cvs.style.height = vh + 'px';
    /* Fill the viewport with the face — height-fit with a little bleed on
       landscape screens, width-fit on portrait ones — and centre it. */
    scale = Math.min((vh * 1.35) / H, (vw * 0.98) / W);
    ox = vw * 0.5 - CX * scale;
    oy = vh * 0.5 - CY * scale;
  }

  /* ---- one frame ------------------------------------------- */
  function clear() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
  }

  function draw(T) {
    clear();

    /* dispersal: 1 while the field is scattered, 0 once it is the face.
       The exit eases out past 1 so the dots are still spreading — and
       thinning, via the size falloff below — as the opacity runs down. */
    var k = T < GATHER ? 1 - enter(T / GATHER)
          : (T < SCATTER ? 0
                         : EXIT_K * smooth((T - SCATTER) / (TOTAL - SCATTER)));
    /* the field unwinds on the way in and spirals back out on the way out */
    var spin = 0.55 * k * (T < GATHER ? 1 : -1);
    var cs = Math.cos(spin), sn = Math.sin(spin);

    /* breathing only once the face has formed, gone again before it leaves */
    var breathe = wave((T - GATHER * 0.5) / 1.6) * (1 - wave((T - (SCATTER - 0.6)) / 1.4));

    var rip = (T > RIP_A && T < RIP_B + 0.6)
      ? wave((T - RIP_A) / 0.5) * (1 - wave((T - (RIP_B - 0.2)) / 0.8))
      : 0;
    var ripProg = (T - RIP_A) / (RIP_B - RIP_A);
    var wave1 = ripProg * 1500 - 120;
    var wave2 = ((ripProg + 0.55) % 1) * 1500 - 120;

    /* camera: slow drift that returns to zero at both ends, plus a ripple push-in */
    var drift = 0.5 - 0.5 * Math.cos(TAU * (T / TOTAL));
    var zoom  = 1 + 0.035 * drift + 0.10 * rip * wave(clamp((T - RIP_A) / 1.2, 0, 1));
    var camY  = -26 * drift - 24 * rip;

    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    ctx.translate(0, camY);
    ctx.translate(CX, CY);
    ctx.scale(zoom, zoom);
    ctx.translate(-CX, -CY);

    var ink = new Path2D(), acc = new Path2D();

    for (var i = 0; i < N; i++) {
      var d = dots[i];
      var x = d.x, y = d.y, rs = 1;

      /* breathing size wave travelling up the portrait */
      rs += 0.24 * breathe * Math.sin(TAU * (T * 0.42) - d.y * 0.011 + d.h1 * 0.9);
      x += 1.6 * breathe * Math.sin(TAU * T * 0.23 + d.ph);
      y += 1.6 * breathe * Math.cos(TAU * T * 0.19 + d.ph);

      /* radial ripples */
      var env = 0;
      if (rip > 0) {
        var a = Math.exp(-Math.pow((d.dist - wave1) / 150, 2));
        var b = 0.7 * Math.exp(-Math.pow((d.dist - wave2) / 130, 2));
        env = (a + b) * rip;
        var push = 30 * env;
        x += Math.cos(d.ang) * push;
        y += Math.sin(d.ang) * push;
        rs += env;
      }

      /* gather / scatter swirl */
      if (k > 0) {
        var tx = d.sx - CX, ty = d.sy - CY;
        x += (CX + tx * cs - ty * sn - d.x) * k;
        y += (CY + tx * sn + ty * cs - d.y) * k;
        rs *= 1 - 0.42 * k;
        rs += 0.5 * k * (1 - k) * (0.5 + d.h2);
      }

      var r = Math.max(0.35, d.r * rs);
      var p = (env > 0.5 || (k > 0.15 && d.h3 > 0.93)) ? acc : ink;
      p.moveTo(x + r, y);
      p.arc(x, y, r, 0, TAU);
    }

    ctx.fillStyle = INK;    ctx.fill(ink);
    ctx.fillStyle = ACCENT; ctx.fill(acc);
  }

  /* ---- run once, then leave --------------------------------- */
  var T = 0, last = 0, rafId = 0, fading = false, done = false;

  /* The layer is fixed, so gate on the hero instead: scroll past it
     mid-intro and the dots stop rather than washing over the work grid. */
  var stage = document.querySelector('.hero') || host;
  function offscreen() {
    var box = stage.getBoundingClientRect();
    return box.bottom <= 0 || box.top >= (window.innerHeight || 0);
  }

  function frame(ts) {
    if (!last) last = ts;
    var dt = Math.min((ts - last) / 1000, 0.05);   /* survive a backgrounded tab */
    last = ts;
    T += dt;

    if (!fading && T >= OUT_AT) { fading = true; host.classList.add('is-out'); }
    if (offscreen()) clear(); else draw(Math.min(T, TOTAL));

    if (T >= TOTAL) { teardown(); return; }
    rafId = window.requestAnimationFrame(frame);
  }

  function teardown() {
    if (done) return;
    done = true;
    window.cancelAnimationFrame(rafId);
    window.removeEventListener('resize', onResize);
    host.remove();
  }

  var resizePending = false;
  function onResize() {
    if (resizePending || done) return;
    resizePending = true;
    window.requestAnimationFrame(function () { resizePending = false; measure(); });
  }

  window.addEventListener('resize', onResize);

  window.setTimeout(function () {
    measure();
    draw(0);                       /* first paint is the dispersed field */
    host.classList.add('is-in');
    rafId = window.requestAnimationFrame(frame);
  }, LEAD * 1000);
})();
