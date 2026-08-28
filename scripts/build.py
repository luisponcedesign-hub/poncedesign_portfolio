#!/usr/bin/env python3
"""
build.py — generates the static parts of the site from data/projects.json.

  1. work/<slug>.html   one page per project
  2. index.html         the card grid, injected between the GRID markers
  3. sitemap.xml

Run it after any edit to data/projects.json:

    python3 scripts/build.py
"""

import html
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data', 'projects.json')
SITE = 'https://www.poncedesign.com'

# Security policy, delivered as meta tags.
#
# GitHub Pages serves no custom response headers, so CSP and Referrer-Policy
# have to ride in the markup instead. Two limits worth knowing:
#   - frame-ancestors is ignored in a meta-delivered CSP, and X-Frame-Options
#     cannot be set via meta at all, so clickjacking protection is simply not
#     available on Pages.
#   - 'unsafe-inline' is what the current markup requires: the inline
#     className one-liner in every head, the application/ld+json blocks
#     (JSON-LD is covered by script-src even though it never executes), and
#     the inline style="..." attributes throughout the pages.
#     Even so, 'self' still blocks script loaded from someone else's origin,
#     which is the part that matters.
#
# These tags must sit before the first inline script: a meta CSP only governs
# content that appears after it.
CSP = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline'; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com; "
    "img-src 'self' data:; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "form-action 'none'; "
    "upgrade-insecure-requests"
)

SECURITY_META = (
    '<meta http-equiv="Content-Security-Policy" content="' + CSP + '">\n'
    '<meta name="referrer" content="strict-origin-when-cross-origin">'
)

# Card widths by position. Featured work leads; the back catalogue settles
# into rows of three, then pairs, so the grid never ends on a lonely card.
STUB_SIZES = ['', '', '', '', '', '', 'wide', 'wide', 'wide', 'wide']


def esc(s):
    return html.escape(s, quote=True)

def img_size(path):
    """Pixel dimensions of a PNG or JPEG, without any third-party imaging lib."""
    with open(path, 'rb') as f:
        head = f.read(26)
        if head[:8] == b'\x89PNG\r\n\x1a\n':
            w = int.from_bytes(head[16:20], 'big')
            h = int.from_bytes(head[20:24], 'big')
            return w, h
        if head[:2] == b'\xff\xd8':
            f.seek(2)
            while True:
                b = f.read(1)
                while b and b != b'\xff':
                    b = f.read(1)
                marker = f.read(1)
                while marker == b'\xff':
                    marker = f.read(1)
                if not marker:
                    break
                # SOF0..SOF15, excluding the non-frame markers DHT/JPG/DAC
                if 0xC0 <= marker[0] <= 0xCF and marker[0] not in (0xC4, 0xC8, 0xCC):
                    f.read(3)
                    h = int.from_bytes(f.read(2), 'big')
                    w = int.from_bytes(f.read(2), 'big')
                    return w, h
                seg = int.from_bytes(f.read(2), 'big')
                f.seek(seg - 2, 1)
    raise ValueError('could not read dimensions: %s' % path)


def thumb_path(p):
    return os.path.join(ROOT, 'assets', 'img', 'thumbs', p['thumb'])


def cover_cap(w):
    """Never blow a source up more than 1.5x — several crops are small, and a
    soft, over-scaled cover reads as low quality on a design portfolio."""
    return min(1040, int(round(w * 1.5)))



# ----------------------------------------------------------------- cards
def card(p, size):
    """One grid card. The lead project gets a split editorial layout, which also
    keeps its image near native resolution instead of stretching it full-bleed."""
    cls = 'card' + ((' ' + size) if size else '')
    tags = '|'.join(p['tags'])
    tag_lis = ''.join('<li>%s</li>' % esc(t) for t in p['tags'])
    img = 'assets/img/thumbs/' + p['thumb']
    iw, ih = img_size(thumb_path(p))
    lead = size == 'hero-card'
    loading = '' if lead else ' loading="lazy"'   # the lead card is above the fold
    flag = '<p class="feat">Featured</p>' if lead else ''

    return f'''      <article class="{cls}" data-tags="{esc(tags)}" data-rv="scale">
        <a href="work/{p['slug']}.html" aria-label="{esc(p['title'])} — case study">
          <div class="shot">
            <div class="pll"><img src="{img}" alt="{esc(p['title'])} — {esc(p['client'])}" width="{iw}" height="{ih}"{loading} decoding="async"></div>
            <span class="veil" aria-hidden="true"></span>
            <span class="yr">{esc(p['year'])}</span>
            <span class="view" aria-hidden="true">View case study <span>→</span></span>
          </div>
          <div class="meta">
            {flag}<p class="cli">{esc(p['client'])}</p>
            <h3>{esc(p['title'])}</h3>
            <p class="desc">{esc(p['summary'])}</p>
            <ul class="tags">{tag_lis}</ul>
          </div>
        </a>
      </article>
'''


