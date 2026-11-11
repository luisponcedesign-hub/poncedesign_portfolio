/* ============================================================
   Ponce Design — About chat, the connection to Claude
   Sends the conversation to the chat Worker (the poncedesign-chat
   Cloudflare Worker, source in ~/ai-chat-orb/worker) and streams the
   reply back. The API key lives only in the Worker, never here.

   The Worker's address must also be in this page's CSP connect-src,
   and this site's origin in the Worker's ALLOWED_ORIGINS.

   AI.respond(messages, { onToken, signal }) → Promise<void>
     messages : [{ role: "user" | "assistant", content: string }, ...]
     onToken  : called with each streamed chunk of text
     signal   : AbortSignal, aborted when the visitor ends the session
   Errors carry a visitor-friendly `userMessage` when there is one.
   ============================================================ */
(function () {
  'use strict';

  var ENDPOINT = window.AI_CHAT_ENDPOINT || 'https://poncedesign-chat.poncedesign.workers.dev/chat';

  function fail(message, cause) {
    var err = new Error(message);
    err.userMessage = message;
    if (cause) err.cause = cause;
    return err;
  }

  async function respond(messages, opts) {
    var res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: messages }),
        signal: opts.signal
      });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      throw fail("I can't reach the assistant right now. Please try again in a moment.", err);
    }

    if (!res.ok) {
      var message = 'The assistant is unavailable right now. Please try again shortly.';
      try {
        var data = await res.json();
        if (data && data.error && res.status !== 400) message = data.error;
      } catch (_) { /* non-JSON error body */ }
      throw fail(message);
    }

    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    for (;;) {
      var chunk = await reader.read();
      if (chunk.done) break;
      var text = decoder.decode(chunk.value, { stream: true });
      if (text) opts.onToken(text);
    }
    var tail = decoder.decode();
    if (tail) opts.onToken(tail);
  }

  window.AI = { respond: respond, endpoint: ENDPOINT };
})();
