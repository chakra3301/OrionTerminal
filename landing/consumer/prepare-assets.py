"""Crop the owner's supplied concept into section artwork, not a flat webpage."""
from pathlib import Path
import sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

source = Image.open(sys.argv[1]).convert("RGBA")
if source.size != (858, 1832):
    raise SystemExit("Expected the original 858×1832 concept image.")
assets = Path(__file__).parent / "assets"
assets.mkdir(exist_ok=True)


def save_crop(name, bounds):
    source.crop(bounds).convert("RGB").save(assets / name, "WEBP", quality=94, method=6)


hero = source.crop((0, 57, 858, 517))
mask = Image.new("L", hero.size, 255)
draw = ImageDraw.Draw(mask)
# Remove baked-in copy while retaining the crystal, orb and character artwork.
draw.polygon([(0, 0), (338, 0), (338, 203), (384, 203), (384, 283), (278, 283), (278, 410), (0, 410)], fill=0)
draw.rectangle((0, 283, 278, 460), fill=0)
soft_mask = mask.filter(ImageFilter.MinFilter(39)).filter(ImageFilter.GaussianBlur(18))
hero.putalpha(ImageChops.multiply(mask, soft_mask))
hero.save(assets / "hero.webp", quality=94, method=6)

save_crop("archives.webp", (42, 615, 593, 847))
save_crop("orion.webp", (42, 857, 593, 1055))
save_crop("xdesign.webp", (42, 1066, 593, 1263))
save_crop("flow.webp", (365, 1286, 858, 1526))

closing = source.crop((0, 1530, 858, 1775))
mask = Image.new("L", closing.size, 255)
draw = ImageDraw.Draw(mask)
draw.polygon([(0, 0), (443, 0), (443, 124), (341, 124), (341, 179), (273, 179), (273, 245), (0, 245)], fill=0)
draw.rectangle((688, 0, 858, 172), fill=0)
soft_mask = mask.filter(ImageFilter.MinFilter(25)).filter(ImageFilter.GaussianBlur(12))
closing.putalpha(ImageChops.multiply(mask, soft_mask))
closing.save(assets / "closing.webp", quality=94, method=6)

# These are the actual marks in the supplied concept, not substitute icons.
for name, bounds in {
    "archives-mark.webp": (622, 654, 659, 699),
    "editor-mark.webp": (620, 878, 660, 922),
    "xdesign-mark.webp": (620, 1090, 660, 1131),
}.items():
    icon = source.crop(bounds)
    alpha = Image.new("L", icon.size)
    alpha.putdata([255 - min(255, max(0, min(r, g, b) - 170) * 3) for r, g, b, _ in icon.get_flattened_data()])
    icon.putalpha(alpha)
    icon.save(assets / name, quality=95, method=6)

root = Path(__file__).resolve().parents[2]
logo = Image.open(root / "app-icon.png").convert("RGBA")
logo.thumbnail((160, 160), Image.Resampling.LANCZOS)
logo.save(assets / "orion-mark.webp", quality=96, method=6)
edges = source.crop((0, 540, 858, 1284))
mask = Image.new("L", edges.size, 0)
draw = ImageDraw.Draw(mask)
draw.rectangle((0, 0, 34, 744), fill=255)
draw.rectangle((829, 0, 858, 744), fill=255)
edges.putalpha(mask.filter(ImageFilter.GaussianBlur(3)))
edges.save(assets / "ice-edges.webp", quality=92, method=6)

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
draw.text((120, 49), "ORION TERMINAL", font=ImageFont.truetype(str(font), 23), fill="#20304d")
for i, line in enumerate(("THINK.", "MAKE.", "CONNECT.")):
    draw.text((48, 145 + i * 116), line, font=ImageFont.truetype(str(font), 107), fill="#090d13")
social.convert("RGB").save(assets / "social.jpg", quality=92)
print("Prepared reference-derived artwork and the existing Orion product mark.")