def build_grid(projects):
    out, stub_i = [], 0
    for p in projects:
        if p.get('size'):
            size = p['size']
        else:
            size = STUB_SIZES[stub_i] if stub_i < len(STUB_SIZES) else ''
            stub_i += 1
        out.append(card(p, size))
    return ''.join(out)


# ----------------------------------------------------------------- craft
def _tags(items):
    return '<ul class="ttags">%s</ul>' % ''.join('<li>%s</li>' % esc(t) for t in items)


def _reel_player(reel):
    """Rendered only when there is genuinely something to play. No placeholder:
    motion is a supporting note in this section, not the headline."""
    if not reel:
        return ''
    if reel.get('embed'):
        return ('<div class="reel-frame"><iframe src="%s" title="%s" loading="lazy" '
                'allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>'
                % (esc(reel['embed']), esc(reel.get('caption', 'Showreel'))))
    if reel.get('src') and os.path.exists(os.path.join(ROOT, reel['src'])):
        poster = ' poster="%s"' % esc(reel['poster']) if reel.get('poster') else ''
        return ('<div class="reel-frame">'
                '<video id="reel-video" muted loop playsinline preload="metadata"%s aria-label="%s">'
                '<source src="%s" type="video/mp4">'
                'Your browser does not support embedded video.</video>'
                '<button class="reel-sound" type="button" aria-pressed="false">'
                '<span aria-hidden="true">♪</span> Sound off</button></div>'
                % (poster, esc(reel.get('caption', 'Showreel')), esc(reel['src'])))
    return ''


def build_principles(pr):
    """Rams and Nielsen side by side — the standard for the object, and the
    standard for the interaction."""
    cols = []
    for st in pr['sets']:
        items = ''.join(
            '<li><span class="n">%02d</span><span>%s</span></li>\n            '
            % (i + 1, esc(t)) for i, t in enumerate(st['items']))
        cols.append(
            '<div class="pset" data-rv>\n'
            '          <h3>%s</h3>\n'
            '          <p class="pby">%s</p>\n'
            '          <p class="pnote">%s</p>\n'
            '          <ol class="plist">\n            %s</ol>\n'
            '          <a class="linkout" href="%s" target="_blank" rel="noopener">'
            'Read the original <span aria-hidden="true">↗</span></a>\n'
            '        </div>'
            % (esc(st['title']), esc(st['by']), esc(st['note']), items, esc(st['u'])))

    return (
        '      <div class="principles" id="principles">\n'
        '        <div class="pr-head">\n'
        '          <p class="eyebrow" data-rv="left">%s</p>\n'
        '          <h2 class="h2" data-rv>%s</h2>\n'
        '          <p class="lead" data-rv data-rv-delay="0.08">%s</p>\n'
        '        </div>\n'
        '        <div class="pgrid">\n        %s\n        </div>\n'
        '        <p class="pclose" data-rv>%s</p>\n'
        '      </div>\n'
        % (esc(pr['eyebrow']), esc(pr['headline']), esc(pr['lead']),
           '\n        '.join(cols), pr['close']))


