"""Generates the PROTOTYPE sample property folders bundled with the app, plus the app icon.

Layout produced (mirrors the Drive property folders):
  src/PostIt.App/SampleData/Properties/<Category>/<Property name>/posting.txt
  src/PostIt.App/SampleData/Properties/<Category>/<Property name>/photo-N.jpg

Run:  python3 tools/make_sample_data.py
"""
import os, random, shutil, textwrap
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.join(os.path.dirname(__file__), '..', 'src', 'PostIt.App')
OUT = os.path.join(ROOT, 'SampleData', 'Properties')
FONT_BOLD = os.path.join(ROOT, 'Fonts', 'Outfit-Bold.ttf')
FONT_REG = os.path.join(ROOT, 'Fonts', 'Outfit-Regular.ttf')

INTERNAL = textwrap.dedent("""
    === INTERNAL — DO NOT POST ===
    Commission: {comm} to agent, 1% referral fee
    Owner: {owner} (direct). Net to owner {net}.
    Terms: {terms}
    Notes: {notes}
""").strip()

# name, category, location, size line, price, blurb, extras, internal-mode
#   internal-mode: 'marker' (normal), 'none' (no internal marker -> warning), 'leak' (commission wording in public part)
PROPS = [
    ("Verdant Hills Lot 12", "Lot", "Tagaytay", "320 sqm residential lot", "₱4.2M",
     "Cool climate all year, 10 minutes to the Rotonda, near schools and the public market. Flat, buildable, with clean title.", "marker"),
    ("Verdant Hills Lot 7", "Lot", "Tagaytay", "280 sqm corner lot", "₱3.6M",
     "Corner lot inside a gated subdivision with 24/7 security. Ridge view on clear days.", "marker"),
    ("Verdant Hills Lot 3", "Lot", "Tagaytay", "300 sqm inner lot", "₱3.9M",
     "Quiet inner street, walking distance to the clubhouse and pool.", "marker"),
    ("Greenfield Farm Lot", "Lot", "Batangas", "1,200 sqm farm lot", "₱2.4M",
     "Fruit-bearing mango trees, water source on site, 15 minutes to the town proper.", "marker"),
    ("Sta. Rosa Lot 22", "Lot", "Laguna", "250 sqm residential lot", "₱3.1M",
     "Near Nuvali and SLEX exits. Ready for construction.", "marker"),
    ("Antipolo Ridge Lot 18", "Lot", "Antipolo", "400 sqm view lot", "₱5.8M",
     "City-lights view, cool breeze, 20 minutes to Marikina.", "marker"),
    ("Casa Amara House & Lot", "House & Lot", "Dasmariñas", "3BR · 2T&B · 150 sqm lot", "₱6.5M",
     "Two-storey home with carport, near De La Salle and SM Dasmariñas.", "marker"),
    ("Sunrise Homes Block 3 Lot 9", "House & Lot", "Bacoor", "2BR townhouse · 80 sqm lot", "₱3.2M",
     "Flood-free, near Aguinaldo Highway and Molino Boulevard.", "none"),
    ("Imus Townhomes Phase 2", "House & Lot", "Imus", "3BR townhouse · 90 sqm lot", "₱4.1M",
     "Gated community with playground and basketball court.", "marker"),
    ("Seaside Residences 2BR", "Condo", "Pasay", "2BR · 58 sqm · with balcony", "₱8.9M",
     "Bay view, walking distance to Mall of Asia. Fully furnished option available.", "marker"),
    ("Villa Rosario Unit 4B", "Condo", "Quezon City", "1BR · 32 sqm", "₱4.6M",
     "Near UP Diliman and the MRT. Rent-ready.", "marker"),
    ("Lakeshore Villas Unit 7", "Condo", "Taguig", "Studio · 26 sqm", "₱3.8M",
     "Lake-facing studio with access to the jogging path and pool.", "marker"),
    ("Mabini Commercial Space", "Commercial", "Makati", "Ground floor · 120 sqm", "₱180K / month",
     "High foot traffic along Mabini, suitable for a café or clinic.", "leak"),
    ("Prime Tower Office 1201", "Commercial", "Ortigas", "Office · 95 sqm · 12th floor", "₱11.5M",
     "Fitted office with 2 parking slots, near Robinsons Galleria.", "marker"),
]

PALETTES = [((74, 64, 48), (26, 25, 22)), ((52, 70, 58), (20, 26, 22)), ((64, 58, 78), (22, 20, 28)),
            ((86, 70, 44), (30, 24, 16)), ((48, 62, 80), (18, 22, 30))]


