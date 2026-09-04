/* ============================================================
   Ponce Design — interaction layer
   Vanilla JS, no dependencies. Every effect is opt-out under
   prefers-reduced-motion.
   ============================================================ */
(function () {
  'use strict';

  var RM = window.matchMedia('(prefers-reduced-motion: reduce)');
  var reduced = RM.matches;
  RM.addEventListener && RM.addEventListener('change', function (e) { reduced = e.matches; });

  var $  = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var raf = window.requestAnimationFrame.bind(window);
  var clamp = function (n, a, b) { return Math.min(b, Math.max(a, n)); };

  /* ----------------------------------------------------------
     1. Scroll progress bar
     ---------------------------------------------------------- */
  function progressBar() {
    var bar = $('#progress');
    if (!bar) return;
    var ticking = false;
    function draw() {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      var p = h > 0 ? clamp(window.scrollY / h, 0, 1) : 0;
      bar.style.transform = 'scaleX(' + p + ')';
      ticking = false;
    }
    addEventListener('scroll', function () {
      if (!ticking) { ticking = true; raf(draw); }
    }, { passive: true });
    addEventListener('resize', draw, { passive: true });
    draw();
  }

  /* ----------------------------------------------------------
     2. Header — condense on scroll, hide on scroll down
     ---------------------------------------------------------- */
  function header() {
    var hdr = $('.hdr');
    if (!hdr) return;
    var last = 0, ticking = false;
    function draw() {
      var y = window.scrollY;
      hdr.classList.toggle('stuck', y > 24);
      // only auto-hide well past the fold, and never while the menu is open
      var hide = y > 420 && y > last && !document.body.classList.contains('menu-open');
      hdr.classList.toggle('hide', hide);
      last = y;
      ticking = false;
    }
    addEventListener('scroll', function () {
      if (!ticking) { ticking = true; raf(draw); }
    }, { passive: true });
    draw();
  }

  /* ----------------------------------------------------------
     3. Custom cursor + magnetic elements  (fine pointers only)
     ---------------------------------------------------------- */
  function cursor() {
    if (reduced || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    var dot = $('#cursor');
    if (!dot) return;

    var tx = 0, ty = 0, cx = 0, cy = 0, running = false;

    function loop() {
      cx += (tx - cx) * 0.19;
      cy += (ty - cy) * 0.19;
      dot.style.transform = 'translate3d(' + cx.toFixed(2) + 'px,' + cy.toFixed(2) + 'px,0)';
      if (Math.abs(tx - cx) > 0.1 || Math.abs(ty - cy) > 0.1) { raf(loop); } else { running = false; }
    }
    function kick() { if (!running) { running = true; raf(loop); } }

    addEventListener('mousemove', function (e) {
      tx = e.clientX; ty = e.clientY;
      dot.classList.add('on');
      kick();
    }, { passive: true });
    addEventListener('mouseleave', function () { dot.classList.remove('on'); });

    // grow over anything interactive
    var grow = 'a, button, [data-magnetic], .chip, .card';
    document.addEventListener('mouseover', function (e) {
      if (e.target.closest && e.target.closest(grow)) dot.classList.add('grow');
    });
    document.addEventListener('mouseout', function (e) {
      if (e.target.closest && e.target.closest(grow)) dot.classList.remove('grow');
    });

    // magnetic pull
    $$('[data-magnetic]').forEach(function (el) {
      var strength = parseFloat(el.dataset.magnetic) || 0.32;
      el.addEventListener('mousemove', function (e) {
        var r = el.getBoundingClientRect();
        var dx = e.clientX - (r.left + r.width / 2);
        var dy = e.clientY - (r.top + r.height / 2);
        el.classList.add('pulling');
        el.style.transform = 'translate(' + (dx * strength) + 'px,' + (dy * strength) + 'px)';
      });
      el.addEventListener('mouseleave', function () {
        el.classList.remove('pulling');
        el.style.transform = '';
      });
    });
  }

  /* ----------------------------------------------------------
     4. Hero headline — split into characters, stagger in
     ---------------------------------------------------------- */
  function splitHero() {
    var lines = $$('[data-split]');
    if (!lines.length) return;

    var i = 0;
    lines.forEach(function (line) {
      var text = line.textContent;
      var frag = document.createDocumentFragment();
      // split by word first so words never break across lines
      text.split(' ').forEach(function (word, wi, arr) {
        var w = document.createElement('span');
        w.style.display = 'inline-block';
        w.style.whiteSpace = 'nowrap';
        word.split('').forEach(function (ch) {
          var s = document.createElement('span');
          s.className = 'ch';
          s.textContent = ch;
          s.style.transitionDelay = (0.028 * i++) + 's';
          w.appendChild(s);
        });
        frag.appendChild(w);
        if (wi < arr.length - 1) {
          var sp = document.createElement('span');
          sp.className = 'ch';
          sp.innerHTML = '&nbsp;';
          sp.style.transitionDelay = (0.028 * i++) + 's';
          frag.appendChild(sp);
        }
      });
      line.textContent = '';
      line.appendChild(frag);
      line.setAttribute('aria-label', text);
    });

    // Forced reflow rather than rAF: frame callbacks are throttled in
    // background tabs, which would leave the headline permanently hidden.
    void document.body.offsetWidth;
    document.body.classList.add('ready');
  }

  /* ----------------------------------------------------------
     5. Rotating role words
     ---------------------------------------------------------- */

  /* The dot portrait intro asks the page to stay still while it plays.
     It removes its own element on the way out — early exits included —
     so a missing element means there is nothing to wait for. The timeout
     is only a backstop; it must outlast the intro's own run. */
  function whenIntroDone(fn) {
    if (!$('#portrait-intro')) return fn();
    var fired = false;
    function go() { if (fired) return; fired = true; fn(); }
    document.addEventListener('portrait-intro:end', go, { once: true });
    setTimeout(go, 30000);
  }

  function roles() {
    var box = $('.roles');
    if (!box) return;
    var items = $$('span', box);
    if (items.length < 2) return;

    // lock the width to the widest word so the line never reflows
    function size() {
      var w = 0;
      items.forEach(function (s) { w = Math.max(w, s.getBoundingClientRect().width); });
      box.style.width = Math.ceil(w) + 'px';
    }
    size();
    addEventListener('resize', size, { passive: true });

    var i = 0;
    items[0].classList.add('in');
    if (reduced) return;

    // Each swap forces a synchronous reflow, which on a phone lands as a
    // visible hitch in the portrait's dots. Hold the first rotation until
    // the intro has finished and the dots are gone.
    whenIntroDone(function () {
      setInterval(function () {
        // Background tabs throttle rAF but keep firing intervals, so the class
        // swap is done synchronously with a forced reflow instead of in a frame
        // callback — otherwise the incoming word never becomes visible.
        if (document.hidden) return;

        var cur = items[i];
        i = (i + 1) % items.length;
        var nxt = items[i];

        cur.classList.remove('in');
        cur.classList.add('out');

        nxt.classList.remove('out');
        void nxt.offsetWidth;            // flush the reset before animating in
        nxt.classList.add('in');

        setTimeout(function () { cur.classList.remove('out'); }, 700);
      }, 2600);
    });
  }

  /* ----------------------------------------------------------
     6. Reveal on scroll, with per-group stagger
     ---------------------------------------------------------- */
  function reveals() {
    var els = $$('[data-rv]');
    if (!els.length) return;
    if (reduced || !('IntersectionObserver' in window)) {
      els.forEach(function (e) { e.classList.add('seen'); });
      return;
    }
    function show(el) {
      el.style.transitionDelay = (parseFloat(el.dataset.rvDelay || 0)) + 's';
      el.classList.add('seen');
      io.unobserve(el);
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) show(en.target); });
    }, { rootMargin: '0px 0px -9% 0px', threshold: 0.06 });
    els.forEach(function (e) { io.observe(e); });

    // Safety net: if the observer hasn't reported within a second, reveal
    // anything already on screen so above-the-fold content is never stuck.
    setTimeout(function () {
      els.forEach(function (el) {
        if (el.classList.contains('seen')) return;
        var r = el.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) show(el);
      });
    }, 1000);
  }

  /* ----------------------------------------------------------
     7. Work grid filtering
     ---------------------------------------------------------- */
  function filters() {
    var bar = $('.filters');
    var grid = $('#work-grid');
    if (!bar || !grid) return;

    var cards = $$('.card', grid);
    var empty = $('.empty', grid);
    var live  = $('#filter-status');

    bar.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;

      $$('.chip', bar).forEach(function (c) { c.setAttribute('aria-pressed', String(c === chip)); });

      var want = chip.dataset.filter;
      var shown = 0;

      cards.forEach(function (card) {
        var tags = (card.dataset.tags || '').split('|');
        var hit = want === 'all' || tags.indexOf(want) > -1;
        if (hit) shown++;
        card.classList.toggle('gone', !hit);
        if (hit && !reduced) {
          // quick re-entry animation so the grid feels alive when it reflows
          card.classList.remove('seen');
          card.style.transitionDelay = (shown * 0.035) + 's';
          void card.offsetWidth;
          card.classList.add('seen');
        }
      });

      if (empty) empty.hidden = shown > 0;
      if (live) {
        live.textContent = shown + (shown === 1 ? ' project' : ' projects') +
          (want === 'all' ? '' : ' tagged ' + want);
      }
    });
  }

  /* ----------------------------------------------------------
     8. Thumbnail parallax
     ---------------------------------------------------------- */
  function parallax() {
    if (reduced) return;
    var layers = $$('.pll');
    if (!layers.length) return;
    var ticking = false;

    function draw() {
      var vh = window.innerHeight;
      layers.forEach(function (l) {
        var r = l.parentElement.getBoundingClientRect();
        if (r.bottom < -120 || r.top > vh + 120) return;
        // -1 (below fold) .. 1 (above)
        var p = (r.top + r.height / 2 - vh / 2) / (vh / 2);
        l.style.transform = 'translate3d(0,' + (clamp(p, -1.4, 1.4) * -6).toFixed(2) + 'px,0)';
      });
      ticking = false;
    }
    addEventListener('scroll', function () {
      if (!ticking) { ticking = true; raf(draw); }
    }, { passive: true });
    addEventListener('resize', draw, { passive: true });
    draw();
  }

  /* ----------------------------------------------------------
     9. Stat count-up
     ---------------------------------------------------------- */
  function counters() {
    var nums = $$('[data-count]');
    if (!nums.length) return;
    if (reduced || !('IntersectionObserver' in window)) {
      nums.forEach(function (n) { n.textContent = n.dataset.count + (n.dataset.suffix || ''); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target;
        io.unobserve(el);
        var target = parseFloat(el.dataset.count);
        var sfx = el.dataset.suffix || '';
        var dur = 1250, t0 = performance.now();
        (function step(now) {
          var k = clamp((now - t0) / dur, 0, 1);
          var eased = 1 - Math.pow(1 - k, 3);
          el.textContent = Math.round(target * eased).toLocaleString() + (k === 1 ? sfx : '');
          if (k < 1) raf(step);
        })(t0);
      });
    }, { threshold: 0.5 });
    nums.forEach(function (n) { io.observe(n); });
  }

  /* ----------------------------------------------------------
     10. Mobile drawer
     ---------------------------------------------------------- */
  function drawer() {
    var burger = $('.burger');
    var box = $('.drawer');
    if (!burger || !box) return;

    function set(open) {
      document.body.classList.toggle('menu-open', open);
      document.body.style.overflow = open ? 'hidden' : '';
      burger.setAttribute('aria-expanded', String(open));
      box.setAttribute('aria-hidden', String(!open));
    }
    burger.addEventListener('click', function () {
      set(!document.body.classList.contains('menu-open'));
    });
    box.addEventListener('click', function (e) { if (e.target.closest('a')) set(false); });
    addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.classList.contains('menu-open')) set(false);
    });
    // if we grow past the mobile breakpoint while open, clean up
    matchMedia('(min-width: 861px)').addEventListener('change', function (e) { if (e.matches) set(false); });
    set(false);
  }

  /* ----------------------------------------------------------
     11. Section spy — highlights the current nav item
     ---------------------------------------------------------- */
  function spy() {
    var links = $$('.nav a[href^="#"], .drawer a[href^="#"]');
    if (!links.length || !('IntersectionObserver' in window)) return;
    var map = {};
    links.forEach(function (a) {
      var id = a.getAttribute('href').slice(1);
      (map[id] = map[id] || []).push(a);
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        links.forEach(function (a) { a.classList.remove('active'); });
        (map[en.target.id] || []).forEach(function (a) { a.classList.add('active'); });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    Object.keys(map).forEach(function (id) {
      var s = document.getElementById(id);
      if (s) io.observe(s);
    });
  }

  /* ----------------------------------------------------------
     12. Page transition curtain
     ---------------------------------------------------------- */
  function transitions() {
    var curtain = $('#curtain');
    if (!curtain || reduced) return;

    // The arrival wipe is handled entirely in CSS. JS only draws the
    // curtain back up when leaving for another page on this site.
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a');
      if (!a) return;
      var href = a.getAttribute('href') || '';
      if (
        a.target === '_blank' || a.hasAttribute('download') ||
        href === '' || href.charAt(0) === '#' ||
        /^(mailto:|tel:|https?:\/\/)/.test(href) ||
        e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0
      ) return;

      e.preventDefault();
      curtain.classList.add('leaving');
      // navigate even if the transition never paints
      setTimeout(function () { location.href = href; }, 430);
    });

    // coming back via the back button must never restore a raised curtain
    addEventListener('pageshow', function () { curtain.classList.remove('leaving'); });
  }

  /* ----------------------------------------------------------
     13. Lightbox for full-width case study artefacts
     ---------------------------------------------------------- */
  function lightbox() {
    var figs = $$('.fig.wide img');
    if (!figs.length) return;

    var box = document.createElement('div');
    box.id = 'lightbox';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Enlarged image');
    box.dataset.open = 'false';
    box.innerHTML =
      '<button class="close" type="button" aria-label="Close enlarged image">\u00d7</button>' +
      '<img alt="">' +
      '<p class="hint">Click anywhere or press Esc to close</p>';
    document.body.appendChild(box);

    var shown = $('img', box);
    var closeBtn = $('.close', box);
    var lastFocus = null;

    function open(src, alt) {
      lastFocus = document.activeElement;
      shown.src = src;
      shown.alt = alt || '';
      box.dataset.open = 'true';
      document.body.style.overflow = 'hidden';
      // Deferred: the browser assigns focus to the clicked element *after* the
      // click handler returns, so focusing synchronously here gets overridden.
      setTimeout(function () { closeBtn.focus(); }, 0);
    }
    function close() {
      box.dataset.open = 'false';
      document.body.style.overflow = '';
      if (lastFocus) lastFocus.focus();
      // drop the src once the fade has finished, to release the decoded bitmap
      setTimeout(function () {
        if (box.dataset.open === 'false') shown.removeAttribute('src');
      }, 400);
    }

    figs.forEach(function (img) {
      // the image is the control, so give it real button semantics
      img.setAttribute('role', 'button');
      img.setAttribute('tabindex', '0');
      img.setAttribute('aria-label', 'Enlarge: ' + (img.alt || 'image'));
      img.addEventListener('click', function () { open(img.currentSrc || img.src, img.alt); });
      img.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open(img.currentSrc || img.src, img.alt);
        }
      });
    });

    box.addEventListener('click', close);
    addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && box.dataset.open === 'true') close();
      // keep focus inside the dialog while it is open
      if (e.key === 'Tab' && box.dataset.open === 'true') {
        e.preventDefault();
        closeBtn.focus();
      }
    });
  }

  /* ----------------------------------------------------------
     14. Showreel — play only while on screen, opt-in sound
     ---------------------------------------------------------- */
  function reel() {
    var vid = $('#reel-video');
    if (!vid) return;
    var btn = $('.reel-sound');

    if (btn) {
      btn.addEventListener('click', function () {
        vid.muted = !vid.muted;
        btn.setAttribute('aria-pressed', String(!vid.muted));
        btn.lastChild.textContent = vid.muted ? ' Sound off' : ' Sound on';
        // a muted autoplay video needs an explicit play() once it gains sound
        if (!vid.muted) vid.play().catch(function () {});
      });
    }

    // Reduced motion: never autoplay. Give the viewer real controls instead.
    if (reduced) { vid.controls = true; return; }

    if (!('IntersectionObserver' in window)) { vid.controls = true; return; }
    new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          vid.play().catch(function () { vid.controls = true; });
        } else if (!vid.paused) {
          vid.pause();
        }
      });
    }, { threshold: 0.25 }).observe(vid);

    // don't keep decoding video in a tab nobody is looking at
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && !vid.paused) vid.pause();
    });
  }

  /* ----------------------------------------------------------
     15. Year stamp
     ---------------------------------------------------------- */
  function year() {
    $$('[data-year]').forEach(function (el) { el.textContent = new Date().getFullYear(); });
  }

  /* ---------------------------------------------------------- */
  function init() {
    splitHero(); roles(); progressBar(); header(); cursor();
    reveals(); filters(); parallax(); counters(); drawer();
    spy(); transitions(); lightbox(); reel(); year();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
