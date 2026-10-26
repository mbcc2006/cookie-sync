"""Compose Chrome Web Store images from real UI captures in store/raw/.

The captures come from the end-to-end run (welcome page, popup, CLI transcript).
Usage: python store/make_assets.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

STORE = Path(__file__).resolve().parent
RAW = STORE / "raw"
OUT = STORE / "images"
ICON = STORE.parent / "extension" / "icon.png"
FONTS = Path("C:/Windows/Fonts")
BG, INK, MUTED, ACCENT = "#fbf8ef", "#13251d", "#5d6b63", "#d45a34"

CAPTIONS = {
    "en": [
        ("Choose exactly which sites to sync", "Nothing is read until you allow a site. Requests from your CLI appear here for one-click approval."),
        ("Your CLI gets only what you allowed", "Cookies are end-to-end encrypted in the browser. Only your CLI can decrypt them."),
    ],
    "zh": [
        ("精确选择要同步的网站", "在你允许之前不会读取任何网站。CLI 的请求会出现在这里，一键即可授权。"),
        ("CLI 只拿到你允许的网站", "Cookie 在浏览器内端到端加密，只有你的 CLI 能解密。"),
    ],
}


def font(lang, size, bold=False, mono=False):
    if mono and lang == "en":
        return ImageFont.truetype(str(FONTS / "consola.ttf"), size)
    if lang == "zh":
        return ImageFont.truetype(str(FONTS / ("msyhbd.ttc" if bold else "msyh.ttc")), size)
    return ImageFont.truetype(str(FONTS / ("segoeuib.ttf" if bold else "segoeui.ttf")), size)


def wrap(draw, text, fnt, width):
    """Greedy wrap that works for both spaced and CJK text."""
    lines, line = [], ""
    tokens = text.split(" ") if " " in text else list(text)
    sep = " " if " " in text else ""
    for token in tokens:
        candidate = f"{line}{sep}{token}" if line else token
        if draw.textlength(candidate, font=fnt) <= width:
            line = candidate
        else:
            lines.append(line)
            line = token
    lines.append(line)
    return lines


def caption(draw, lang, title, subtitle, x, y, width):
    for line in wrap(draw, title, font(lang, 46, bold=True), width):
        draw.text((x, y), line, font=font(lang, 46, bold=True), fill=INK)
        y += 60
    y += 14
    for line in wrap(draw, subtitle, font(lang, 24), width):
        draw.text((x, y), line, font=font(lang, 24), fill=MUTED)
        y += 36


def framed(img, shadow=18):
    pad = shadow
    frame = Image.new("RGBA", (img.width + pad * 2, img.height + pad * 2), (0, 0, 0, 0))
    ImageDraw.Draw(frame).rounded_rectangle((pad, pad + 6, pad + img.width, pad + img.height + 6), 14, fill=(19, 37, 29, 40))
    frame.paste(img, (pad, pad))
    return frame


def popup_shot(lang):
    canvas = Image.new("RGB", (1280, 800), BG)
    draw = ImageDraw.Draw(canvas)
    popup = Image.open(RAW / f"raw-popup-{lang}.png").convert("RGB")
    popup = popup.crop((0, 0, popup.width, min(popup.height, 720)))
    scale = 720 / popup.height
    popup = popup.resize((int(popup.width * scale), 720), Image.LANCZOS)
    box = Image.new("RGB", (popup.width + 2, popup.height + 2), "#d8d2c0")
    box.paste(popup, (1, 1))
    canvas.paste(framed(box), (1280 - box.width - 110, 22), framed(box))
    caption(draw, lang, *CAPTIONS[lang][0], 90, 250, 560)
    return canvas


def cli_shot(lang):
    canvas = Image.new("RGB", (1280, 800), BG)
    draw = ImageDraw.Draw(canvas)
    caption(draw, lang, *CAPTIONS[lang][1], 90, 90, 1100)
    term = Image.new("RGB", (1100, 430), "#13251d")
    tdraw = ImageDraw.Draw(term)
    for i, color in enumerate(("#ef6a5a", "#f4bf4f", "#61c454")):
        tdraw.ellipse((22 + i * 26, 18, 38 + i * 26, 34), fill=color)
    y = 58
    mono = font(lang, 21, mono=True)
    for raw in (RAW / f"cli-{lang}.txt").read_text(encoding="utf-8").splitlines():
        color = "#b9f27c" if raw.startswith("$ ") else "#ffb4a2" if "cookie-sync:" in raw else "#e7ece9"
        for line in wrap(tdraw, raw, mono, 1040) if raw else [""]:
            tdraw.text((28, y), line, font=mono, fill=color)
            y += 30
    canvas.paste(framed(term), (90 - 18, 290 - 18), framed(term))
    return canvas


def promo_tile():
    tile = Image.new("RGB", (440, 280), INK)
    draw = ImageDraw.Draw(tile)
    icon = Image.open(ICON).convert("RGBA").resize((96, 96), Image.LANCZOS)
    tile.paste(icon, (40, 50), icon)
    draw.text((40, 186), "CookieSync", font=font("en", 38, bold=True), fill=BG)
    draw.text((40, 236), "Keep headless browsers signed in", font=font("en", 19), fill="#c9d6cf")
    draw.rectangle((40, 160, 92, 164), fill=ACCENT)
    return tile


def main():
    OUT.mkdir(exist_ok=True)
    for lang in CAPTIONS:
        Image.open(RAW / f"raw-welcome-{lang}.png").convert("RGB").resize((1280, 800)).save(OUT / f"{lang}-1-disclosure.png", optimize=True)
        popup_shot(lang).save(OUT / f"{lang}-2-sites.png", optimize=True)
        cli_shot(lang).save(OUT / f"{lang}-3-cli.png", optimize=True)
    promo_tile().save(OUT / "promo-small-440x280.png", optimize=True)
    for p in sorted(OUT.iterdir()):
        with Image.open(p) as im:
            print(f"{p.name}: {im.size[0]}x{im.size[1]}")


if __name__ == "__main__":
    main()
