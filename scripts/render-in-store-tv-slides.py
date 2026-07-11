#!/usr/bin/env python3
"""Regenerate in-store TV marketing slides."""

from __future__ import annotations

import base64
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "marketing" / "in-store-tv"
SRC = ROOT / "public" / "marketing" / "small-group-training.png"
PNF_SVG = OUT_DIR / "pnf-stretching.svg"

W, H = 1920, 1080
SPLIT = 940
LEFT_X = 76
MINT = "#9ef6b2"
BLUE = "#62b6ff"
GOLD = "#ffce7a"
WHITE = "#ffffff"
DARK = "#0f1a12"


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    paths = {
        "g": "/System/Library/Fonts/Supplemental/Georgia.ttf",
        "gi": "/System/Library/Fonts/Supplemental/Georgia Italic.ttf",
        "gb": "/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
        "ab": "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    }
    return ImageFont.truetype(paths[name], size)


def draw_centered_text(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, fnt, fill: str) -> None:
    x, y = xy
    bbox = draw.textbbox((0, 0), text, font=fnt)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text((x - tw / 2 - bbox[0], y - th / 2 - bbox[1]), text, fill=fill, font=fnt)


def make_gym_background() -> Image.Image:
    raw = Image.open(SRC).convert("RGB")
    gym = raw.crop((920, 0, raw.width, raw.height))
    scale = max(W / gym.width, H / gym.height) * 1.02
    nw, nh = int(gym.width * scale), int(gym.height * scale)
    bg = gym.resize((nw, nh), Image.Resampling.LANCZOS)
    left = (nw - W) // 2
    top = (nh - H) // 2
    bg = bg.crop((left, top, left + W, top + H))
    bg = ImageEnhance.Brightness(bg).enhance(0.62)
    bg = ImageEnhance.Contrast(bg).enhance(1.12)

    canvas = Image.new("RGB", (W, H), "#121412")
    canvas.paste(bg, (0, 0))

    scrim = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(scrim)
    for x in range(0, SPLIT, 6):
        lx = x / SPLIT
        a = int(220 * (1 - lx * 0.28))
        sd.rectangle([x, 0, x + 6, H], fill=(8, 10, 8, min(255, a)))
    for x in range(SPLIT, W, 6):
        rx = (x - SPLIT) / (W - SPLIT)
        a = int(55 + 80 * rx)
        sd.rectangle([x, 0, x + 6, H], fill=(8, 10, 8, min(185, a)))
    return Image.alpha_composite(canvas.convert("RGBA"), scrim).convert("RGB")


def draw_top_bar(draw: ImageDraw.ImageDraw, style: str = "mint") -> None:
    for x in range(W):
        t = x / W
        if style == "mint":
            col = (90, 189, 120) if t < 0.5 else (158, 246, 178)
        elif style == "fitness":
            col = (int(90 + 8 * t), int(189 - 7 * t), int(120 + 135 * t))
        else:  # warm
            col = (int(255 - 75 * t), int(206 - 30 * t), int(122 + 50 * t))
        draw.line([(x, 0), (x, 10)], fill=col)


def draw_phone_icon(draw: ImageDraw.ImageDraw, x: int, y: int, size: int, color: str) -> None:
    w, h = size, int(size * 1.55)
    stroke = max(3, size // 9)
    draw.rounded_rectangle([x, y, x + w, y + h], radius=max(4, size // 5), outline=color, width=stroke)
    draw.line([(x + w // 2 - 10, y + h - 10), (x + w // 2 + 10, y + h - 10)], fill=color, width=stroke)


def draw_email_icon(draw: ImageDraw.ImageDraw, x: int, y: int, size: int, color: str) -> None:
    w, h = size + 10, int(size * 0.75)
    stroke = max(3, size // 9)
    draw.rectangle([x, y + 8, x + w, y + 8 + h], outline=color, width=stroke)
    draw.polygon([(x, y + 8), (x + w // 2, y + h // 2 + 12), (x + w, y + 8)], outline=color)


def draw_instagram_icon(draw: ImageDraw.ImageDraw, x: int, y: int, size: int, color: str) -> None:
    stroke = max(3, size // 9)
    box = size + 10
    draw.rounded_rectangle([x, y, x + box, y + box], radius=7, outline=color, width=stroke)
    cx, cy = x + box // 2, y + box // 2
    r = max(7, size // 5)
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=color, width=stroke)
    dot = max(4, size // 9)
    draw.ellipse([x + box - dot - 5, y + 5, x + box - 5, y + 5 + dot], fill=color)


def draw_in_app_icon(draw: ImageDraw.ImageDraw, x: int, y: int, size: int, color: str) -> None:
    stroke = max(3, size // 9)
    box = size + 8
    draw.rounded_rectangle([x, y, x + box, y + box], radius=8, outline=color, width=stroke)
    pad = 7
    dot = 5
    for row in range(2):
        for col in range(2):
            dx = x + pad + col * (dot + 6)
            dy = y + pad + row * (dot + 6)
            draw.rounded_rectangle([dx, dy, dx + dot, dy + dot], radius=1, fill=color)


def draw_contact_row(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    icon_fn,
    label: str,
    accent: str,
    row_f,
    icon_size: int,
) -> int:
    icon_fn(draw, x, y, icon_size, accent)
    text_y = y + (icon_size + 10 - (row_f.size)) // 2
    draw.text((x + icon_size + 18, text_y), label, fill=WHITE, font=row_f)
    bbox = draw.textbbox((x, y), label, font=row_f)
    return bbox[3] - y + 8


def draw_contact_block_bottom(
    draw: ImageDraw.ImageDraw,
    column_left: int,
    column_width: int,
    accent: str,
    bottom_margin: int = 44,
) -> None:
    """Left-aligned BOOK header + 2x2 contact grid at bottom of left column."""
    book_f = font("ab", 54)
    row_f = font("ab", 36)
    icon_size = 40
    x = column_left
    col_gap = 36
    col_w = (column_width - col_gap) // 2
    row_h = icon_size + 20

    phone = "808-970-4969"
    email = "ponofitco@gmail.com"
    instagram = "@ponofitco"

    block_h = 58 + row_h + 18 + row_h
    y = H - bottom_margin - block_h

    draw.text((x, y), "BOOK", fill=accent, font=book_f)
    y += 58 + 10

    grid = [
        (draw_in_app_icon, "In-App"),
        (draw_phone_icon, phone),
        (draw_email_icon, email),
        (draw_instagram_icon, instagram),
    ]
    for i, (icon_fn, label) in enumerate(grid):
        col = i % 2
        row = i // 2
        cx = x + col * (col_w + col_gap)
        cy = y + row * (row_h + 18)
        draw_contact_row(draw, cx, cy, icon_fn, label, accent, row_f, icon_size)


def contact_reserved_height() -> int:
    return 250


def contact_block_top(bottom_margin: int = 44, gap_above: int = 20) -> int:
    """Y coordinate where the BOOK block starts."""
    row_h = 40 + 20
    block_h = 58 + row_h + 18 + row_h
    return H - bottom_margin - block_h - gap_above


def left_column_top() -> int:
    return 68


def draw_panel(canvas: Image.Image, px: int, py: int, pw: int, ph: int, top_style: str = "mint") -> ImageDraw.ImageDraw:
    panel = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
    pd = ImageDraw.Draw(panel)
    pd.rounded_rectangle([0, 0, pw, ph], radius=34, fill=(16, 18, 16, 235))
    pd.rounded_rectangle([0, 0, pw, ph], radius=34, outline=(158, 246, 178, 170), width=3)
    if top_style == "mint":
        pd.rectangle([3, 3, pw - 3, 10], fill=(158, 246, 178, 255))
    elif top_style == "fitness":
        for x in range(pw):
            t = x / pw
            col = (int(158 - 60 * t), int(246 - 64 * t), int(178 + 77 * t), 255)
            pd.line([(x, 3), (x, 10)], fill=col)
    else:
        pd.rectangle([3, 3, pw - 3, 10], fill=(255, 206, 122, 255))
    canvas.paste(panel, (px, py), panel)
    return ImageDraw.Draw(canvas)


def draw_numbered_rows(
    draw: ImageDraw.ImageDraw,
    px: int,
    py: int,
    pw: int,
    ph: int,
    items: list[str],
    header: str,
    accent: str = MINT,
    header_size: int = 62,
    step_size: int = 44,
    note: str | None = None,
) -> None:
    draw.text((px + 48, py + 42), header, fill=WHITE, font=font("gb", header_size))
    content_top = py + 132
    content_bottom = py + ph - 36
    row_h = (content_bottom - content_top) // len(items)
    sx = px + 48
    num_r = 36
    step_f = font("ab", step_size)
    note_f = font("ab", 22)
    num_f = font("ab", 34)

    for i, item in enumerate(items):
        row_top = content_top + i * row_h
        cy = row_top + row_h // 2
        cx = sx + num_r
        if i > 0:
            draw.line([(px + 40, row_top), (px + pw - 40, row_top)], fill="#ffffff55", width=2)
        draw.ellipse([cx - num_r, cy - num_r, cx + num_r, cy + num_r], fill=accent)
        draw_centered_text(draw, (cx, cy), str(i + 1), num_f, DARK)
        tx = sx + num_r * 2 + 30
        ty = cy - 24
        if note and i == 0:
            words = item.split()
            lines, cur = [], ""
            max_w = pw - (tx - px) - 44
            for w in words:
                t = (cur + " " + w).strip()
                if draw.textlength(t, font=step_f) <= max_w:
                    cur = t
                else:
                    if cur:
                        lines.append(cur)
                    cur = w
            if cur:
                lines.append(cur)
            for ln in lines[:2]:
                draw.text((tx, ty), ln, fill=WHITE, font=step_f)
                ty += 42
            ny = ty + 6
            note_words = note.split()
            nlines, cur = [], ""
            for w in note_words:
                t = (cur + " " + w).strip()
                if draw.textlength(t, font=note_f) <= max_w:
                    cur = t
                else:
                    if cur:
                        nlines.append(cur)
                    cur = w
            if cur:
                nlines.append(cur)
            for ln in nlines:
                draw.text((tx, ny), ln, fill=accent, font=note_f)
                ny += 22
        else:
            draw.text((tx, cy - 24), item, fill=WHITE, font=step_f)


def render_small_group() -> None:
    canvas = make_gym_background()
    d = ImageDraw.Draw(canvas)
    draw_top_bar(d, "mint")
    d.line([(SPLIT, 64), (SPLIT, H - 64)], fill="#ffffff35", width=2)

    brand = font("ab", 38)
    title = font("g", 120)
    tag = font("gi", 46)
    pill_f = font("ab", 46)
    tag_lines = ["Train with your friends,", "and split the bill"]
    pill_text = "$100/hour (total) \u00b7 up to 4 people"

    tmp = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    payment_note = "NO PAYMENT REQUIRED UNTIL AFTER THE SESSION"
    payment_f = font("ab", 38)
    note_lines: list[str] = []
    max_note_w = SPLIT - LEFT_X - 8
    cur = ""
    for w in payment_note.split():
        t = (cur + " " + w).strip()
        if tmp.textlength(t, font=payment_f) <= max_note_w:
            cur = t
        else:
            if cur:
                note_lines.append(cur)
            cur = w
    if cur:
        note_lines.append(cur)
    note_line_h = 46
    note_block_h = len(note_lines) * note_line_h + 24

    pill_bb = tmp.textbbox((0, 0), pill_text, font=pill_f)
    pill_box_h = pill_bb[3] - pill_bb[1] + 52
    content_h = 86 + 120 * 2 + 36 + 46 * 2 + 48 + pill_box_h + note_block_h
    y = (H - contact_reserved_height() - content_h) // 2 + 8

    d.text((LEFT_X, y), "PONO FIT CO.", fill=MINT, font=brand)
    y += 86
    d.text((LEFT_X, y), "Small-Group", fill=WHITE, font=title)
    y += 124
    d.text((LEFT_X, y), "Training", fill=WHITE, font=title)
    y += 132
    for tl in tag_lines:
        d.text((LEFT_X + 2, y), tl, fill="#e8e8e8", font=tag)
        y += 50
    y += 28
    pill_w = pill_bb[2] - pill_bb[0] + 76
    d.rounded_rectangle([LEFT_X, y, LEFT_X + pill_w, y + pill_box_h], radius=24, fill=MINT)
    d.text((LEFT_X + 38, y + 22), pill_text, fill=DARK, font=pill_f)
    y += pill_box_h + 24
    for ln in note_lines:
        d.text((LEFT_X, y), ln, fill=MINT, font=payment_f)
        y += note_line_h
    draw_contact_block_bottom(d, LEFT_X, SPLIT - LEFT_X, MINT)

    px, py, pw, ph = SPLIT + 20, 56, W - SPLIT - 40, H - 112
    d = draw_panel(canvas, px, py, pw, ph, "mint")
    draw_numbered_rows(
        d,
        px,
        py,
        pw,
        ph,
        [
            "Book a slot on the schedule",
            "Invite your friends",
            "We train you together",
            "Split the fee how you like",
        ],
        "How it works",
        MINT,
        step_size=50,
    )

    out = OUT_DIR / "small-group-training.png"
    canvas.save(out, optimize=True)
    print(f"wrote {out}")


def render_fitness_assessment() -> None:
    canvas = make_gym_background()
    d = ImageDraw.Draw(canvas)
    draw_top_bar(d, "fitness")
    d.line([(SPLIT, 64), (SPLIT, H - 64)], fill="#ffffff35", width=2)

    brand = font("ab", 36)
    title = font("g", 100)
    tag = font("gi", 44)
    bullet_f = font("ab", 38)
    pill_f = font("ab", 42)
    tag_lines = ["Know your baseline.", "Train with purpose."]
    bullets = [
        "Identify strengths and limitations",
        "Set training priorities",
        "Build smarter next steps",
    ]
    pill_text = "$125 / 90 minute session"

    tmp = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    pill_bb = tmp.textbbox((0, 0), pill_text, font=pill_f)
    pill_box_h = pill_bb[3] - pill_bb[1] + 48

    y = left_column_top()
    d.text((LEFT_X, y), "PONO FIT CO.", fill=MINT, font=brand)
    y += 74
    d.text((LEFT_X, y), "Fitness", fill=WHITE, font=title)
    y += 108
    d.text((LEFT_X, y), "Assessment", fill=WHITE, font=title)
    y += 116
    for tl in tag_lines:
        d.text((LEFT_X + 2, y), tl, fill="#e8eef8", font=tag)
        y += 48
    y += 22
    pill_w = pill_bb[2] - pill_bb[0] + 72
    d.rounded_rectangle([LEFT_X, y, LEFT_X + pill_w, y + pill_box_h], radius=24, fill=MINT)
    d.text((LEFT_X + 36, y + 20), pill_text, fill=DARK, font=pill_f)
    y += pill_box_h + 28
    for b in bullets:
        d.text((LEFT_X, y), f"- {b}", fill=WHITE, font=bullet_f)
        y += 54
    draw_contact_block_bottom(d, LEFT_X, SPLIT - LEFT_X, MINT)

    px, py, pw, ph = SPLIT + 20, 56, W - SPLIT - 40, H - 112
    d = draw_panel(canvas, px, py, pw, ph, "fitness")
    draw_numbered_rows(
        d,
        px,
        py,
        pw,
        ph,
        [
            "Goal Consultation",
            "Functional Movement Screen",
            "Custom Exercise Analysis",
            "VO2 Max (Optional)",
            "Customized 1-3 Month Plan",
        ],
        "Includes:",
        MINT,
        step_size=42,
    )

    out = OUT_DIR / "fitness-assessment.png"
    canvas.save(out, optimize=True)
    print(f"wrote {out}")


def load_pnf_photo() -> Image.Image:
    svg = PNF_SVG.read_text()
    m = re.search(r'href="data:image/png;base64,([^"]+)"', svg)
    if not m:
        raise SystemExit("PNF photo not found in SVG")
    data = base64.b64decode(m.group(1))
    return Image.open(__import__("io").BytesIO(data)).convert("RGB")


def render_pnf() -> None:
    canvas = make_gym_background()
    d = ImageDraw.Draw(canvas)
    draw_top_bar(d, "warm")
    d.line([(SPLIT, 64), (SPLIT, H - 64)], fill="#ffffff35", width=2)

    brand = font("ab", 40)
    title = font("g", 72)
    tag = font("gi", 44)
    bullet_f = font("ab", 46)
    price_f = font("ab", 58)

    tag_lines = ["Mobility expanding stretching", "for athletes and those who move"]
    bullets = [
        "Improve usable range of motion",
        "Open hips, shoulders, hamstrings",
        "Great after hard training blocks",
    ]
    title_lines = ["Proprioceptive", "Neuromuscular", "Facilitation"]

    book_top = contact_block_top()
    top = left_column_top()
    usable = book_top - top
    brand_h, title_line_h, tag_line_h, bullet_line_h, price_h = 80, 82, 50, 58, 64
    fixed_h = brand_h + title_line_h * len(title_lines) + tag_line_h * len(tag_lines) + bullet_line_h * len(
        bullets
    ) + price_h
    gap = max(14, (usable - fixed_h) // 5)

    y = top
    d.text((LEFT_X, y), "PONO FIT CO.", fill=GOLD, font=brand)
    y += brand_h + gap
    for line in title_lines:
        d.text((LEFT_X, y), line, fill=WHITE, font=title)
        y += title_line_h
    y += gap
    for tl in tag_lines:
        d.text((LEFT_X + 2, y), tl, fill="#f8e9d0", font=tag)
        y += tag_line_h
    y += gap
    for b in bullets:
        d.text((LEFT_X, y), f"- {b}", fill=WHITE, font=bullet_f)
        y += bullet_line_h
    y += gap
    d.text((LEFT_X, y), "$50 for a full body session", fill=WHITE, font=price_f)
    draw_contact_block_bottom(d, LEFT_X, SPLIT - LEFT_X, GOLD)

    photo = load_pnf_photo()
    card_x, card_y, card_w, card_h = SPLIT + 20, 56, W - SPLIT - 40, H - 112
    pill_h = 100
    photo_y = card_y + pill_h
    photo_h = card_h - pill_h
    photo = photo.resize((card_w, photo_h), Image.Resampling.LANCZOS)

    panel = Image.new("RGBA", (card_w, card_h), (0, 0, 0, 0))
    pd = ImageDraw.Draw(panel)
    pd.rounded_rectangle([0, 0, card_w, card_h], radius=34, outline=(255, 206, 122, 170), width=3)
    canvas.paste(panel, (card_x, card_y), panel)
    canvas.paste(photo, (card_x, photo_y))

    d = ImageDraw.Draw(canvas)
    pill_w = card_w - 40
    pill_x = card_x + 20
    pill_y = card_y + 18
    d.rounded_rectangle([pill_x, pill_y, pill_x + pill_w, pill_y + 72], radius=24, fill=GOLD)
    draw_centered_text(
        d,
        (pill_x + pill_w // 2, pill_y + 36),
        "Contract - Relax - Move Better",
        font("ab", 34),
        DARK,
    )

    out = OUT_DIR / "pnf-stretching.png"
    canvas.save(out, optimize=True)
    print(f"wrote {out}")


if __name__ == "__main__":
    render_small_group()
    render_fitness_assessment()
    render_pnf()
