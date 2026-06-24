#!/usr/bin/env python3
"""
add_animation.py — Pipeline: MP4 → spritesheet PNG (on disk) + spritesheet row in SQLite.

Frames are kept at their native resolution by default (no downscaling); display
scaling is handled in the studio per character. Pass --frame-size N to force NxN.

Usage:
  python3 add_animation.py <input.mp4> <animation-name> [options]

  animation-name: kebab-case, e.g. "run", "death", "knight-jump"

Options:
  --label TEXT        UI display label (default: title-cased from animation-name)
  --columns N         Grid columns (default: 0 = auto, ceil(sqrt(frames)))
  --frame-size N      Force square NxN frames by scaling (default: 0 = native, no scale)
  --fps N             Resample output to N fps (default: 24; 0 = keep native fps)
  --color HEX         Chroma key hex color without # (default: 00FF00)
  --similarity F      Chroma similarity 0-1 (default: 0.30)
  --blend F           Chroma blend 0-1 (default: 0.05)
  --no-chroma         Skip chroma key
  --assets-dir PATH   Output directory for PNG (default: ./public/assets)
  --character ID      Also attach this animation to a studio character (kebab id)
  --db PATH           SQLite database to upsert into (default: data/app.db)
"""

import argparse
import json
import math
import sqlite3
import subprocess
import sys
from pathlib import Path


def probe_video(path):
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json",
         "-show_streams", "-show_format", str(path)],
        capture_output=True, text=True, check=True,
    )
    data = json.loads(result.stdout)
    video = next(s for s in data["streams"] if s["codec_type"] == "video")
    num, den = video["r_frame_rate"].split("/")
    fps = float(num) / float(den)
    nb_frames = int(video.get("nb_frames", 0))
    if nb_frames == 0:
        duration = float(video.get("duration", data["format"]["duration"]))
        nb_frames = round(duration * fps)
    return {
        "fps": fps,
        "nb_frames": nb_frames,
        "width": int(video["width"]),
        "height": int(video["height"]),
    }


