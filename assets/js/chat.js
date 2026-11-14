/* ============================================================
   Ponce Design — About portrait, now a chat
   Replaces portrait-about.js. The circle is the same authored dot
   portrait with the same behaviours (gathers in when it scrolls into
   view, dots shoulder away from the cursor, a click replays the
   gather), drawn by DotOrb (chat-orb.js).

   "Talk to my AI" under the portrait starts a session: the face
   turns into the orange sunburst and the text field opens left to
   right underneath. The × in the field, or Esc, ends it.

   The <img> stays as the source of truth: alt text, print, and what
   shows if the canvas cannot start.
   ============================================================ */
(function () {
  'use strict';

  var root = document.querySelector('.about .assistant');
  if (!root) return;
  var orbEl    = root.querySelector('.orb');
  var canvas   = root.querySelector('.orb-canvas');
  var toggle   = root.querySelector('.chat-cta');
  var closeBtn = root.querySelector('.composer-close');
  var panel    = root.querySelector('.chat-panel');
  var thread   = root.querySelector('.thread');
  var form     = root.querySelector('.composer');
  var input    = form.querySelector('textarea');
  if (!window.AI) return;

  var orb = null;
  var open = false;
  var controller = null;
  var busy = false;
  var messages = [];

  // ---------- Orb ----------
  var D = window.PORTRAIT_DOTS;
  if (window.DotOrb && D && D.dots && D.dots.length && canvas.getContext && canvas.getContext('2d')) {
    try {
      orb = new DotOrb(orbEl, canvas, D);
      // as before: start dispersed and gather in once the circle is well in view
      if (!orb.reduced) orb.T = 0;
      orb.draw();
      orbEl.classList.add('has-dots');
      if ('IntersectionObserver' in window && !orb.reduced) {
        var io = new IntersectionObserver(function (entries) {
          if (entries[entries.length - 1].intersectionRatio >= 0.6) { orb.gather(); io.disconnect(); }
        }, { rootMargin: '0px 0px -25% 0px', threshold: [0, 0.6, 1] });
        io.observe(orbEl);
      } else {
        orb.T = 3.4;   // settled portrait
        orb.draw();
      }
    } catch (err) {
      console.error(err);
      orb = null;
      orbEl.classList.remove('has-dots');
    }
  }
  root.classList.add('is-ready');

  // ---------- Dock ----------
  // In a session the sphere sits inline, left of the field. Its box stays in
  // flow (margin gives the height back), so the offsets are measured here:
  // shrink to DOCK px and centre it, both ways, in the space between the
  // page's left edge and the field. The field only steps right when that
  // space is too narrow to leave EDGE px either side of the sphere.
  var DOCK = 56, EDGE = 16;
  function dock() {
    var w = orbEl.offsetWidth;
    if (!w) return;
    var rootLeft = root.getBoundingClientRect().left;
    // the field's resting left edge in the viewport, read from its container
    // (not the field itself, whose margin is what this sets)
    var inner = form.parentElement;
    var fieldLeft = rootLeft + inner.offsetLeft + (parseFloat(getComputedStyle(inner).paddingLeft) || 0);
    var gap = Math.round(Math.max(0, DOCK + 2 * EDGE - fieldLeft));
    var sphereLeft = (fieldLeft + gap - DOCK) / 2;
    var fieldTop = form.offsetTop - panel.offsetTop;   // where the field sits once the panel is open
    root.style.setProperty('--dock-s', (DOCK / w).toFixed(4));
    root.style.setProperty('--dock-x', Math.round(sphereLeft - rootLeft - orbEl.offsetLeft) + 'px');
    root.style.setProperty('--dock-y', (fieldTop + form.offsetHeight / 2 - DOCK / 2) + 'px');
    root.style.setProperty('--dock-mb', -orbEl.offsetHeight + 'px');
    root.style.setProperty('--dock-gap', gap + 'px');
  }
  dock();
  window.addEventListener('resize', dock);
  if ('ResizeObserver' in window) {
    var ro = new ResizeObserver(dock);
    ro.observe(root); ro.observe(thread); ro.observe(form);
  }

  // ---------- Session ----------
  function setOpen(next) {
    if (next === open) return;
    open = next;
    root.dataset.state = open ? 'open' : 'closed';
    toggle.setAttribute('aria-expanded', String(open));
    panel.inert = !open;

    if (open) {
      dock();
      if (orb) orb.morphTo(2);
      setTimeout(function () { if (open) input.focus({ preventScroll: true }); }, 420);
    } else {
      if (controller) controller.abort();
      if (orb) { orb.setActivity('idle'); orb.morphTo(0); }
      toggle.focus({ preventScroll: true });
    }
  }

  toggle.addEventListener('click', function (e) {
    e.stopPropagation();
    setOpen(true);
  });
  closeBtn.addEventListener('click', function () { setOpen(false); });

  // clicking the portrait replays the gather, as it always has
  orbEl.addEventListener('click', function (e) {
    if (!open && orb && e.target !== toggle && !toggle.contains(e.target)) orb.gather();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && open) setOpen(false);
  });

  // ---------- Composer ----------
  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 160) + 'px';
    form.toggleAttribute('data-has-text', input.value.trim().length > 0);
  }
  input.addEventListener('input', autosize);

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text || busy) return;

    input.value = '';
    autosize();
    addMessage('user', text);
    messages.push({ role: 'user', content: text });

    var bubble = addMessage('assistant', '');
    bubble.setAttribute('data-pending', '');
    busy = true;
    controller = new AbortController();
    if (orb) orb.setActivity('thinking');

    var reply = '';
    try {
      await AI.respond(messages.slice(), {
        signal: controller.signal,
        onToken: function (chunk) {
          if (!reply && orb) orb.setActivity('speaking');
          reply += chunk;
          renderText(bubble, reply);
          thread.scrollTop = thread.scrollHeight;
        }
      });
      messages.push({ role: 'assistant', content: reply });
    } catch (err) {
      if (err.name !== 'AbortError') {
        bubble.textContent = err.userMessage || 'Something went wrong. Please try again.';
        bubble.classList.add('msg-error');
        // drop the unanswered question so the next request stays a clean user/assistant exchange
        if (!reply) messages.pop();
        console.error(err);
      } else if (reply) {
        messages.push({ role: 'assistant', content: reply });
      } else {
        bubble.remove();
        messages.pop();
      }
    } finally {
      bubble.removeAttribute('data-pending');
      thread.scrollTop = thread.scrollHeight;
      busy = false;
      controller = null;
      if (orb) orb.setActivity('idle');
    }
  });

  // Plain text with links: URLs in a reply become anchors (DOM nodes, never innerHTML).
  var URL_RE = /https?:\/\/[^\s<>"')]+[^\s<>"').,;:!?]/g;
  function renderText(el, text) {
    el.textContent = '';
    var last = 0, m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(text))) {
      el.append(text.slice(last, m.index));
      var a = document.createElement('a');
      a.href = m[0];
      a.textContent = m[0].replace(/^https?:\/\/(www\.)?/, '');
      if (!/^https:\/\/(www\.)?poncedesign\.com\//.test(m[0])) { a.target = '_blank'; a.rel = 'noopener'; }
      el.append(a);
      last = m.index + m[0].length;
    }
    el.append(text.slice(last));
  }

  function addMessage(role, text) {
    var el = document.createElement('div');
    el.className = 'msg ' + (role === 'user' ? 'msg-user' : 'msg-ai');
    el.textContent = text;
    thread.appendChild(el);
    thread.scrollTop = thread.scrollHeight;
    return el;
  }
})();
