"""Rebuild the share image from existing prepared artwork after a brand-copy change."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
assets = Path(__file__).parent / "assets"
hero = Image.open(assets / "hero.webp").convert("RGBA")
logo = Image.open(assets / "orion-mark.webp").convert("RGBA")
social = Image.new("RGBA", (1200, 630), (246, 250, 255, 255))
scene = hero.resize((1200, 643), Image.Resampling.LANCZOS)
social.alpha_composite(scene, (0, -13))
# A separate social card avoids exposing clipped copy from the source mockup.
veil = Image.new("RGBA", social.size)
veil_draw = ImageDraw.Draw(veil)
for x in range(570):
    veil_draw.line((x, 0, x, 630), fill=(246, 250, 255, max(0, 255 - max(0, x - 410) * 2)))
social = Image.alpha_composite(social, veil)
social.alpha_composite(logo.resize((56, 56), Image.Resampling.LANCZOS), (47, 35))
draw = ImageDraw.Draw(social)
font = assets / "fonts" / "anton.ttf"
draw.text((120, 49), "ORION STUDIO", font=ImageFont.truetype(str(font), 23), fill="#20304d")
for i, line in enumerate(("THINK.", "MAKE.", "CONNECT.")):
    draw.text((48, 145 + i * 116), line, font=ImageFont.truetype(str(font), 107), fill="#090d13")
social.convert("RGB").save(assets / "social-studio.jpg", quality=92)