def build_pixi_json(name, nb_frames, cols, frame_w, frame_h, png_filename):
    key_prefix = name.replace("-", "_")
    frames = {}
    anim_frames = []
    for i in range(nb_frames):
        key = f"{key_prefix}_{i:03d}"
        frames[key] = {
            "frame": {"x": (i % cols) * frame_w, "y": (i // cols) * frame_h,
                      "w": frame_w, "h": frame_h},
            "sourceSize": {"w": frame_w, "h": frame_h},
            "spriteSourceSize": {"x": 0, "y": 0, "w": frame_w, "h": frame_h},
            "rotated": False,
            "trimmed": False,
        }
        anim_frames.append(key)
    rows = math.ceil(nb_frames / cols)
    return {
        "frames": frames,
        "animations": {key_prefix: anim_frames},
        "meta": {
            "image": png_filename,
            "size": {"w": cols * frame_w, "h": rows * frame_h},
            "scale": 1,
        },
    }


def upsert_animation(db_path, key, label, image, pixi_json):
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS animations (
              key TEXT PRIMARY KEY,
              label TEXT NOT NULL,
              image TEXT,
              frame_data TEXT,
              derive_from TEXT,
              reverse INTEGER NOT NULL DEFAULT 0,
              sort_order INTEGER NOT NULL DEFAULT 0
            );
            """
        )
        row = conn.execute(
            "SELECT sort_order FROM animations WHERE key = ?", (key,)
        ).fetchone()
        if row is None:
            sort_order = conn.execute(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM animations"
            ).fetchone()[0]
        else:
            sort_order = row[0]
        conn.execute(
            """
            INSERT INTO animations (key, label, image, frame_data, derive_from, reverse, sort_order)
            VALUES (?, ?, ?, ?, NULL, 0, ?)
            ON CONFLICT(key) DO UPDATE SET label=excluded.label, image=excluded.image, frame_data=excluded.frame_data;
            """,
            (key, label, image, json.dumps(pixi_json), sort_order),
        )
        conn.commit()
    finally:
        conn.close()


def upsert_character_animation(db_path, character_id, animation_key, duration):
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS character_animations (
              character_id TEXT NOT NULL,
              animation_key TEXT NOT NULL,
              duration REAL,
              loop INTEGER NOT NULL DEFAULT 1,
              sort_order INTEGER NOT NULL DEFAULT 0,
              PRIMARY KEY (character_id, animation_key)
            );
            """
        )
        row = conn.execute(
            "SELECT sort_order FROM character_animations WHERE character_id = ? AND animation_key = ?",
            (character_id, animation_key),
        ).fetchone()
        if row is None:
            sort_order = conn.execute(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM character_animations WHERE character_id = ?",
                (character_id,),
            ).fetchone()[0]
        else:
            sort_order = row[0]
        conn.execute(
            """
            INSERT INTO character_animations (character_id, animation_key, duration, loop, sort_order)
            VALUES (?, ?, ?, 1, ?)
            ON CONFLICT(character_id, animation_key) DO UPDATE SET duration=excluded.duration;
            """,
            (character_id, animation_key, duration, sort_order),
        )
        conn.commit()
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description="MP4 -> spritesheet PNG + spritesheet row in SQLite")
    parser.add_argument("input", help="Input MP4 file")
    parser.add_argument("name", help="Animation name in kebab-case (e.g. 'run', 'knight-jump')")
    parser.add_argument("--label", help="UI display label (default: title-cased name)")
    parser.add_argument("--columns", type=int, default=0, help="Grid columns (default: 0 = auto sqrt)")
    parser.add_argument("--frame-size", type=int, default=0, help="Force square NxN by scaling (default: 0 = native)")
    parser.add_argument("--fps", type=float, default=24.0, help="Resample output to N fps (default: 24; 0 = keep native fps)")
    parser.add_argument("--color", default="00FF00", help="Chroma key hex color (default: 00FF00)")
    parser.add_argument("--similarity", type=float, default=0.30, help="Chroma similarity (default: 0.30)")
    parser.add_argument("--blend", type=float, default=0.05, help="Chroma blend (default: 0.05)")
    parser.add_argument("--no-chroma", action="store_true", help="Skip chroma key")
    parser.add_argument("--assets-dir", default="./public/assets", help="Output directory for PNG (default: ./public/assets)")
    parser.add_argument("--character", help="Also attach this animation to a studio character (kebab id)")
    parser.add_argument("--db", default="data/app.db", help="SQLite database (default: data/app.db)")
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    if not input_path.exists():
        print(f"Error: {input_path} not found", file=sys.stderr)
        sys.exit(1)

    name = args.name
    label = args.label or " ".join(p.title() for p in name.split("-"))
    assets_dir = Path(args.assets_dir)
    assets_dir.mkdir(parents=True, exist_ok=True)

    png_filename = f"{name}-spritesheet.png"
    out_png = assets_dir / png_filename

    # 1. Probe
    print(f"[1/3] Probing {input_path.name}...")
    info = probe_video(input_path)
    src_fps = info["fps"]
    src_frames = info["nb_frames"]

    # Resample to a target fps (default 24) so sheets play at a known rate.
    # --fps 0 keeps the source frame rate (and frame count) untouched.
    if args.fps and args.fps > 0 and src_fps:
        target_fps = args.fps
        duration = src_frames / src_fps
        nb_frames = max(1, round(duration * target_fps))
    else:
        target_fps = src_fps
        nb_frames = src_frames

    # Keep native frame size unless --frame-size forces a square downscale.
    if args.frame_size > 0:
        frame_w = frame_h = args.frame_size
    else:
        frame_w, frame_h = info["width"], info["height"]

    # Auto column count keeps native-res sheets roughly square (avoids a single
    # very tall strip that can exceed the GPU max texture size).
    cols = args.columns if args.columns > 0 else math.ceil(math.sqrt(nb_frames))
    rows = math.ceil(nb_frames / cols)
    print(f"      {nb_frames} frames @ {target_fps:.2f} fps  (source {src_frames}f @ {src_fps:.2f} fps, {info['width']}x{info['height']})")
    print(f"      Grid: {cols}x{rows} -> {cols * frame_w}x{rows * frame_h}px (frame {frame_w}x{frame_h})")

    # 2. Build PNG spritesheet
    print(f"[2/3] Building spritesheet PNG...")
    filters = []
    if not args.no_chroma:
        filters.append(f"chromakey=0x{args.color}:{args.similarity}:{args.blend}")
    if args.frame_size > 0:
        filters.append(f"scale={frame_w}:{frame_h}")
    if args.fps and args.fps > 0:
        filters.append(f"fps={target_fps}")
    filters.append(f"tile={cols}x{rows}")

    subprocess.run(
        ["ffmpeg", "-i", str(input_path), "-vf", ",".join(filters),
         "-frames:v", "1", "-update", "1", str(out_png), "-y"],
        check=True, capture_output=True,
    )
    print(f"      Saved: {out_png}")

    # 3. Build PixiJS JSON in memory and upsert into SQLite
    print(f"[3/3] Inserting spritesheet into SQLite...")
    pixi = build_pixi_json(name, nb_frames, cols, frame_w, frame_h, png_filename)
    db_path = Path(args.db)
    upsert_animation(db_path, name, label, png_filename, pixi)
    print(f"      Inserted into SQLite ({db_path})")

    if args.character:
        duration = round(nb_frames / target_fps, 6) if target_fps else None
        upsert_character_animation(db_path, args.character, name, duration)
        print(f"      Attached to character '{args.character}' (duration {duration}s)")

    print(f"\nDone. '{label}' is ready to preview.")
    print(f"  PNG: {out_png}")
    print(f"  DB:  {db_path} (key: {name})")


if __name__ == "__main__":
    main()
