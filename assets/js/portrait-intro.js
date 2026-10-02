/* ============================================================
   Ponce Design — full-page halftone portrait intro
   Plays the authored dot composition exactly once across the
   whole viewport as the home page loads: the field drifts in
   fully dispersed, gathers into the face, breathes, ripples,
   then scatters back apart and fades away for good. Motion math
   is ported from the Halftone Portrait composition; rendering
   is canvas. No-ops under prefers-reduced-motion.

   Performance notes, since this is ~3.6k moving dots a frame: the
   run is held until the page is quiet, not merely loaded, so it
   never competes with fonts, images and the hero reveal; dot
   statics live in typed arrays; per-frame trig is skipped whenever
   its envelope is silent; dots that are off-canvas or under a
   device pixel are culled before they cost an arc; touch devices
   open on a thinned tier; and if frames still come in long the
   renderer steps further down the quality tiers below. Below the
   mobile breakpoint it does not run at all.
   ============================================================ */
(function () {
  'use strict';

  var D    = window.PORTRAIT_DOTS;
  var host = document.getElementById('portrait-intro');
  if (!host) return;

  /* While this plays it owns the page: the rest of the site holds its
     own animations still, and picks back up on this event. Every exit
     path has to fire it, or the page stays frozen waiting. */
  function announceEnd() {
    document.body.classList.remove('intro-running');
    try { document.dispatchEvent(new CustomEvent('portrait-intro:end')); } catch (e) {}
  }
  function bailOut() { host.remove(); announceEnd(); }

  if (!D || !D.dots || !D.dots.length) { bailOut(); return; }
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { bailOut(); return; }
  /* Not on phones. Thinning the field and pausing everything around it
     still left the run stuttering on real hardware, and a background
     flourish is not worth a janky first impression — so below the site's
     mobile breakpoint it does not run at all. Bailing out here still
     announces the end, so the hero's role rotation starts straight away
     rather than waiting on an intro that is never coming. */
  if (window.matchMedia('(max-width: 900px)').matches) { bailOut(); return; }

  var cvs = host.querySelector('canvas');
  var ctx = cvs && cvs.getContext ? cvs.getContext('2d') : null;
  if (!ctx) { bailOut(); return; }

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

  /* Quality tiers, best first. `stride` skips dots; `rBoost` fattens the
     survivors so the field keeps its ink weight when it does. Primitive
     count, not resolution, is what this costs — 3.6k arcs price the same
     whether the canvas is large or small — so the lower tiers thin the
     field rather than just dropping pixels. */
  var TIERS = [
    { dpr: 1.5,  stride: 1, rBoost: 1 },
    { dpr: 1.25, stride: 2, rBoost: 1.35 },
    { dpr: 1,    stride: 2, rBoost: 1.35 },
    { dpr: 1,    stride: 3, rBoost: 1.7 }
  ];
  /* Touch devices above the breakpoint — tablets, touch laptops — open on
     the thinned tier rather than discovering it a few janky frames in. */
  var tier = window.matchMedia('(pointer:coarse)').matches ? 1 : 0;

  function clamp(n, a, b) { return n < a ? a : (n > b ? b : n); }
  function hash(i, s) { var v = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453; return v - Math.floor(v); }
  function enter(t) { return 1 - Math.pow(1 - clamp(t, 0, 1), 3); }
  function wave(t)  { return 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1)); }

  /* ---- per-dot statics, built once the page is quiet ------- */
  var N = D.dots.length;
  var dx, dy, dr, dDist, dCos, dSin, dSx, dSy, dPh, dH2, dH3, dH4, dBre, dLoose;

  /* Cloud, not portrait. LOOSE_SHARE of the dots never fully gather —
     they hang in a soft halo part-way to their scatter positions — so the
     middle of the field holds ~30% less ink at its most formed. The rest
     are nudged off the halftone grid by up to CLOUD_JITTER, which breaks
     the scanline rows and keeps the silhouette abstract. */
  var LOOSE_SHARE  = 0.30;
  var CLOUD_JITTER = 16;   /* portrait units; the grid step is 13 */

  function build() {
    dx = new Float32Array(N); dy = new Float32Array(N); dr = new Float32Array(N);
    dDist = new Float32Array(N); dCos = new Float32Array(N); dSin = new Float32Array(N);
    dSx = new Float32Array(N); dSy = new Float32Array(N);
    dPh = new Float32Array(N); dH2 = new Float32Array(N); dH3 = new Float32Array(N);
    dH4 = new Float32Array(N); dBre = new Float32Array(N); dLoose = new Float32Array(N);
    for (var i = 0; i < N; i++) {
      var src = D.dots[i];
      var ja = hash(i, 7) * TAU, jr = CLOUD_JITTER * Math.sqrt(hash(i, 8));
      var x = src[0] + Math.cos(ja) * jr, y = src[1] + Math.sin(ja) * jr;
      dH4[i] = hash(i, 4);
      dLoose[i] = hash(i, 5) < LOOSE_SHARE ? 0.4 + 0.35 * hash(i, 6) : 0;
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

    /* Two cheap culls, both in portrait units. Dots that have flown off
       the canvas and dots that have shrunk below a device pixel still
       cost a full arc to submit, and by the tail of the expansion that
       is most of the field. Bounds are computed at zoom 1, which errs
       towards drawing, and the margin covers the camera drift. */
    var invS = 1 / scale;
    var bx0 = -ox * invS - 40, bx1 = (vw - ox) * invS + 40;
    var by0 = -oy * invS - camY - 40, by1 = (vh - oy) * invS - camY + 40;
    var minR = 0.4 / (scale * dpr);

    /* Cursor into dot space, inverting the camera applied above. */
    var mR2 = 0, mR = 0, mPush = 0, mpx = 0, mpy = 0;
    if (mStrength > 0.002) {
      mpx = (emx - ox) / scale;
      mpy = (emy - oy) / scale - camY;
      mpx = (mpx - CX) / zoom + CX;
      mpy = (mpy - CY) / zoom + CY;
      mR = MOUSE_R / (scale * zoom);
      mR2 = mR * mR;
      mPush = (MOUSE_PUSH / (scale * zoom)) * mStrength;
    }
    /* frame-rate independent easing for the per-dot cursor displacement */
    var steps = clamp((T - mLastT) * 60, 0, 4);
    mLastT = T;
    var aIn  = 1 - Math.pow(1 - MOUSE_IN,  steps);
    var aOut = 1 - Math.pow(1 - MOUSE_OUT, steps);
    var stillOff = false;

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

      /* radial ripples — each dot is pushed by its own amount and only
         some of them swell, so the crest reads as a scatter, not a ring */
      var env = 0;
      if (rip > 0) {
        var u = (dDist[i] - crest) * (1 / 150);
        env = Math.exp(-u * u) * rip;
        var push = 30 * env * (0.3 + 1.4 * dH2[i]);
        x += dCos[i] * push;
        y += dSin[i] * push;
        rs += 0.6 * env * dH4[i];
      }

      /* the crest passes, the dot lets go, and the swirl carries it out;
         loose dots never come in closer than their cloud floor */
      var k = kGather;
      if (kExit > 0) {
        var rel = (releaseAt - dDist[i]) * (1 / RELEASE_SOFT);
        k = kExit * (rel < 0 ? 0 : (rel > 1 ? 1 : rel));
      }
      if (k < dLoose[i]) k = dLoose[i];
      if (k > 0) {
        var tx = dSx[i] - CX, ty = dSy[i] - CY;
        x += (CX + tx * cs - ty * sn - dx[i]) * k;
        y += (CY + tx * sn + ty * cs - dy[i]) * k;
        rs *= 1 - 0.42 * k;
        rs += 0.5 * k * (1 - k) * (0.5 + dH2[i]);
      }

      /* Shoulder out of the cursor's way. Each dot carries its own
         displacement, which chases the cursor's push quickly on the way
         out but relaxes back slowly once the cursor has moved on, so the
         field heals behind it as a trail rather than snapping shut.
         Square distance first, so dots outside the bubble cost a compare. */
      if (mR2 > 0 || mActive) {
        var tdx = 0, tdy = 0, tsw = 0;
        if (mR2 > 0) {
          var mdx = x - mpx, mdy = y - mpy;
          var md2 = mdx * mdx + mdy * mdy;
          if (md2 < mR2) {
            var md = Math.sqrt(md2);
            var f = 1 - md / mR;
            f *= f;                     /* soft at the rim, firm at the core */
            var shove = mPush * f / (md || 1);
            /* outward shove plus a sideways twist, so the dots swirl
               around the cursor rather than just parting for it */
            tdx = (mdx - mdy * MOUSE_SWIRL) * shove;
            tdy = (mdy + mdx * MOUSE_SWIRL) * shove;
            tsw = 0.4 * f * mStrength;  /* the wake swells a little */
          }
        }
        var cdx = mOffX[i], cdy = mOffY[i];
        var a = (tdx * tdx + tdy * tdy > cdx * cdx + cdy * cdy) ? aIn : aOut;
        cdx += (tdx - cdx) * a;
        cdy += (tdy - cdy) * a;
        var csw = mOffS[i] + (tsw - mOffS[i]) * a;
        if (cdx * cdx + cdy * cdy < 0.01 && csw < 0.002) { cdx = cdy = csw = 0; }
        else stillOff = true;
        mOffX[i] = cdx; mOffY[i] = cdy; mOffS[i] = csw;
        x += cdx; y += cdy; rs *= 1 + csw;
      }

      var r = dr[i] * rBoost * rs;
      if (r < minR || x < bx0 || x > bx1 || y < by0 || y > by1) continue;
      /* Orange is a sparse sprinkle: a dot near the crest only turns if
         its own hash falls under the envelope, so the burst lands as
         dispersed flecks rather than a solid circle. */
      if (dH4[i] < 0.16 * env || (kExit > 0 && k > 0.15 && dH3[i] > 0.95)) {
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
    mActive = stillOff;
  }

  /* accent scratch buffers — sized once, never reallocated per frame */
  var accX = new Float32Array(N), accY = new Float32Array(N), accR = new Float32Array(N);

  /* ---- pointer repulsion ------------------------------------
     The cursor carries a soft field that shoulders dots out of its way.
     Both figures are CSS pixels, converted into portrait units per frame
     so the bubble is the same size on screen whatever the fit. The
     pointer itself is eased, and the strength ramps in and out, so
     arriving and leaving are not a snap. */
  var MOUSE_R = 260, MOUSE_PUSH = 150, MOUSE_SWIRL = 0.35;
  /* per-frame (at 60fps) easing: dots jump clear fast, drift home slowly */
  var MOUSE_IN = 0.35, MOUSE_OUT = 0.02;
  /* A resting cursor lets go: after this long without a move the push
     fades out and the dots drift home; the next move picks it back up. */
  var MOUSE_IDLE_MS = 140;
  var mLastMove = 0;
  var mOffX = new Float32Array(N), mOffY = new Float32Array(N), mOffS = new Float32Array(N);
  var mActive = false, mLastT = 0;
  var mx = 0, my = 0, emx = 0, emy = 0, mStrength = 0, mWanted = 0, mSeen = false;

  function onMove(e) {
    mx = e.clientX; my = e.clientY;
    if (!mSeen) { mSeen = true; emx = mx; emy = my; }   /* no swoop in from 0,0 */
    mWanted = 1;
    mLastMove = performance.now();
  }
  function onLeave() { mWanted = 0; }

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

    emx += (mx - emx) * 0.3;
    emy += (my - emy) * 0.3;
    if (mWanted && performance.now() - mLastMove > MOUSE_IDLE_MS) mWanted = 0;
    mStrength += (mWanted - mStrength) * 0.16;

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
    window.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseleave', onLeave);
    host.remove();
    announceEnd();
  }

  var resizePending = false;
  function onResize() {
    if (resizePending || done) return;
    /* iOS collapses its URL bar as you scroll, firing resize with a new
       height. Re-measuring reallocates the canvas backing store, so
       reacting to that mid-run is a stutter of our own making — take
       width changes and real rotations only, and let the canvas stretch
       the few percent that the bar is worth. */
    var box = host.getBoundingClientRect();
    if (Math.round(box.width) === vw && Math.abs(box.height - vh) < vh * 0.2) return;
    resizePending = true;
    window.requestAnimationFrame(function () { resizePending = false; measure(); });
  }

  function start() {
    build();
    measure();
    draw(0);                       /* first paint is the dispersed field */
    window.addEventListener('resize', onResize);
    window.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('mouseleave', onLeave);
    document.body.classList.add('intro-running');
    host.classList.add('is-in');
    rafId = window.requestAnimationFrame(frame);
  }

  /* Hold off until the page has genuinely finished, not merely fired
     load: wait for the load event, then for webfonts to settle, then for
     a few frames that actually arrive on time. On a phone `load` fires
     while images are still decoding and the hero reveal is still
     running, and starting into that is what makes the opening stutter. */
  function whenQuiet() {
    var giveUpAt = performance.now() + 4000, prev = 0, calm = 0;
    function tick(ts) {
      if (prev > 0 && ts - prev < 24) calm++; else calm = 0;
      prev = ts;
      if (calm >= 3 || performance.now() > giveUpAt) start();
      else window.requestAnimationFrame(tick);
    }
    window.requestAnimationFrame(tick);
  }

  function afterFonts() {
    var f = document.fonts && document.fonts.ready;
    if (f && f.then) f.then(whenQuiet); else whenQuiet();
  }

  if (document.readyState === 'complete') afterFonts();
  else window.addEventListener('load', afterFonts, { once: true });
})();
