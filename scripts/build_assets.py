#!/usr/bin/env python3
"""
Clean Asset Pipeline: Downloads ONLY real, official character renders & illustrations.
Crops any product packaging/keychain loops, removes uniform backgrounds via corner color
flood-fill, and saves clean transparent character PNGs.
"""

import io
import os
import shutil
import requests
import numpy as np
from scipy import ndimage
from PIL import Image, ImageFilter

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THEMES_DIR = os.path.join(BASE_DIR, "public", "assets", "themes")

HEADERS = {"User-Agent": "Mozilla/5.0"}

# (filename, url, optional_crop_box_normalized (x0, y0, x1, y1))
REAL_ASSETS = {
    "spongebob": [
        ("spongebob-patrick-hug.png", "https://static.wikia.nocookie.net/spongebob/images/a/a8/SpongeBob_and_Patrick_stock_art.png", None),
        ("spongebob-happy.png", "https://static.wikia.nocookie.net/spongebob/images/a/a0/SpongeBob_Stock_art_3.png.png", None),
        ("spongebob-classic.png", "https://static.wikia.nocookie.net/spongebob/images/8/89/SpongeBob_stock_art_2.png", None),
        ("patrick-happy.png", "https://static.wikia.nocookie.net/spongebob/images/7/7e/Patrick_Star.png", None),
        ("patrick-grin.png", "https://static.wikia.nocookie.net/spongebob/images/6/6b/Patrick_grinning_stock_art.png", None),
        ("gary-snail.png", "https://static.wikia.nocookie.net/spongebob/images/6/6b/SpongeBob_SquarePants_Gary_the_Snail_Transparent_PNG-2D.png", None),
        ("imagination.png", "https://static.wikia.nocookie.net/spongebob/images/6/69/Imagination.png.png", None),
        ("goofy-goober.png", "https://static.wikia.nocookie.net/spongebob/images/6/68/Jellyfish_stock_art_1.png", None),
    ],
    "bighero6": [
        ("baymax-wave.png", "https://static.wikia.nocookie.net/disney/images/0/05/Baymax_Render.png", None),
        ("baymax-tsum.png", "https://static.wikia.nocookie.net/disney/images/1/19/Baymax_Tsum_Tsum_Game.png", None),
        ("mochi-cat.png", "https://static.wikia.nocookie.net/disney/images/3/31/DSS-Mochi.png", None),
        ("baymax-mochi.png", "https://static.wikia.nocookie.net/disney/images/c/cb/Fun52259-big-hero-six-baymax-with-mochi-6-inch-super-sized-pop-vinyl-figure-popcultcha-03.png", (0.51, 0.0, 1.0, 1.0)),
        ("baymax-chip.png", "https://static.wikia.nocookie.net/disney/images/e/e5/Disney_Emoji_Blitz_-_Item_Emoji_-_Baymax_Chip.png", None),
        ("hiro-baymax.png", "https://static.wikia.nocookie.net/disney/images/e/ea/DSS_Hiro_%26_Baymax.png", None),
    ],
    "sanrio": [
        ("melody-kuromi-duo.png", "https://static.wikia.nocookie.net/hellokitty/images/7/7e/My_Melody_and_Kuromi_50th-20th_anniversary_art.png", None),
        ("kuromi-main.png", "https://static.wikia.nocookie.net/hellokitty/images/4/4d/Kuromi.png.png.png", None),
        ("kuromi-wink.png", "https://static.wikia.nocookie.net/hellokitty/images/2/2d/Sanrio_Characters_Kuromi_Image001.png", (0.05, 0.04, 0.95, 0.78)),
        ("kuromi-sit.png", "https://static.wikia.nocookie.net/hellokitty/images/a/a6/Sanrio_Characters_Kuromi_Image010.png", None),
        ("mymelody-main.png", "https://static.wikia.nocookie.net/hellokitty/images/8/88/My_Melody_Sanrio_9.png", None),
        ("mymelody-sweet.png", "https://static.wikia.nocookie.net/hellokitty/images/f/f7/Sanrio_Characters_My_Melody_Image010.png", None),
        ("mymelody-friends.png", "https://static.wikia.nocookie.net/hellokitty/images/b/bb/Sanrio_Characters_My_Melody--Mama_%28My_Melody%29--My_Sweet_Piano--Flat_Image001.png", None),
        ("mysweetpiano.png", "https://static.wikia.nocookie.net/hellokitty/images/5/54/Sanrio_Characters_My_Sweet_Piano_Image001.png", None),
        ("cinnamoroll.png", "https://static.wikia.nocookie.net/hellokitty/images/9/95/Cinnamoroll_Sanrio.png", None),
        ("pompompurin.png", "https://static.wikia.nocookie.net/hellokitty/images/8/81/Pompompurin.png", None),
    ],
    "mofusand-shark": [
        ("shark-plush-duo.png", "https://mofusand-mofumofu-market.jp/cdn/shop/files/4571609409663_1.jpg", None),
        ("shark-surf-badge.png", "https://mofusand-mofumofu-market.jp/cdn/shop/files/4571609402329_1.jpg", None),
        ("shark-best-waves.png", "https://mofusand-mofumofu-market.jp/cdn/shop/files/4571609402343_1.jpg", None),
        ("shark-surf-duo.png", "https://mofusand-mofumofu-market.jp/cdn/shop/files/4571609402381_1.jpg", None),
        ("dolphin-nyan.png", "https://mofusand-mofumofu-market.jp/cdn/shop/files/4571609407089_1.jpg", (0.0, 0.27, 1.0, 1.0)),
        ("otter-nyan.png", "https://mofusand-mofumofu-market.jp/cdn/shop/files/4571609407096_1.jpg", (0.0, 0.27, 1.0, 1.0)),
    ],
    "mofusand-berry": [
        ("strawberry-red-cat.png", "https://mofusand-mofumofu-market.jp/cdn/shop/files/4571609395294_1_8e7445d3-c240-4c66-9201-0bdc3fa5e92c.jpg", None),
        ("strawberry-pink-basket.png", "https://mofusand-mofumofu-market.jp/cdn/shop/files/4571609396666_1_649985c7-1586-4c34-b5a0-d09c4a16e2d2.jpg", None),
        ("strawberry-calico.png", "https://mofusand-mofumofu-market.jp/cdn/shop/files/4571609396642_1_c4471495-7ce4-42a7-8aa2-55154be0b124.jpg", (0.0, 0.34, 1.0, 1.0)),
        ("strawberry-ginger.png", "https://mofusand-mofumofu-market.jp/cdn/shop/files/4571609395263_1_0b95f8be-157b-4557-bf81-33e05d016200.jpg", (0.0, 0.34, 1.0, 1.0)),
        ("sanrio-kitty-nyan.png", "https://mofusand-mofumofu-market.jp/cdn/shop/files/4571609394938.jpg", None),
        ("sanrio-pochacco-nyan.png", "https://mofusand-mofumofu-market.jp/cdn/shop/files/4571609394945.jpg", None),
    ],
}