def build_craft(c):
    """The development / AI / craft band, plus the design-principles block."""
    if not c:
        return ''

    head = ''.join('<span class="line">%s</span>' % esc(l)
                   for l in c['headline'].split('\n'))

    blocks = ''
    for i, b in enumerate(c['blocks']):
        extra = ('<p>%s</p>' % b['p2']) if b.get('p2') else ''
        blocks += ('        <div class="cblk" data-rv data-rv-delay="%s">\n'
                   '          <h3>%s</h3>\n          %s\n'
                   '          <p>%s</p>\n          %s\n        </div>\n'
                   % (round(0.06 * i, 2), esc(b['h']), _tags(b['tags']), b['p'], extra))

    certs = ''.join(
        '          <li data-rv="left" data-rv-delay="%s">\n'
        '            <a href="%s" target="_blank" rel="noopener">\n'
        '              <span class="ct">%s</span>\n'
        '              <span class="co">%s</span>\n'
        '              <span class="cd">%s</span>\n'
        '              <span class="ca" aria-hidden="true">↗</span>\n'
        '            </a>\n          </li>\n'
        % (round(0.04 * i, 2), esc(x['u']), esc(x['t']), esc(x['org']), esc(x['date']))
        for i, x in enumerate(c['certs']))

    m = c['motion']
    return (
        '<section class="sec craft" id="craft">\n'
        '  <div class="wrap">\n'
        '    <div class="craft-head">\n'
        '      <p class="eyebrow" data-rv="left">%s</p>\n'
        '      <h2 class="h2" data-rv>%s</h2>\n'
        '      <p class="lead" data-rv data-rv-delay="0.08">%s</p>\n'
        '    </div>\n\n'
        '    <div class="cgrid">\n%s    </div>\n\n'
        '    <div class="certs" data-rv="fade">\n'
        '      <div class="certs-head">\n        <h3>%s</h3>\n        <p>%s</p>\n      </div>\n'
        '      <ul class="certlist">\n%s      </ul>\n'
        '    </div>\n\n'
        '    <div class="motion" data-rv>\n'
        '      <div class="motion-txt">\n'
        '        <h3>%s</h3>\n        %s\n'
        '        <p>%s</p>\n        <p>%s</p>\n'
        '      </div>\n      %s\n    </div>\n\n'
        '%s  </div>\n</section>\n'
        % (esc(c['eyebrow']), head, esc(c['lead']), blocks,
           esc(c['certs_title']), esc(c['certs_note']), certs,
           esc(m['h']), _tags(m['tags']), m['p'], m['p2'],
           _reel_player(c.get('reel')), build_principles(c['principles'])))


# ----------------------------------------------------------- case blocks
def block(b):
    if 'h' in b:
        return '        <h2>%s</h2>\n' % esc(b['h'])
    if 'p' in b:
        return '        <p>%s</p>\n' % b['p']
    if 'ul' in b:
        lis = ''.join('          <li>%s</li>\n' % i for i in b['ul'])
        return '        <ul class="bul">\n%s        </ul>\n' % lis
    if 'pull' in b:
        return '        <blockquote class="pull">%s</blockquote>\n' % b['pull']
    if 'kpis' in b:
        cells = ''.join(
            '          <div class="kpi"><b>%s</b><i>%s</i></div>\n' % (esc(k['v']), esc(k['l']))
            for k in b['kpis'])
        return '        <div class="kpis">\n%s        </div>\n' % cells
    if 'note' in b:
        return ('        <aside class="note"><b>Editor\'s note</b><p>%s</p></aside>\n'
                % b['note'])
    if 'img' in b:
        src = 'assets/img/case/%s' % b['img']
        w, h = img_size(os.path.join(ROOT, src))
        cap = ('\n          <figcaption>%s</figcaption>' % esc(b['cap'])) if b.get('cap') else ''
        wide = ' wide' if b.get('wide') else ''
        return ('        <figure class="fig%s">\n'
                '          <img src="../%s" alt="%s" width="%d" height="%d" loading="lazy" decoding="async">%s\n'
                '        </figure>\n') % (wide, src, esc(b.get('alt', b.get('cap', ''))), w, h, cap)
    if 'links' in b:
        links = ''.join(
            '          <a class="linkout" href="%s" target="_blank" rel="noopener">%s <span aria-hidden="true">↗</span></a>\n'
            % (esc(l['u']), esc(l['t'])) for l in b['links'])
        return ('        <p style="display:flex;flex-wrap:wrap;gap:14px 26px">\n%s        </p>\n'
                % links)
    raise ValueError('unknown block: %r' % b)


def stub_body(p):
    """Consistent scaffold for the projects that don't have written copy yet."""
    return f'''        <h2>About this project</h2>
        <p>{esc(p['summary'])}</p>

        <aside class="note">
          <b>Case study in progress</b>
          <p>The full write-up for this project — problem, process, and outcome — is being
          rebuilt. In the meantime the original visual case study is still live on the previous
          portfolio.</p>
          <p style="margin-bottom:0"><a class="linkout" href="{esc(p['orig'])}" target="_blank" rel="noopener">See the original case study <span aria-hidden="true">↗</span></a></p>
        </aside>

        <h2>What I did</h2>
        <ul class="bul">
          <li><b>Role.</b> {esc(p['role'])} at {esc(p['client'])}, {esc(p['year'])}.</li>
          <li><b>Focus.</b> {esc(' · '.join(p['tags']))}.</li>
          <li><b>Scope.</b> Research through shipped design — discovery, information architecture,
          interaction design, and hand-off to engineering.</li>
        </ul>
'''


