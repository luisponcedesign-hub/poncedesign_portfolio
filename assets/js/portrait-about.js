/* ============================================================
   Ponce Design — About portrait, gathered
   The circular About headshot is the same authored dot field as
   the home page intro, so it arrives the same way: dispersed and
   spiralled out, easing into the face as the portrait scrolls up.
   Where the intro then breathes, ripples and leaves, this one
   stops on the settled frame and stays — the canvas becomes the
   portrait, and nothing keeps running behind it.

   The <img> stays in the markup as the source of truth: it holds
   the alt text, it is what prints, and it is what remains under
   reduced motion or if any of this cannot start. It is only
   dimmed once the canvas is measured and has a frame to show.
   ============================================================ */
(function () {
  'use strict';

  var D    = window.PORTRAIT_DOTS;
  var host = document.querySelector('.about .portrait');
  if (!host) return;
  var img = host.querySelector('img');
  if (!D || !D.dots || !D.dots.length || !img) return;
  if (!('IntersectionObserver' in window)) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var cvs = document.createElement('canvas');
  cvs.className = 'portrait-canvas';
  cvs.setAttribute('aria-hidden', 'true');
  var ctx = cvs.getContext ? cvs.getContext('2d') : null;
  if (!ctx) return;

  var W = D.w, H = D.h;
  var CX = W * 0.5, CY = H * 0.40;   /* the face, not the bounding box */
  var TAU = Math.PI * 2;

  var INK    = '#16151A';
  var ACCENT = '#E8630B';

  var GATHER = 3.4;   /* dispersed field eases into the portrait */
  var SPIN   = 0.55;  /* …unwinding this much as it comes in     */

  /* Cursor repulsion, as on the home page — but in composition units rather
     than the intro's CSS pixels. The intro's 165px bubble is measured
     against a portrait blown up to fill the viewport; carried over at face
     value it would swallow this circle whole. Held in composition units it
     keeps the same size relative to the face at any size the circle takes. */
  var MOUSE_R    = 253;   /* how far the bubble reaches */
  var MOUSE_PUSH = 56;    /* how hard it shoves         */

  /* The frame the <img> occupies, restated so the canvas lands on exactly
     the same pixels: `object-fit:contain` into the square, then the
     transform that closes the gap contain leaves at the sides. Change
     either of these in .portrait img and change them here too. */
  var FIT_SCALE = 1.12;   /* transform: scale()          */
  var FIT_SHIFT = 0.02;   /* transform: translateY(), of the box height */

  function clamp(n, a, b) { return n < a ? a : (n > b ? b : n); }
  function hash(i, s) { var v = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453; return v - Math.floor(v); }
  function enter(t) { return 1 - Math.pow(1 - clamp(t, 0, 1), 3); }

  /* ---- per-dot statics ------------------------------------- */
  var N = D.dots.length;
  var dx = new Float32Array(N), dy = new Float32Array(N), dr = new Float32Array(N);
  var dSx = new Float32Array(N), dSy = new Float32Array(N);
  var dH2 = new Float32Array(N), dH3 = new Float32Array(N);

  for (var i = 0; i < N; i++) {
    var src = D.dots[i];
    var x = src[0], y = src[1];
    var dist = Math.hypot(x - CX, y - CY);
    var ang  = Math.atan2(y - CY, x - CX);
    var h1 = hash(i, 1), h2 = hash(i, 2), h3 = hash(i, 3);
    /* Same dispersal as the intro: swung round the face and pushed out
       past it, so every dot has ground to cover and none of them travels
       the same distance. The circle crops all of this — what reads is
       dots arriving through the rim rather than a field shrinking. */
    var sang  = ang + 0.75 + h1 * 0.7;
    var sdist = dist * 1.06 + 70 + h2 * 250;
    dx[i] = x; dy[i] = y; dr[i] = src[2];
    dSx[i] = CX + Math.cos(sang) * sdist;
    dSy[i] = CY + Math.sin(sang) * sdist * 0.88;
    dH2[i] = h2; dH3[i] = h3;
  }

  /* accent scratch buffers — sized once, never reallocated per frame */
  var accX = new Float32Array(N), accY = new Float32Array(N), accR = new Float32Array(N);

  /* ---- fit the composition into the circle ------------------ */
  var vw = 0, vh = 0, dpr = 1, scale = 1, ox = 0, oy = 0;

  function measure() {
    /* The canvas's own box, not the circle's: the canvas fills the padding
       box, which is exactly the box the <img> fills, so the fit below is
       the image's fit rather than one border off it. */
    var box = cvs.getBoundingClientRect();
    vw = Math.max(1, box.width);
    vh = Math.max(1, box.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    /* Backing store only — the canvas takes its CSS size from the circle, so
       a measurement taken before the frame settles costs resolution for a
       frame rather than pinning the canvas to the wrong size. */
    cvs.width  = Math.round(vw * dpr);
    cvs.height = Math.round(vh * dpr);

    var base = Math.min(vw / W, vh / H);          /* contain */
    var bx = (vw - W * base) * 0.5, by = (vh - H * base) * 0.5;
    scale = base * FIT_SCALE;                     /* then the transform, */
    ox = vw * 0.5 + (bx - vw * 0.5) * FIT_SCALE;  /* about the box centre */
    oy = vh * 0.5 + (by - vh * 0.5) * FIT_SCALE + FIT_SHIFT * vh * FIT_SCALE;
  }

  /* ---- the cursor ------------------------------------------
     Two easings, both lifted from the intro: the pointer itself is chased
     rather than followed, and the strength ramps in and out, so arriving
     and leaving are not a snap. The dots are only ever pushed — nothing
     here moves the portrait itself. */
  var mx = 0, my = 0, emx = 0, emy = 0, mStrength = 0, mWanted = 0, mSeen = false;

  host.addEventListener('mousemove', function (e) {
    mx = e.clientX; my = e.clientY;
    if (!mSeen) { mSeen = true; emx = mx; emy = my; }   /* no swoop in from 0,0 */
    mWanted = 1;
    ensureRunning();
  });
  host.addEventListener('mouseleave', function () { mWanted = 0; });

  /* ---- one frame ------------------------------------------- */
  function draw(T) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);

    var k  = T < GATHER ? 1 - enter(T / GATHER) : 0;
    var sp = SPIN * k;
    var cs = Math.cos(sp), sn = Math.sin(sp);

    /* Dots that have not landed yet can be a long way outside the circle.
       Culling them in composition units costs a compare where an arc plus
       a fill would cost far more, and early on that is most of the field. */
    var invS = 1 / scale;
    var bx0 = -ox * invS - 20, bx1 = (vw - ox) * invS + 20;
    var by0 = -oy * invS - 20, by1 = (vh - oy) * invS + 20;
    var minR = 0.4 / (scale * dpr);

    /* The cursor, carried into dot space by inverting the transform above.
       The canvas is sticky, so its box is read per frame rather than cached. */
    var mR2 = 0, mR = 0, mPush = 0, mpx = 0, mpy = 0;
    if (mStrength > 0.002) {
      var box = cvs.getBoundingClientRect();
      mpx = (emx - box.left - ox) * invS;
      mpy = (emy - box.top - oy) * invS;
      mR = MOUSE_R; mR2 = mR * mR;
      mPush = MOUSE_PUSH * mStrength;
    }

    /* Accents are a thin slice of the field, so they are collected as we go
       and filled in a second pass rather than costing a branch per dot. */
    var accN = 0;
    ctx.beginPath();

    for (var i = 0; i < N; i++) {
      var x = dx[i], y = dy[i], rs = 1;

      if (k > 0) {
        var tx = dSx[i] - CX, ty = dSy[i] - CY;
        x += (CX + tx * cs - ty * sn - dx[i]) * k;
        y += (CY + tx * sn + ty * cs - dy[i]) * k;
        /* smaller in flight, with a swell through the middle of the trip,
           so the field gains its weight as it settles rather than sliding
           a finished portrait into place */
        rs *= 1 - 0.42 * k;
        rs += 0.5 * k * (1 - k) * (0.5 + dH2[i]);
      }

      /* shoulder out of the cursor's way — square distance first, so dots
         outside the bubble cost a compare and nothing else */
      if (mR2 > 0) {
        var mdx = x - mpx, mdy = y - mpy;
        var md2 = mdx * mdx + mdy * mdy;
        if (md2 < mR2) {
          var md = Math.sqrt(md2);
          var f = 1 - md / mR;
          f *= f;                      /* soft at the rim, firm at the core */
          var shove = mPush * f / (md || 1);
          x += mdx * shove;
          y += mdy * shove;
        }
      }

      var r = dr[i] * rs;
      if (r < minR || x < bx0 || x > bx1 || y < by0 || y > by1) continue;
      if (k > 0.15 && dH3[i] > 0.93) {
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

  /* ---- gather once, then hold; turn again for the cursor ----
     The loop stops the moment there is nothing left to move — the field has
     settled and the cursor's push has eased back to nothing — and the frame
     it stops on is the finished portrait. A cursor over the circle starts it
     turning again, and letting go stops it again. */
  var T = 0, last = 0, rafId = 0, running = false, settled = false, armed = false;

  function frame(ts) {
    if (!last) last = ts;
    var dt = Math.min((ts - last) / 1000, 0.05);   /* survive a backgrounded tab */
    last = ts;

    if (armed && !settled) {
      T += dt;
      if (T >= GATHER) { T = GATHER; settled = true; }
    }

    emx += (mx - emx) * 0.25;
    emy += (my - emy) * 0.25;
    mStrength += (mWanted - mStrength) * 0.12;
    if (!mWanted && mStrength < 0.002) mStrength = 0;   /* land on nothing, exactly */

    draw(T);

    /* `!armed` covers a cursor that finds the circle before the scroll
       trigger does — otherwise the loop would turn forever on a field that
       has not been told to gather yet. */
    if ((settled || !armed) && mStrength === 0) { running = false; return; }
    rafId = window.requestAnimationFrame(frame);
  }

  function ensureRunning() {
    if (running || vw < 40) return;
    running = true;
    last = 0;
    rafId = window.requestAnimationFrame(frame);
  }

  /* Two things have to be true before the dots come in: the portrait is on
     screen, and it has a frame to come in to. The circle is sized from the
     lazy-loaded <img>, so it is two pixels wide until that lands — often
     well after it has scrolled into view. */
  function maybePlay() {
    if (!armed || settled) return;
    ensureRunning();
  }

  /* The canvas only takes over once it has measured and drawn, so a
     failure anywhere above leaves the plain portrait in place. */
  host.insertBefore(cvs, img);
  measure();
  draw(0);
  host.classList.add('has-dots');

  /* The portrait is lazy-loaded and the circle is sized from the image's
     own width, so this box is a couple of pixels wide until that lands —
     which is a resize the window never reports. Watch the element itself
     and the load, the reflow and a real window resize are all one path. */
  var resizePending = false;
  function refit() {
    if (resizePending) return;
    if (Math.round(cvs.getBoundingClientRect().width) === Math.round(vw)) return;
    resizePending = true;
    window.requestAnimationFrame(function () {
      resizePending = false;
      measure();
      if (!running) draw(settled ? GATHER : T);
      maybePlay();
    });
  }
  if ('ResizeObserver' in window) new ResizeObserver(refit).observe(host);
  else window.addEventListener('resize', refit);

  /* The dots come in when the circle does. Same trigger the rest of the page
     reveals on — `rootMargin`/`threshold` are main.js's reveal figures — so
     the container fading up and the field gathering are one moment rather
     than two, and the gather has the whole scroll-in to play across.

     Nothing waits on the home page intro. It gates its own drawing on the
     hero, so by the time the About circle is on screen the intro has already
     stopped painting; holding the dots back for it would only leave a
     scattered field sitting there while someone looks straight at it.

     Once is enough — the observer reports the element again on the way back
     up, and the portrait has already formed by then. */
  var io = new IntersectionObserver(function (entries) {
    for (var e = 0; e < entries.length; e++) {
      if (!entries[e].isIntersecting) continue;
      io.disconnect();
      armed = true;
      maybePlay();
      return;
    }
  }, { rootMargin: '0px 0px -9% 0px', threshold: 0.06 });
  io.observe(host);

  /* …and again whenever the circle is clicked. A click mid-gather rewinds
     rather than starting a second loop — the one already turning picks the
     new T up on its next frame, so leaning on it cannot stack rAFs. */
  host.addEventListener('click', function () {
    T = 0;
    last = 0;
    settled = false;
    armed = true;
    ensureRunning();
  });
})();
