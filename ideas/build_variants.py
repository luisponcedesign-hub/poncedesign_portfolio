#!/usr/bin/env python3
"""Build the /ideas home-page variants from the live site.

Each variant is the live home page and every case study verbatim (same
sections, copy, scripts and behaviour) with paths rewritten for
/ideas/<slug>/, analytics stripped, noindex added, and ideas/swiss.css
layered over the live stylesheet. The variant's work grid links to its own
copies in /ideas/<slug>/work/. Re-run after editing index.html or after
scripts/build.py to resync:

    python3 ideas/build_variants.py
"""
import pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
HOME = (ROOT / "index.html").read_text(encoding="utf-8")
CASES = sorted((ROOT / "work").glob("*.html"))

VARIANTS = {
    "home-c": ("v-c", "Home C — Swiss, Roboto"),
    "home-d": ("v-d", "Home D — Swiss, Helvetica"),
}
ATTRS = r"(href|src|content|poster|data-src)"


def common(h, cls, label, title, up):
    """up: path from the page back to /ideas/ ('../' or '../../')."""
    # Experiments shouldn't count as traffic on the live site.
    h = re.sub(r"\s*<!-- Google tag \(gtag\.js\) -->.*?</script>\s*<script>.*?</script>", "", h, count=1, flags=re.S)
    h = re.sub(r"\s*<script async src=\"https://www\.googletagmanager\.com/gtag/js[^\"]*\"></script>\s*<script>.*?</script>", "", h, count=1, flags=re.S)
    h = re.sub(r"\s*<link rel=\"canonical\"[^>]*>", "", h)
    # The live pages now carry the Swiss layer themselves; variants bring their own.
    h = re.sub(r"\s*<link rel=\"stylesheet\" href=\"[./]*assets/css/swiss\.css[^\"]*\">", "", h)
    h = h.replace('<html lang="en">', f'<html lang="en" class="{cls}">', 1)
    h = h.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="robots" content="noindex, nofollow">', 1)
    h = re.sub(r"<title>(.*?)</title>", lambda m: f"<title>{title(m.group(1))}</title>", h, count=1)
    h = re.sub(r'(<link rel="stylesheet" href="[./]*assets/css/style\.css[^"]*">)',
               rf'\1\n<link rel="stylesheet" href="{up}swiss.css">', h, count=1)
    badge = f'<p class="ideas-badge">Idea · {label} &nbsp;<a href="{up}">All ideas</a></p>\n'
    return h.replace("</body>", badge + "</body>", 1)


def build(slug, cls, label):
    out = ROOT / "ideas" / slug
    (out / "work").mkdir(parents=True, exist_ok=True)

    # Home: shared files resolve two levels up; work/ stays local.
    h = re.sub(ATTRS + r'="(assets/|resume\.html)', r'\1="../../\2', HOME)
    h = common(h, cls, label, lambda t: f"{label} · Ideas", "../")
    (out / "index.html").write_text(h, encoding="utf-8")

    # Case studies: ../assets → ../../../assets; ../index.html is the variant home.
    for f in CASES:
        c = f.read_text(encoding="utf-8")
        c = re.sub(ATTRS + r'="\.\./(assets/|resume\.html)', r'\1="../../../\2', c)
        c = common(c, cls, label, lambda t: f"{t} · {label}", "../../")
        (out / "work" / f.name).write_text(c, encoding="utf-8")
    print(f"wrote ideas/{slug}/ (home + {len(CASES)} case studies)")


for slug, (cls, label) in VARIANTS.items():
    build(slug, cls, label)
