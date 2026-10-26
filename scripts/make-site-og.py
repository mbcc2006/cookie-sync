"""Generate site/og.png (1200x630) for link previews. Usage: python scripts/make-site-og.py"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONTS = Path("C:/Windows/Fonts")
INK, CREAM, ACID, ORANGE = "#13251d", "#f4f0e6", "#c9ff45", "#ff6b35"

img = Image.new("RGB", (1200, 630), INK)
draw = ImageDraw.Draw(img)
icon = Image.open(ROOT / "extension" / "icon.png").convert("RGBA").resize((150, 150), Image.LANCZOS)
img.paste(icon, (90, 90), icon)
draw.rectangle((90, 290, 190, 297), fill=ORANGE)
draw.text((90, 400), "CookieSync", font=ImageFont.truetype(str(FONTS / "segoeuib.ttf"), 96), fill=CREAM, anchor="ls")
draw.text((94, 470), "Keep headless browsers signed in.", font=ImageFont.truetype(str(FONTS / "segoeui.ttf"), 42), fill=ACID, anchor="ls")
draw.text((94, 540), "End-to-end encrypted cookie sync from Chrome to your CLI, Playwright, curl and yt-dlp.",
          font=ImageFont.truetype(str(FONTS / "segoeui.ttf"), 26), fill="#c9d6cf", anchor="ls")
img.save(ROOT / "site" / "og.png", optimize=True)
print("site/og.png", img.size)
