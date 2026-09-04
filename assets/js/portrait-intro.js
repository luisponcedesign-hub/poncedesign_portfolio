/* ============================================================
   Ponce Design — full-page halftone portrait intro
   Plays the authored dot composition exactly once across the
   whole viewport as the home page loads: the field drifts in
   fully dispersed, gathers into the face, breathes, ripples,
   then scatters back apart and fades away for good. Motion math
   is ported from the Halftone Portrait composition; rendering
   is canvas. No-ops under prefers-reduced-motion.

   Performance notes, since this is ~3.6k moving dots a frame:
   the run is held back until the page has finished loading so it
   never competes with fonts, images and the hero reveal; dot
   statics live in typed arrays; the per-frame trig is skipped
   whenever its envelope is silent; and if frames still come in
   long the renderer steps down through the quality tiers below.
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
  if (!ctx) { host.remove(); return; }

  var W = D.w, H = D.h;
  var CX = W * 0.5, CY = H * 0.40;
  var TAU = Math.PI * 2;

  var INK    = '#16151A';
  var ACCENT = '#E8630B';

  /* Timeline, seconds.
     0 ──gather──► settle/breathe ──ripple─┬─► expansion ──► gone
                                           └ the crest is what starts it

     The orange crest travels out from the face at CREST_SPEED, and a
     release front follows it: a dot only comes loose once the crest has
     passed it. So the expansion propagates outward from the centre in
     the wave's wake instead of the whole field letting go at once.     */
  var GATHER   = 4.0;   /* dispersed field eases into the portrait   */
  var RIP_A    = 7.0;   /* the crest leaves the face                 */
  var RIP_FADE = 8.7;   /* …and is clear of the field, so it fades   */
  var CREST_SPEED = 560;  /* portrait units per second               */
  var CREST_HEAD  = 120;  /* crest starts this far inside the centre */
  var RELEASE_LAG  = 120; /* the front trails the crest by this much */
  var RELEASE_SOFT = 220; /* …and hands each dot over this smoothly  */
  var SCATTER = 7.2;    /* first dots let go, right behind the crest */
  var TOTAL   = 15.0;
  var EXIT_K  = 1.5;    /* dots overshoot their scatter positions so
                           they keep expanding while they fade        */
  var OUT_AT  = 9.2;    /* front has swept the field; fade from here  */
  var FADE_OUT = TOTAL - OUT_AT; /* 5.8s — matches the CSS .is-out    */

  /* Quality tiers, best first. `stride` skips dots; `rBoost` fattens
     the survivors so the field keeps its ink weight when it does. */
  var TIERS = [
    { dpr: 1.5, stride: 1, rBoost: 1 },
    { dpr: 1,   stride: 1, rBoost: 1 },
    { dpr: 1,   stride: 2, rBoost: 1.35 }
  ];
  var tier = 0;

  function clamp(n, a, b) { return n < a ? a : (n > b ? b : n); }
  function hash(i, s) { var v = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453; return v - Math.floor(v); }
  function enter(t) { return 1 - Math.pow(1 - clamp(t, 0, 1), 3); }
  function wave(t)  { return 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1)); }

  /* ---- per-dot statics, built once the page is quiet ------- */
  var N = D.dots.length;
  var dx, dy, dr, dDist, dCos, dSin, dSx, dSy, dPh, dH2, dH3, dBre;

  function build() {
    dx = new Float32Array(N); dy = new Float32Array(N); dr = new Float32Array(N);
    dDist = new Float32Array(N); dCos = new Float32Array(N); dSin = new Float32Array(N);
    dSx = new Float32Array(N); dSy = new Float32Array(N);
    dPh = new Float32Array(N); dH2 = new Float32Array(N); dH3 = new Float32Array(N);
    dBre = new Float32Array(N);
    for (var i = 0; i < N; i++) {
      var src = D.dots[i];
      var x = src[0], y = src[1];
      var dist = Math.hypot(x - CX, y - CY);
      var ang  = Math.atan2(y - CY, x - CX);
      var h1 = hash(i, 1), h2 = hash(i, 2), h3 = hash(i, 3);
      var sang  = ang + 0.75 + h1 * 0.7;
      var sdist = dist * 1.06 + 70 + h2 * 250;
      dx[i] = x; dy[i] = y; dr[i] = src[2];
      dDist[i] = dist; dCos[i] = Math.cos(ang); dSin[i] = Math.sin(ang);
      dSx[i] = CX + Math.cos(sang) * sdist;
      dSy[i] = CY + Math.sin(sang) * sdist * 0.88;
      dPh[i] = h3 * TAU; dH2[i] = h2; dH3[i] = h3;
      dBre[i] = h1 * 0.9 - y * 0.011;   /* breathe phase, hoisted out of the loop */
    }
  }

  /* ---- fit the portrait into the hero ---------------------- */
  var vw = 0, vh = 0, dpr = 1, scale = 1, ox = 0, oy = 0;
  function measure() {
    var box = host.getBoundingClientRect();
    vw = Math.max(1, Math.round(box.width));
    vh = Math.max(1, Math.round(box.height));
    dpr = Math.min(window.devicePixelRatio || 1, TIERS[tier].dpr);
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

    var stride = TIERS[tier].stride, rBoost = TIERS[tier].rBoost;

    /* Dispersal. On the way in it is global — the whole field eases into
       place at once. On the way out it is gated per dot by the release
       front below, so the crest visibly drives the expansion. Either way
       it runs past 1 at the end, so the dots are still spreading — and
       thinning, via the size falloff below — as the opacity runs down. */
    var kGather = T < GATHER ? 1 - enter(T / GATHER) : 0;
    var kExit = T > SCATTER ? EXIT_K * (T - SCATTER) / (TOTAL - SCATTER) : 0;
    /* the field unwinds on the way in and spirals back out on the way out */
    var spin = 0.55 * (T < GATHER ? kGather : -kExit);
    var cs = Math.cos(spin), sn = Math.sin(spin);

    /* breathing only once the face has formed, gone again before it leaves */
    var breathe = wave((T - GATHER * 0.5) / 1.6) * (1 - wave((T - (SCATTER - 0.6)) / 1.4));
    var bAmp = 0.24 * breathe, bMove = 1.6 * breathe;
    var bR = TAU * T * 0.42, bX = TAU * T * 0.23, bY = TAU * T * 0.19;

    /* one crest, travelling out once — no second wrapped cycle */
    var rip = (T > RIP_A && T < RIP_FADE + 0.9)
      ? wave((T - RIP_A) / 0.5) * (1 - wave((T - RIP_FADE) / 0.9))
      : 0;
    var crest = (T - RIP_A) * CREST_SPEED - CREST_HEAD;
    /* the release front, trailing the crest, is what lets each dot go */
    var releaseAt = crest - RELEASE_LAG;

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

    /* Accents are a thin slice of the field, so they are collected as we go
       and stroked in a second pass rather than costing a branch per fill. */
    var accN = 0;
    ctx.beginPath();

    for (var i = 0; i < N; i += stride) {
      var x = dx[i], y = dy[i], rs = 1;

      /* breathing size wave travelling up the portrait */
      if (breathe > 0.001) {
        rs += bAmp * Math.sin(bR + dBre[i]);
        x += bMove * Math.sin(bX + dPh[i]);
        y += bMove * Math.cos(bY + dPh[i]);
      }

      /* radial ripples */
      var env = 0;
      if (rip > 0) {
        var u = (dDist[i] - crest) * (1 / 150);
        env = Math.exp(-u * u) * rip;
        var push = 30 * env;
        x += dCos[i] * push;
        y += dSin[i] * push;
        rs += env;
      }

      /* the crest passes, the dot lets go, and the swirl carries it out */
      var k = kGather;
      if (kExit > 0) {
        var rel = (releaseAt - dDist[i]) * (1 / RELEASE_SOFT);
        k = kExit * (rel < 0 ? 0 : (rel > 1 ? 1 : rel));
      }
      if (k > 0) {
        var tx = dSx[i] - CX, ty = dSy[i] - CY;
        x += (CX + tx * cs - ty * sn - dx[i]) * k;
        y += (CY + tx * sn + ty * cs - dy[i]) * k;
        rs *= 1 - 0.42 * k;
        rs += 0.5 * k * (1 - k) * (0.5 + dH2[i]);
      }

      var r = Math.max(0.35, dr[i] * rBoost * rs);
      if (env > 0.5 || (k > 0.15 && dH3[i] > 0.93)) {
        accX[accN] = x; accY[accN] = y; accR[accN] = r; accN++;
      } else {
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, TAU);
      }
    }
    ctx.fillStyle = INK;
    ctx.fill();

    if (accN) {
      ctx.beginPath();
      for (var j = 0; j < accN; j++) {
        ctx.moveTo(accX[j] + accR[j], accY[j]);
        ctx.arc(accX[j], accY[j], accR[j], 0, TAU);
      }
      ctx.fillStyle = ACCENT;
      ctx.fill();
    }
  }

  /* accent scratch buffers — sized once, never reallocated per frame */
  var accX = new Float32Array(N), accY = new Float32Array(N), accR = new Float32Array(N);

  /* ---- run once, then leave --------------------------------- */
  var T = 0, last = 0, rafId = 0, fading = false, done = false;

  /* The layer is fixed, so gate on the hero instead: scroll past it
     mid-intro and the dots stop rather than washing over the work grid. */
  var stage = document.querySelector('.hero') || host;
  function offscreen() {
    var box = stage.getBoundingClientRect();
    return box.bottom <= 0 || box.top >= (window.innerHeight || 0);
  }

  /* Frame-time watchdog. Deciding quality from measured frames rather
     than from a getImageData probe keeps the canvas on the GPU: repeated
     readbacks are what push Chrome to a software surface. Only plausible
     frames count, so a throttled or backgrounded tab is never mistaken
     for a slow one, and twelve of them is a fifth of a second — well
     inside the fade-in, so a step down is not visible. */
  var samples = [], SAMPLE_N = 12;
  function watch(dtMs) {
    if (tier >= TIERS.length - 1) return;
    if (dtMs < 4 || dtMs > 100) return;
    samples.push(dtMs);
    if (samples.length < SAMPLE_N) return;
    samples.sort(function (a, b) { return a - b; });
    var median = samples[SAMPLE_N >> 1];
    samples.length = 0;
    if (median > 30) tier = Math.min(TIERS.length - 1, tier + 2);
    else if (median > 20) tier++;
    else return;
    measure();
  }

  function frame(ts) {
    if (!last) last = ts;
    var dtMs = ts - last;
    last = ts;
    T += Math.min(dtMs / 1000, 0.05);   /* survive a backgrounded tab */
    watch(dtMs);

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

  function start() {
    build();
    measure();
    draw(0);                       /* first paint is the dispersed field */
    window.addEventListener('resize', onResize);
    host.classList.add('is-in');
    rafId = window.requestAnimationFrame(frame);
  }

  /* Hold off until the page has stopped loading — fonts swapping, the
     hero card decoding and the reveal transitions all land first. */
  function whenIdle() {
    if (window.requestIdleCallback) window.requestIdleCallback(start, { timeout: 600 });
    else window.setTimeout(start, 200);
  }
  if (document.readyState === 'complete') whenIdle();
  else window.addEventListener('load', whenIdle, { once: true });
})();
