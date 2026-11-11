/*
 * DotOrb — the poncedesign.com About portrait, carried into a chat orb.
 *
 * The face is the site's own authored dot field (window.PORTRAIT_DOTS, as
 * used by assets/js/portrait-about.js), fitted into the circle exactly the
 * way the About page fits it, with the same three behaviours:
 *   · gathers in from a dispersed spiral when it comes into view (3.4s)
 *   · dots shoulder out of the cursor's way
 *   · clicking the portrait replays the gather
 *
 * When a session opens, those same particles morph in one continuous move:
 *   m = 0  portrait   →   m = 2  sunburst
 * Every portrait dot heads for its nearest sunburst dot, swelling and warming
 * to orange as it travels, so the face pools into fewer, bigger dots.
 *
 * Everything is laid out in a 112px "design space" (circle radius 56) and
 * scaled to whatever size the host element is, so the same orb works at the
 * prototype's 112px and at the About page's 335px circle.
 */
(function () {
  const DESIGN = 112;                 // design-space diameter of the circle
  const R = DESIGN / 2;
  const PAD = 1.4;                    // canvas is 1.4× the circle so the sunburst can breathe past it
  const TAU = Math.PI * 2;

  const INK = [22, 21, 26];           // #16151A — the site's ink
  const ACCENT = [232, 99, 11];       // #E8630B — the site's in-flight accent
  const ORANGE = [242, 153, 74];      // sunburst

  // portrait-about.js constants, kept identical
  const GATHER = 3.4, SPIN = 0.55;
  const MOUSE_R = 253, MOUSE_PUSH = 56;      // composition units
  const SUN_R = 34, SUN_PUSH = 12;           // design units: the sunburst's own, gentler bubble
  const FIT_SCALE = 1.12, FIT_SHIFT = 0.02;

  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
  const easeOutBack = (t) => { const c = 1.4; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const enter = (t) => 1 - Math.pow(1 - clamp(t), 3);
  const hash = (i, s) => { const v = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453; return v - Math.floor(v); };

  // ---------- Shapes (design space, centred on 0,0) ----------

  function buildFace(D) {
    // Same fit as `.portrait img { object-fit: contain; transform: scale(1.12) translateY(2%) }`
    const S = DESIGN, W = D.w, H = D.h;
    const base = Math.min(S / W, S / H);
    const bx = (S - W * base) / 2, by = (S - H * base) / 2;
    const k = base * FIT_SCALE;
    const ox = S / 2 + (bx - S / 2) * FIT_SCALE - S / 2;
    const oy = S / 2 + (by - S / 2) * FIT_SCALE + FIT_SHIFT * S * FIT_SCALE - S / 2;
    const T = (x, y) => [x * k + ox, y * k + oy];

    const CX = W * 0.5, CY = H * 0.4;
    const dots = D.dots.map((d, i) => {
      const [x, y, r] = d;
      const dist = Math.hypot(x - CX, y - CY), ang = Math.atan2(y - CY, x - CX);
      const h1 = hash(i, 1), h2 = hash(i, 2), h3 = hash(i, 3);
      const sang = ang + 0.75 + h1 * 0.7;
      const sdist = dist * 1.06 + 70 + h2 * 250;
      const [fx, fy] = T(x, y);
      const [sx, sy] = T(CX + Math.cos(sang) * sdist, CY + Math.sin(sang) * sdist * 0.88);
      return { x: fx, y: fy, r: r * k, dsx: sx, dsy: sy, h2, accent: h3 > 0.93 };
    });
    const [cx, cy] = T(CX, CY);
    return { dots, cx, cy, unit: k };
  }

  function buildSun() {
    const rings = [
      { d: 0, n: 1, r: 9.5, o: 0 },
      { d: 20, n: 6, r: 6.6, o: -90 },
      { d: 35, n: 12, r: 5.2, o: -75 },
      { d: 49, n: 12, r: 4.2, o: -90 },
      { d: 54, n: 12, r: 2.6, o: -75 },
    ];
    const dots = [];
    for (const ring of rings) {
      for (let i = 0; i < ring.n; i++) {
        const a = ((ring.o + (360 / ring.n) * i) * Math.PI) / 180;
        dots.push({ x: Math.cos(a) * ring.d, y: Math.sin(a) * ring.d, r: ring.r });
      }
    }
    return dots;
  }

  const nearest = (p, list) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < list.length; i++) {
      const dx = list[i].x - p.x, dy = list[i].y - p.y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };

  // ---------- Orb ----------

  class DotOrb {
    /**
     * @param {HTMLElement} host   the circular element (its width sets the size)
     * @param {HTMLCanvasElement} canvas
     * @param {{w:number,h:number,dots:number[][]}} dotData  window.PORTRAIT_DOTS
     */
    constructor(host, canvas, dotData) {
      this.host = host;
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

      this.m = 0; this.target = 0;            // morph
      this.energy = 0; this.energyTarget = 0; // activity ripple
      this.time = 0;
      this.T = this.reduced ? GATHER : 0;     // gather clock
      this.gathering = false;
      this.running = false;
      this.onSettle = null;

      // cursor (eased like the site: chased position, ramped strength)
      this.mouse = { x: 0, y: 0, ex: 0, ey: 0, s: 0, want: 0, seen: false };

      const face = buildFace(dotData);
      this.face = face;
      this.mouseR = MOUSE_R * face.unit;
      this.mousePush = MOUSE_PUSH * face.unit;
      this.sun = buildSun();
      this.buildParticles();

      // pre-built list for the fully bloomed state
      this.sunOnly = this.sun.map((s) => ({ f: null, sx: s.x, sy: s.y, sr: s.r, d: 0, spin: 0, sd: Math.hypot(s.x, s.y) / 58 }));

      this.bindPointer();
      this.resize();
      if ("ResizeObserver" in window) new ResizeObserver(() => this.resize()).observe(host);
      else addEventListener("resize", () => this.resize());
    }

    buildParticles() {
      const { face, sun } = this;
      const sunHit = new Array(sun.length).fill(false);
      const P = [];
      const add = (f, si, rnd) => {
        const s = sun[si];
        const fd = clamp(Math.hypot(f.x, f.y) / (R * 1.4));
        P.push({
          f,
          sx: s.x, sy: s.y, sr: s.r,
          sd: Math.hypot(s.x, s.y) / 58,
          // stagger by distance from the centre; opening runs the closing
          // timeline backwards, so the two moves mirror each other exactly
          d: 0.26 * (0.5 * rnd(1) + 0.5 * (1 - fd)),
          spin: 0.6 + rnd(3) * 0.4,
        });
      };
      face.dots.forEach((f, i) => {
        const si = nearest(f, sun);
        sunHit[si] = true;
        add(f, si, (s) => hash(i, s + 10));
      });
      // safety: any sunburst dot no portrait dot reaches grows in place
      sun.forEach((s, si) => {
        if (!sunHit[si]) add({ x: s.x, y: s.y, r: 0, dsx: s.x, dsy: s.y, h2: 0, accent: false }, si, (q) => hash(9000 + si, q));
      });
      this.particles = P;
    }

    bindPointer() {
      const m = this.mouse;
      this.host.addEventListener("mousemove", (e) => {
        m.x = e.clientX; m.y = e.clientY;
        if (!m.seen) { m.seen = true; m.ex = m.x; m.ey = m.y; }
        m.want = 1;
        this.start();
      });
      this.host.addEventListener("mouseleave", () => { m.want = 0; });
    }

    resize() {
      // layout width, not the on-screen box: the page reveal scales the circle in
      const size = this.host.offsetWidth || DESIGN;
      const css = size * PAD;
      this.scale = size / DESIGN;
      this.css = css;
      this.canvas.style.width = this.canvas.style.height = css + "px";
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      this.canvas.width = Math.round(css * dpr);
      this.canvas.height = Math.round(css * dpr);
      this.ctx.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, (css * dpr) / 2, (css * dpr) / 2);
      this.minR = 0.4 / (dpr * this.scale);
      this.draw();
    }

    // ---------- public API ----------

    /** Replay the portrait gathering in (site behaviour on view / click). */
    gather() {
      if (this.reduced) return;
      this.T = 0;
      this.gathering = true;
      this.start();
    }

    /** Full morph durations in ms (portrait → sunburst, and back). */
    // opening plays the closing morph in reverse: same length, same path
    get durationIn() { return this.reduced ? 500 : 950; }
    get durationOut() { return this.reduced ? 500 : 950; }

    /** 0 = portrait, 2 = sunburst */
    morphTo(target) {
      this.target = target;
      this.start();
    }

    setActivity(level) {
      this.energyTarget = level === "thinking" ? 1 : level === "speaking" ? 0.45 : 0;
      this.start();
    }

    // ---------- loop ----------

    start() {
      if (this.running) return;
      this.running = true;
      this.last = 0;
      const tick = (now) => {
        if (!this.last) this.last = now;
        const dt = Math.min(64, now - this.last);
        this.last = now;
        this.update(dt);
        this.draw();
        const idle = this.m === 0 && this.target === 0 && !this.gathering && this.mouse.s === 0 && this.energy < 0.001;
        if (idle) { this.running = false; return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }

    update(dt) {
      const s = dt / 1000;
      this.time += s;
      this.turn = (this.turn || 0) + s * 0.06 * clamp(this.m - 1.6, 0, 0.4) / 0.4;   // idle turn, only once bloomed

      if (this.gathering) {
        this.T += s;
        if (this.T >= GATHER) { this.T = GATHER; this.gathering = false; }
      }

      const m = this.mouse;
      m.ex += (m.x - m.ex) * 0.25;
      m.ey += (m.y - m.ey) * 0.25;
      m.s += (m.want - m.s) * 0.12;
      if (!m.want && m.s < 0.002) m.s = 0;

      if (this.m !== this.target) {
        const prev = this.m, forward = this.target > this.m;
        const perUnit = (forward ? this.durationIn : this.durationOut) / 2;
        const step = dt / perUnit;
        this.m = forward ? Math.min(this.target, this.m + step) : Math.max(this.target, this.m - step);
        if (this.m === this.target && prev !== this.m && this.onSettle) this.onSettle(this.m);
      }
      this.energy += (this.energyTarget - this.energy) * (1 - Math.exp(-dt / 260));
    }

    // ---------- drawing ----------

    draw() {
      const ctx = this.ctx, half = (this.css / this.scale) / 2;
      ctx.clearRect(-half, -half, half * 2, half * 2);
      const m = this.m, t = this.time, e = this.energy;

      // gather state (k: 1 dispersed → 0 settled)
      const k = this.T < GATHER ? 1 - enter(this.T / GATHER) : 0;
      const cs = Math.cos(SPIN * k), sn = Math.sin(SPIN * k);
      const { cx, cy } = this.face;

      // cursor in design space. The portrait and the sunburst each have their
      // own bubble; one fades out and the other in as the morph runs.
      let mR2 = 0, mpx = 0, mpy = 0, push = 0, sunPush = 0;
      const faceW = 1 - clamp(m * 3);
      const sunW = clamp((m - 1.5) * 2);
      if (this.mouse.s > 0.002 && (faceW > 0 || sunW > 0)) {
        const box = this.canvas.getBoundingClientRect();
        const ratio = (this.css / this.scale) / box.width;   // survives CSS transforms
        mpx = (this.mouse.ex - box.left) * ratio - half;
        mpy = (this.mouse.ey - box.top) * ratio - half;
        if (faceW > 0) {
          mR2 = this.mouseR * this.mouseR;
          push = this.mousePush * this.mouse.s * faceW;
        }
        sunPush = SUN_PUSH * this.mouse.s * sunW;
      }
      const facePos = (f, out) => {
        let x = f.x, y = f.y, rs = 1;
        if (k > 0) {
          const tx = f.dsx - cx, ty = f.dsy - cy;
          x += (cx + tx * cs - ty * sn - f.x) * k;
          y += (cy + tx * sn + ty * cs - f.y) * k;
          rs = 1 - 0.42 * k + 0.5 * k * (1 - k) * (0.5 + f.h2);
        }
        if (mR2 > 0) {
          const dx = x - mpx, dy = y - mpy, d2 = dx * dx + dy * dy;
          if (d2 < mR2) {
            const d = Math.sqrt(d2);
            let fz = 1 - d / this.mouseR; fz *= fz;
            const sh = (push * fz) / (d || 1);
            x += dx * sh; y += dy * sh;
          }
        }
        out.x = x; out.y = y; out.r = f.r * rs;
        out.accent = f.accent && k > 0.15;
        return out;
      };

      // circular frame (the About page's overflow:hidden + 1px border)
      ctx.save();
      if (m < 2) {
        // keep the About page's circular crop all the way through, opening a
        // touch so the bloomed sunburst can breathe; off-frame dots arrive through the rim
        ctx.beginPath();
        ctx.arc(0, 0, R + 0.5 + clamp(m / 2) * 8, 0, TAU);
        ctx.clip();
      }
      const ring = 1 - clamp(m * 2.2);
      if (ring > 0) {
        ctx.beginPath();
        ctx.arc(0, 0, R, 0, TAU);
        ctx.strokeStyle = `rgba(0,0,0,${0.1 * ring})`;
        ctx.lineWidth = 1 / this.scale;
        ctx.stroke();
      }

      const tmp = {};
      if (m === 0) {
        // the portrait: two batched fills, ink then accent, as on the site
        const ink = new Path2D(), acc = new Path2D();
        for (const p of this.particles) {
          if (p.f.r <= 0) continue;
          facePos(p.f, tmp);
          if (tmp.r < this.minR) continue;
          const path = tmp.accent ? acc : ink;
          path.moveTo(tmp.x + tmp.r, tmp.y);
          path.arc(tmp.x, tmp.y, tmp.r, 0, TAU);
        }
        ctx.fillStyle = `rgb(${INK})`; ctx.fill(ink);
        ctx.fillStyle = `rgb(${ACCENT})`; ctx.fill(acc);
        ctx.restore();
        return;
      }

      // morphing: colours are bucketed so thousands of dots cost a handful of fills
      const BUCKETS = 12;
      const paths = Array.from({ length: BUCKETS + 2 }, () => new Path2D());
      const alive = clamp(m - 1);   // idle motion eases in over the second half
      const rot = this.reduced ? 0 : this.turn;
      const cR = Math.cos(rot), sR = Math.sin(rot);
      const span = 0.74;
      // the whole sunburst breathes as it turns: a slow swell and settle (~5s a breath)
      const breath = this.reduced ? 1 : 1 + 0.04 * Math.sin(t * 1.25) * alive;
      const list = m === 2 ? this.sunOnly : this.particles;

      const u = m / 2;          // single continuous phase
      for (const p of list) {
        // the sunburst target, alive: slow turn, breathing, thinking ripple
        const wave = Math.sin(t * 5 - p.sd * 6);
        const breathe = this.reduced ? 0 : 0.04 * Math.sin(t * 1.4 + p.sd * 3) * alive;
        const pushOut = (1 + e * 0.05 * wave) * breath;
        const sx = (p.sx * cR - p.sy * sR) * pushOut;
        const sy = (p.sx * sR + p.sy * cR) * pushOut;
        const sr = p.sr * (1 + breathe + e * 0.2 * wave) * (1 + (breath - 1) * 0.5);

        let x, y, r, bucket;
        if (m === 2) {
          x = sx; y = sy; r = sr; bucket = BUCKETS;
        } else {
          facePos(p.f, tmp);
          const raw = clamp((u - p.d) / span);
          const ta = easeInOutSine(raw);
          const sw = Math.sin(Math.PI * ta) * 0.12 * p.spin;   // a slight drift, not a spin
          const bx = lerp(tmp.x, sx, ta), by = lerp(tmp.y, sy, ta);
          const c = Math.cos(sw), s = Math.sin(sw);
          x = bx * c - by * s;
          y = bx * s + by * c;
          // stays a fine stipple while travelling and only swells as it lands,
          // with a soft pulse on arrival — so the flow never clots into a mass
          const grow = Math.pow(ta, 2.4);
          const land = Math.sin(Math.PI * clamp((raw - 0.75) / 0.25)) * 0.05;
          r = Math.max(0, lerp(tmp.r, sr, grow) * (1 + land));
          const mix = clamp(ta * 1.8 - 0.15);   // warms to orange early, while still small
          bucket = tmp.accent && mix === 0 ? BUCKETS + 1 : Math.round(mix * BUCKETS);
        }
        // sunburst dots step aside from the cursor; the eased strength
        // brings them home once the pointer leaves
        if (sunPush > 0) {
          const dx = x - mpx, dy = y - mpy, d2 = dx * dx + dy * dy;
          if (d2 < SUN_R * SUN_R) {
            const d = Math.sqrt(d2);
            let fz = 1 - d / SUN_R; fz *= fz;
            const sh = (sunPush * fz) / (d || 1);
            x += dx * sh; y += dy * sh;
          }
        }
        if (r < this.minR) continue;
        paths[bucket].moveTo(x + r, y);
        paths[bucket].arc(x, y, r, 0, TAU);
      }

      for (let b = 0; b <= BUCKETS; b++) {
        const c = b / BUCKETS;
        ctx.fillStyle = `rgb(${lerp(INK[0], ORANGE[0], c) | 0},${lerp(INK[1], ORANGE[1], c) | 0},${lerp(INK[2], ORANGE[2], c) | 0})`;
        ctx.fill(paths[b]);
      }
      ctx.fillStyle = `rgb(${ACCENT})`;
      ctx.fill(paths[BUCKETS + 1]);
      ctx.restore();
    }
  }

  window.DotOrb = DotOrb;
})();
