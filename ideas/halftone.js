/* Halftone circles, after the Masters of Computing portraits.
   halftone(canvas, img, opts) draws img into canvas as black dots on a white
   disc. Dot area tracks darkness on a 45° screen.
   Images must be same-origin (getImageData), so preview through serve.py. */
(function () {
  "use strict";

  var cache = new Map();

  function load(src) {
    if (cache.has(src)) return cache.get(src);
    var p = new Promise(function (res, rej) {
      var img = new Image();
      img.decoding = "async";
      img.onload = function () { res(img); };
      img.onerror = rej;
      img.src = src;
    });
    cache.set(src, p);
    return p;
  }

  /* Cover-fit the image into an n×n grayscale field, levels-normalised. */
  function field(img, n, focusY) {
    var c = document.createElement("canvas");
    c.width = c.height = n;
    var x = c.getContext("2d", { willReadFrequently: true });
    var s = Math.max(n / img.naturalWidth, n / img.naturalHeight);
    var w = img.naturalWidth * s, h = img.naturalHeight * s;
    x.drawImage(img, (n - w) / 2, (n - h) * (focusY == null ? 0.5 : focusY), w, h);
    var d = x.getImageData(0, 0, n, n).data;
    var g = new Float32Array(n * n), i;
    for (i = 0; i < n * n; i++) {
      g[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
    }
    var sorted = g.slice().sort();
    var lo = sorted[Math.floor(sorted.length * 0.03)];
    var hi = sorted[Math.floor(sorted.length * 0.97)];
    var span = Math.max(hi - lo, 0.05);
    for (i = 0; i < n * n; i++) g[i] = Math.min(1, Math.max(0, (g[i] - lo) / span));
    return { g: g, n: n };
  }

  function draw(canvas, f, o, push) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var size = canvas.clientWidth || o.size || 400;
    if (canvas.width !== Math.round(size * dpr)) {
      canvas.width = canvas.height = Math.round(size * dpr);
    }
    var ctx = canvas.getContext("2d");
    var S = canvas.width, cell = (o.cell || 14) * dpr * (size / (o.ref || size));
    cell = Math.max(cell, 4 * dpr);
    var ang = (o.angle == null ? 45 : o.angle) * Math.PI / 180;
    var ca = Math.cos(ang), sa = Math.sin(ang), r0 = S / 2, half = cell / 2;
    var gamma = o.gamma || 1.25;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(r0, r0, r0, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = o.bg || "#fff";
    ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = o.ink || "#000";
    ctx.beginPath();

    var reach = Math.ceil((S * 0.75) / cell);
    for (var j = -reach; j <= reach; j++) {
      for (var i = -reach; i <= reach; i++) {
        var u = i * cell, v = j * cell;
        var px = r0 + u * ca - v * sa, py = r0 + u * sa + v * ca;
        var dx = px - r0, dy = py - r0;
        if (dx * dx + dy * dy > (r0 + cell) * (r0 + cell)) continue;
        var fx = Math.min(f.n - 1, Math.max(0, Math.floor(px / S * f.n)));
        var fy = Math.min(f.n - 1, Math.max(0, Math.floor(py / S * f.n)));
        var b = Math.pow(1 - f.g[fy * f.n + fx], gamma);
        var r = half * 1.08 * Math.sqrt(b);
        if (push) {
          var qx = px - push.x * dpr, qy = py - push.y * dpr;
          var dist = Math.sqrt(qx * qx + qy * qy), R = push.r * dpr;
          if (dist < R) r *= 0.25 + 0.75 * Math.pow(dist / R, 1.6);
        }
        if (r < 0.35 * dpr) continue;
        ctx.moveTo(px + r, py);
        ctx.arc(px, py, r, 0, Math.PI * 2);
      }
    }
    ctx.fill();
    ctx.restore();
  }

  /* Render once. Returns a redraw(push) fn for interactive use. */
  function halftone(canvas, src, o) {
    o = o || {};
    return load(src).then(function (img) {
      var f = field(img, o.res || 140, o.focusY);
      var redraw = function (push) { draw(canvas, f, o, push); };
      redraw();
      var ro = new ResizeObserver(function () { redraw(); });
      ro.observe(canvas);
      return redraw;
    });
  }

  window.halftone = halftone;
})();