# ------------------------------------------------------------ case pages
def case_page(p, prev_p, next_p):
    iw, ih = img_size(thumb_path(p))
    cap = cover_cap(iw)
    if p.get('stub'):
        body = stub_body(p)
    else:
        body = ''.join(block(b) for b in p['sections'])

    def pager_side(other, kind):
        if not other:
            # first/last project — keep the cell, not the grid gap showing through
            return '<div class="blank" aria-hidden="true"></div>'
        label = 'Previous project' if kind == 'pv' else 'Next project'
        cls = 'pv' if kind == 'pv' else 'nx'
        arrow = '← ' if kind == 'pv' else ''
        arrow_end = ' →' if kind == 'nx' else ''
        return (f'<a class="{cls}" href="{other["slug"]}.html">'
                f'<span>{arrow}{label}{arrow_end}</span>'
                f'<strong>{esc(other["title"])}</strong></a>')

    tag_str = esc(' · '.join(p['tags']))
    desc = esc(p['summary'])[:180]

    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
{SECURITY_META}
<script>document.documentElement.className += ' js';</script>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{esc(p['title'])} — {esc(p['client'])} · Luis Ponce de León</title>
<meta name="description" content="{desc}">
<meta name="theme-color" content="#FAF8F4">
<link rel="canonical" href="{SITE}/work/{p['slug']}.html">

<meta property="og:type" content="article">
<meta property="og:title" content="{esc(p['title'])} — {esc(p['client'])}">
<meta property="og:description" content="{desc}">
<meta property="og:image" content="../assets/img/thumbs/{p['thumb']}">
<meta name="twitter:card" content="summary_large_image">

<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><defs><linearGradient id='g' x1='-.0704' y1='.3994' x2='1.0704' y2='.6006'><stop offset='0' stop-color='%23E8630B'/><stop offset='1' stop-color='%23F5B301'/></linearGradient></defs><circle cx='16' cy='16' r='13' fill='url(%23g)'/></svg>">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700;900&family=Roboto+Condensed:wght@500;700&family=Roboto+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="../assets/css/style.css">
</head>

<body>
<a class="skip" href="#case">Skip to case study</a>
<div id="progress" aria-hidden="true"></div>
<div id="cursor" aria-hidden="true"></div>
<div id="curtain" aria-hidden="true"></div>

<header class="hdr">
  <div class="wrap hdr-in">
    <a class="mark" href="../index.html" aria-label="Luis Ponce de León — home">
      <span class="dot" aria-hidden="true"></span>
      <span class="nm">Ponce<span style="color:var(--muted)">Design</span></span>
      <span class="sub">Product Design</span>
    </a>
    <nav class="nav" aria-label="Primary">
      <a href="../index.html#work">Work</a>
      <a href="../index.html#craft">Craft</a>
      <a href="../index.html#about">About</a>
      <a href="../index.html#contact">Contact</a>
    </nav>
    <a class="btn" href="mailto:luisponcedesign@gmail.com" data-magnetic="0.25">
      Let's talk <span class="arw" aria-hidden="true">→</span>
    </a>
    <button class="burger" aria-label="Open menu" aria-expanded="false" aria-controls="drawer">
      <span></span><span></span><span></span>
    </button>
  </div>
</header>

<div class="drawer" id="drawer" aria-hidden="true">
  <a href="../index.html#work">Work <i>01</i></a>
  <a href="../index.html#craft">Craft <i>02</i></a>
  <a href="../index.html#about">About <i>03</i></a>
  <a href="../index.html#contact">Contact <i>04</i></a>
  <a href="mailto:luisponcedesign@gmail.com">Email <i>05</i></a>
</div>