def photo(path, title, idx, seed):
    rnd = random.Random(seed)
    W, H = 960, 720
    top, bot = PALETTES[seed % len(PALETTES)]
    img = Image.new('RGB', (W, H))
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=tuple(int(top[i] * (1 - t) + bot[i] * t) for i in range(3)))
    # simple "scene": sky band, hills / buildings
    for k in range(3):
        base = H * (0.55 + 0.1 * k)
        pts = [(0, H)] + [(x, base - rnd.randint(10, 90)) for x in range(0, W + 120, 120)] + [(W, H)]
        shade = 40 + 18 * k
        d.polygon(pts, fill=(shade + rnd.randint(0, 20), shade + 10, shade - 5))
    if idx % 2 == 0:  # a house-ish block
        x0 = rnd.randint(140, 520); y0 = int(H * 0.45)
        d.rectangle([x0, y0, x0 + 300, y0 + 190], fill=(214, 200, 168))
        d.polygon([(x0 - 20, y0), (x0 + 150, y0 - 110), (x0 + 320, y0)], fill=(150, 112, 70))
        for wx in (x0 + 40, x0 + 190):
            d.rectangle([wx, y0 + 50, wx + 70, y0 + 110], fill=(90, 120, 140))
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    d = ImageDraw.Draw(img)
    f1 = ImageFont.truetype(FONT_BOLD, 34); f2 = ImageFont.truetype(FONT_REG, 22)
    d.rounded_rectangle([24, H - 108, W - 24, H - 24], radius=16, fill=(16, 16, 16))
    d.text((48, H - 98), title, font=f1, fill=(243, 236, 216))
    d.text((48, H - 56), f"Photo {idx} · PROTOTYPE sample image", font=f2, fill=(232, 198, 82))
    img.save(path, quality=78)


def posting(name, cat, loc, size, price, blurb, mode, seed):
    rnd = random.Random(seed)
    lines = [f"Category: {cat}", f"Location: {loc}", "",
             f"FOR SALE: {size} – {name}, {loc}" if 'month' not in price else f"FOR LEASE: {size} – {name}, {loc}",
             blurb,
             f"Price: {price}",
             "Contact: 0917 000 0000 / 0920 000 0000",
             "Site visits by appointment. Message us to book a schedule."]
    if mode == 'leak':
        lines.insert(7, "5% commission to referring agents — inquire for details.")
    body = "\n".join(lines)
    if mode != 'none':
        body += "\n\n" + INTERNAL.format(
            comm=rnd.choice(['3%', '4%', '5%']), owner=rnd.choice(['Mr. Reyes', 'Mrs. Santos', 'Dr. Lim', 'Atty. Cruz']),
            net=rnd.choice(['₱3.9M', '₱5.1M', '₱8.2M', 'as listed']),
            terms=rnd.choice(['20% DP, balance 12 months', 'Cash or bank financing', 'Spot cash 5% discount']),
            notes=rnd.choice(['Owner prefers weekend viewings.', 'Title under transfer, ETA 2 weeks.', 'Keys with the guard house.']))
    return body + "\n"


def icon():
    S = 256
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    d.ellipse([4, 4, S - 4, S - 4], fill=(23, 23, 23, 255), outline=(54, 54, 54, 255), width=4)
    # gold spiral of half-arcs, like the mockup logo
    c = S / 2; gold = (232, 198, 82, 255); r = 12; up = True
    cx = c
    for i in range(5):
        box = [cx - r, c - r, cx + r, c + r]
        d.arc(box, 180 if up else 0, 360 if up else 180, fill=gold, width=12)
        cx = cx + r if up else cx - r
        r += 18; cx = cx - 18 if up else cx + 18; up = not up
    img.save(os.path.join(ROOT, 'Assets', 'postit.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    img.save(os.path.join(ROOT, 'Assets', 'logo.png'))


if __name__ == '__main__':
    if os.path.isdir(OUT): shutil.rmtree(OUT)
    for i, (name, cat, loc, size, price, blurb, mode) in enumerate(PROPS):
        folder = os.path.join(OUT, cat, name); os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, 'posting.txt'), 'w', encoding='utf-8') as fh:
            fh.write(posting(name, cat, loc, size, price, blurb, mode, i))
        for k in range(1, 4 if i % 3 else 5):
            photo(os.path.join(folder, f'photo-{k}.jpg'), name, k, i * 7 + k)
    os.makedirs(os.path.join(ROOT, 'Assets'), exist_ok=True)
    icon()
    with open(os.path.join(OUT, '..', 'README.txt'), 'w', encoding='utf-8') as fh:
        fh.write("PROTOTYPE sample data. Each folder under Properties/<Category>/ is one property:\n"
                 "posting.txt holds the public posting text, then an '=== INTERNAL ===' line, then the internal notes.\n"
                 "On first run the app copies this into %LOCALAPPDATA%\\APG.PostIt\\PROTOTYPE-sample and points to it.\n")
    print('done')
