/* Embed mode for the Movements pages (page.html?embed), used by the home
   page hero. Only the stage is shown, at the size it has on its own page
   for the visitor's window, centred in the frame: the frame crops the
   middle of it rather than scaling it down. The nav, title, controls and
   footer are hidden, so there is no Sound button and no sound; the
   pointer interactions work as usual. A page marked <html data-embed="fit">
   is instead scaled just enough to fill the frame, so it is not shown
   enlarged. A page can set --embed-lift (a
   fraction of the stage's height) to crop lower than the middle; the lift
   stops before the stage's bottom edge would come into the frame. Runs in
   <head>, before the page's own script measures the stage. */
(function () {
  "use strict";
  if (!/[?&]embed(=|&|$)/.test(location.search)) return;

  var root = document.documentElement;
  root.classList.add("embed");

  var style = document.createElement("style");
  style.textContent =
    "html.embed, html.embed body { height: 100%; overflow: hidden; background: #000; }" +
    "html.embed .tabs, html.embed section > header, html.embed .stage-bar, html.embed footer { display: none; }" +
    "html.embed .stage { position: absolute; left: 50%; margin: 0; min-height: 0;" +
    " top: max(calc(50% - var(--embed-h, 720px) * var(--embed-lift, 0)), calc(100% - var(--embed-h, 720px) / 2));" +
    " width: var(--embed-w, 1280px); height: var(--embed-h, 720px); transform: translate(-50%, -50%); }";
  document.head.appendChild(style);

  /* The stage on a Movements page fills the window less a 16px gutter each
     side, at 16:9, capped at 78% of the window's height. */
  var host = window;
  try { if (window.parent && window.parent.innerWidth) host = window.parent; } catch (e) {}

  var fit = root.getAttribute("data-embed") === "fit";

  function size() {
    var w, h;
    if (fit) {
      w = Math.max(window.innerWidth, window.innerHeight / 0.5625);
      h = w * 0.5625;
    } else {
      w = Math.max(320, host.innerWidth - 32);
      h = Math.min(w * 0.5625, host.innerHeight * 0.78);
    }
    root.style.setProperty("--embed-w", Math.round(w) + "px");
    root.style.setProperty("--embed-h", Math.round(h) + "px");
  }
  size();
  try { host.addEventListener("resize", size); } catch (e) {}
  if (fit) window.addEventListener("resize", size);
})();
