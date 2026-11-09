#!/usr/bin/env python3
"""Buat potret flat-vector orisinal untuk semua pegawai AI (public/agents/<slug>.svg)."""
import json, os, random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
data = json.load(open(os.path.join(ROOT, "skills", "agents.json")))
agents = data["agents"] if isinstance(data, dict) and "agents" in data else data

SKIN = ["#F2C9A5", "#E8B48C", "#D9A176", "#C98A5E", "#B07248", "#8C5A3C"]
HAIR = ["#1F1B18", "#2C2420", "#3B2A1E", "#4E3425", "#5C4033", "#111111"]
BG = {
    "marketing": ("#DBEAFE", "#2563EB"), "graphic-designer": ("#EDE9FE", "#7C3AED"), "video-editor": ("#FCE7F3", "#DB2777"),
    "sales": ("#FEF3C7", "#D97706"), "hr": ("#D1FAE5", "#059669"), "finance": ("#E0F2FE", "#0284C7"),
    "management": ("#E2E8F0", "#334155"), "builder": ("#CCFBF1", "#0D9488"), "engineering": ("#FEF9C3", "#B45309"),
    "event": ("#FFE4E6", "#E11D48"), "religi": ("#DCFCE7", "#15803D"),
}
FEMALE = {"eka", "dewi", "dian", "fani", "hani", "kira", "luna", "maya", "meda", "sari", "vera", "vika", "zara"}

def hair_svg(style, color, long_hair):
    # Semua bentuk relatif ke kepala: pusat (48,44), radius 20
    if style == "short":
        return f'<path d="M27 42c0-14 9-22 21-22s21 8 21 22c-3-8-10-12-21-12s-18 4-21 12z" fill="{color}"/>'
    if style == "side":
        return f'<path d="M27 44c-1-15 8-24 22-24 11 0 19 7 20 18-9-4-15-7-24-7-8 0-14 4-18 13z" fill="{color}"/>'
    if style == "curly":
        return (f'<circle cx="31" cy="34" r="8" fill="{color}"/><circle cx="40" cy="26" r="9" fill="{color}"/>'
                f'<circle cx="52" cy="24" r="9" fill="{color}"/><circle cx="63" cy="31" r="8" fill="{color}"/>'
                f'<circle cx="67" cy="42" r="7" fill="{color}"/><circle cx="29" cy="44" r="7" fill="{color}"/>')
    if style == "bun":
        return (f'<circle cx="48" cy="20" r="7" fill="{color}"/>'
                f'<path d="M27 44c0-14 9-22 21-22s21 8 21 22c-4-7-10-11-21-11s-17 4-21 11z" fill="{color}"/>')
    if style == "long":
        return (f'<path d="M26 46c0-16 9-26 22-26s22 10 22 26v22c0 3-3 5-6 5H32c-3 0-6-2-6-5V46z" fill="{color}"/>'
                f'<path d="M30 46c3-9 9-13 18-13s15 4 18 13c-4-4-10-6-18-6s-14 2-18 6z" fill="{color}"/>')
    if style == "bob":
        return (f'<path d="M27 46c0-15 9-24 21-24s21 9 21 24v12c0 2-2 4-4 4H31c-2 0-4-2-4-4V46z" fill="{color}"/>'
                f'<path d="M30 46c3-8 9-12 18-12s15 4 18 12c-4-4-10-5-18-5s-14 1-18 5z" fill="{color}"/>')
    if style == "peci":
        return (f'<path d="M30 36c0-9 8-14 18-14s18 5 18 14z" fill="#111827"/>'
                f'<rect x="29" y="33" width="38" height="5" rx="1.5" fill="#1F2937"/>')
    if style == "cap":
        return (f'<path d="M27 37c0-12 9-20 21-20s21 8 21 20H27z" fill="{color}"/>'
                f'<rect x="23" y="35" width="42" height="4.5" rx="2.2" fill="{color}"/>')
    return ""