def clean_and_extract_character(img: Image.Image, crop_norm=None, max_size: int = 500) -> Image.Image:
    img = img.convert("RGBA")
    if crop_norm:
        w0, h0 = img.size
        img = img.crop((
            int(crop_norm[0] * w0),
            int(crop_norm[1] * h0),
            int(crop_norm[2] * w0),
            int(crop_norm[3] * h0),
        ))

    arr = np.array(img)
    r, g, b, a = arr[:, :, 0].astype(np.float32), arr[:, :, 1].astype(np.float32), arr[:, :, 2].astype(np.float32), arr[:, :, 3]

    h, w = a.shape
    corner_alpha = np.mean([a[0, 0], a[0, w - 1], a[h - 1, 0], a[h - 1, w - 1]])
    if corner_alpha > 200:
        # Sample corner RGB to support removing white OR solid pastel background
        bg_r, bg_g, bg_b = r[2, 2], g[2, 2], b[2, 2]
        color_dist = np.sqrt((r - bg_r) ** 2 + (g - bg_g) ** 2 + (b - bg_b) ** 2)
        is_bg_color = color_dist < 28.0
        labeled, _ = ndimage.label(is_bg_color)
        border_labels = set(
            np.concatenate([labeled[0, :], labeled[h - 1, :], labeled[:, 0], labeled[:, w - 1]])
        )
        border_labels.discard(0)
        bg_mask = np.isin(labeled, list(border_labels))

        # Keep main central foreground components
        fg_mask = ~bg_mask
        fg_labeled, num_fg = ndimage.label(fg_mask)
        if num_fg > 1:
            counts = np.bincount(fg_labeled.ravel())
            counts[0] = 0
            largest_label = np.argmax(counts)
            keep_labels = np.where(counts >= counts[largest_label] * 0.12)[0]
            fg_mask = np.isin(fg_labeled, keep_labels)
            bg_mask = ~fg_mask

        dist_from_bg = ndimage.distance_transform_edt(~bg_mask)
        new_alpha = np.clip((dist_from_bg - 0.4) * 200, 0, 255).astype(np.uint8)
        arr[:, :, 3] = np.minimum(a, new_alpha)
        img = Image.fromarray(arr, "RGBA")

    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)

    w, h = img.size
    if w == 0 or h == 0:
        return img

    scale = min(max_size / w, max_size / h)
    new_w, new_h = max(1, int(w * scale)), max(1, int(h * scale))
    img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)

    border_px = 7
    pad = border_px + 10
    cw, ch = new_w + pad * 2, new_h + pad * 2
    canvas = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    canvas.paste(img, (pad, pad), img)

    arr = np.array(canvas)
    alpha = arr[:, :, 3] > 25
    dist = ndimage.distance_transform_edt(~alpha)

    border_alpha = np.clip((border_px - dist + 1.0) * 190, 0, 255).astype(np.uint8)
    border_layer = np.zeros_like(arr)
    border_layer[:, :, 0] = 255
    border_layer[:, :, 1] = 255
    border_layer[:, :, 2] = 255
    border_layer[:, :, 3] = border_alpha

    shadow_alpha = np.clip((border_px + 3 - dist) * 18, 0, 42).astype(np.uint8)
    sh_arr = np.zeros_like(arr)
    sh_arr[:, :, 3] = shadow_alpha
    shadow_pil = Image.fromarray(sh_arr, "RGBA").filter(ImageFilter.GaussianBlur(3))

    out = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    out.paste(shadow_pil, (0, 3), shadow_pil)
    out = Image.alpha_composite(out, Image.fromarray(border_layer, "RGBA"))
    out = Image.alpha_composite(out, canvas)

    bbox = out.getbbox()
    if bbox:
        out = out.crop(bbox)
    return out


def main():
    if os.path.exists(THEMES_DIR):
        shutil.rmtree(THEMES_DIR)

    for theme, items in REAL_ASSETS.items():
        t_dir = os.path.join(THEMES_DIR, theme)
        os.makedirs(t_dir, exist_ok=True)
        print(f"=== Processing [{theme}] ===")
        for filename, url, crop_norm in items:
            hdrs = dict(HEADERS)
            if "/spongebob/" in url:
                hdrs["Referer"] = "https://spongebob.fandom.com/"
            elif "/disney/" in url:
                hdrs["Referer"] = "https://disney.fandom.com/"
            elif "/hellokitty/" in url:
                hdrs["Referer"] = "https://hellokitty.fandom.com/"
            try:
                r = requests.get(url, headers=hdrs, timeout=15)
                r.raise_for_status()
                im = Image.open(io.BytesIO(r.content))
                processed = clean_and_extract_character(im, crop_norm=crop_norm)
                dest = os.path.join(t_dir, filename)
                processed.save(dest, "PNG")
                print(f"  [OK] {theme}/{filename} ({processed.size[0]}x{processed.size[1]})")
            except Exception as e:
                print(f"  [ERR] {theme}/{filename}: {e}")


if __name__ == "__main__":
    main()