<main>
<section class="case-hero">
  <div class="blob a" aria-hidden="true"></div>
  <div class="wrap hero-in">
    <a class="crumb" href="../index.html#work"><span class="arw" aria-hidden="true">←</span> All work</a>
    <p class="eyebrow">{esc(p['client'])} &nbsp;·&nbsp; {esc(p['year'])}</p>
    <h1 data-rv>{esc(p['title'])}</h1>
    <div class="lead-row">
      <p class="lead" data-rv data-rv-delay="0.08">{esc(p['summary'])}</p>
      <p class="lead-link" data-rv data-rv-delay="0.12"><a class="linkout" href="{esc(p['orig'])}" target="_blank" rel="noopener">See the full visual case study <span aria-hidden="true">↗</span></a></p>
    </div>

    <div class="facts" data-rv data-rv-delay="0.14">
      <div><h4>Client</h4><p>{esc(p['client'])}</p></div>
      <div><h4>Year</h4><p>{esc(p['year'])}</p></div>
      <div><h4>Role</h4><p>{esc(p['role'])}</p></div>
      <div><h4>Focus</h4><p>{tag_str}</p></div>
    </div>
  </div>
</section>

<div class="wrap">
  <figure class="cover" data-rv="scale" style="max-width:{cap}px">
    <img src="../assets/img/thumbs/{p['thumb']}" alt="{esc(p['title'])} — {esc(p['client'])}" width="{iw}" height="{ih}" decoding="async">
  </figure>
</div>

<section class="case-body" id="case">
  <div class="wrap">
    <div class="col">
      <div class="blk" data-rv>
{body}      </div>
    </div>
  </div>
</section>

<nav class="pager" aria-label="More projects">
  <div class="pager-in">
    {pager_side(prev_p, 'pv')}
    {pager_side(next_p, 'nx')}
  </div>
</nav>
</main>

<footer class="ftr">
  <div class="wrap ftr-in">
    <span>© <span data-year>2026</span> Luis Ponce de León</span>
    <a href="mailto:luisponcedesign@gmail.com">luisponcedesign@gmail.com</a>
    <a class="to-top" href="#">Back to top <span class="arw" aria-hidden="true">↑</span></a>
  </div>
</footer>

<script src="../assets/js/main.js"></script>
</body>
</html>
'''


# ------------------------------------------------------------------ main
def main():
    with open(DATA, encoding='utf-8') as f:
        data = json.load(f)
    projects = data['projects']

    # 1. case study pages
    work_dir = os.path.join(ROOT, 'work')
    os.makedirs(work_dir, exist_ok=True)
    for i, p in enumerate(projects):
        prev_p = projects[i - 1] if i > 0 else None
        next_p = projects[i + 1] if i < len(projects) - 1 else None
        path = os.path.join(work_dir, p['slug'] + '.html')
        with open(path, 'w', encoding='utf-8') as f:
            f.write(case_page(p, prev_p, next_p))

    # 2. grid injection
    idx_path = os.path.join(ROOT, 'index.html')
    with open(idx_path, encoding='utf-8') as f:
        idx = f.read()
    if '<!--GRID:START-->' not in idx:
        sys.exit('index.html is missing the <!--GRID:START--> / <!--GRID:END--> markers')
    idx = re.sub(
        r'<!--GRID:START-->.*?<!--GRID:END-->',
        '<!--GRID:START-->\n' + build_grid(projects) + '<!--GRID:END-->',
        idx, flags=re.S)
    if '<!--CRAFT:START-->' in idx:
        idx = re.sub(
            r'<!--CRAFT:START-->.*?<!--CRAFT:END-->',
            '<!--CRAFT:START-->\n' + build_craft(data.get('craft')) + '<!--CRAFT:END-->',
            idx, flags=re.S)
    # keep the "All" chip count honest
    idx = re.sub(r'(data-filter="all"[^>]*>All <em>)\d+(</em>)',
                 r'\g<1>%d\g<2>' % len(projects), idx)
    with open(idx_path, 'w', encoding='utf-8') as f:
        f.write(idx)

    # 3. sitemap
    urls = ['%s/' % SITE] + ['%s/work/%s.html' % (SITE, p['slug']) for p in projects]
    sm = ('<?xml version="1.0" encoding="UTF-8"?>\n'
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
          + ''.join('  <url><loc>%s</loc></url>\n' % u for u in urls)
          + '</urlset>\n')
    with open(os.path.join(ROOT, 'sitemap.xml'), 'w', encoding='utf-8') as f:
        f.write(sm)

    print('built %d case study pages' % len(projects))
    print('injected %d cards into index.html' % len(projects))
    print('wrote sitemap.xml')


if __name__ == '__main__':
    main()