def avatar(slug, name, cat, i):
    rnd = random.Random(slug)
    bg, accent = BG.get(cat, ("#E2E8F0", "#334155"))
    skin = rnd.choice(SKIN)
    hair_c = rnd.choice(HAIR)
    first = slug.split("-")[0]
    female = first in FEMALE
    style = rnd.choice(["long", "bob", "bun", "curly"] if female else ["short", "side", "curly", "cap"])
    shirt = accent
    glasses = rnd.random() < 0.3
    beard = (not female) and rnd.random() < 0.3
    if cat == "religi":
        style, beard, glasses = "peci", True, False
    smile = rnd.choice(["M41 54q7 6 14 0", "M42 54q6 4 12 0", "M41 53q7 7 14 0"])
    earring = female and rnd.random() < 0.5
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96">',
        f'<defs><clipPath id="c"><circle cx="48" cy="48" r="48"/></clipPath></defs>',
        f'<g clip-path="url(#c)">',
        f'<rect width="96" height="96" fill="{bg}"/>',
        f'<circle cx="48" cy="20" r="46" fill="#fff" opacity=".35"/>',
        # badan / kemeja
        f'<path d="M16 100c0-18 14-30 32-30s32 12 32 30z" fill="{shirt}"/>',
        f'<path d="M40 70h16l-8 12z" fill="#fff" opacity=".9"/>',
        # leher
        f'<rect x="41" y="56" width="14" height="14" rx="5" fill="{skin}"/>',
    ]
    if style in ("long", "bob"):
        parts.append(hair_svg(style, hair_c, True))
    # kepala
    parts.append(f'<ellipse cx="48" cy="44" rx="19" ry="21" fill="{skin}"/>')
    # telinga
    parts.append(f'<circle cx="29" cy="46" r="3.5" fill="{skin}"/><circle cx="67" cy="46" r="3.5" fill="{skin}"/>')
    if earring:
        parts.append(f'<circle cx="29" cy="51" r="1.6" fill="{accent}"/><circle cx="67" cy="51" r="1.6" fill="{accent}"/>')
    if style not in ("long", "bob"):
        parts.append(hair_svg(style, hair_c, False))
    else:
        # poni untuk rambut panjang
        parts.append(f'<path d="M30 44c2-9 8-14 18-14s16 5 18 14c-4-4-10-6-18-6s-14 2-18 6z" fill="{hair_c}"/>')
    # alis & mata
    parts.append(f'<path d="M38 41q4-3 8 0M50 41q4-3 8 0" stroke="{hair_c}" stroke-width="1.6" fill="none" stroke-linecap="round"/>')
    parts.append(f'<circle cx="42" cy="46" r="2" fill="#1F1B18"/><circle cx="54" cy="46" r="2" fill="#1F1B18"/>')
    parts.append(f'<circle cx="42.7" cy="45.3" r=".6" fill="#fff"/><circle cx="54.7" cy="45.3" r=".6" fill="#fff"/>')
    if glasses:
        parts.append(f'<g fill="none" stroke="#1F2937" stroke-width="1.4"><circle cx="42" cy="46" r="5"/><circle cx="54" cy="46" r="5"/><path d="M47 46h2M37 45l-4-1M59 45l4-1"/></g>')
    # hidung & mulut
    parts.append(f'<path d="M48 48v3" stroke="#00000030" stroke-width="1.5" stroke-linecap="round"/>')
    parts.append(f'<path d="{smile}" stroke="#9A3B3B" stroke-width="1.6" fill="none" stroke-linecap="round"/>')
    parts.append(f'<ellipse cx="36" cy="51" rx="3" ry="1.6" fill="#F0A1A1" opacity=".5"/><ellipse cx="60" cy="51" rx="3" ry="1.6" fill="#F0A1A1" opacity=".5"/>')
    if beard:
        parts.append(f'<path d="M33 50c2 9 7 14 15 14s13-5 15-14c-3 5-8 8-15 8s-12-3-15-8z" fill="{hair_c}" opacity=".9"/>')
    parts.append("</g></svg>")
    return "".join(parts)

out = os.path.join(ROOT, "public", "agents")
os.makedirs(out, exist_ok=True)
for i, a in enumerate(agents):
    slug = a.get("slug") or a["name"]
    cat = a.get("category", "marketing")
    with open(os.path.join(out, f"{slug}.svg"), "w") as f:
        f.write(avatar(slug, a.get("display_name", ""), cat, i))
print("ok", len(agents))
