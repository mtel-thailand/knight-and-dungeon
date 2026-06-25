#!/usr/bin/env python3
"""
add_animation.py — Pipeline: MP4 → spritesheet PNG + PixiJS frame JSON (stdout).

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

Output:
  - Spritesheet PNG saved to <assets-dir>/<key>-spritesheet.png
  - PixiJS frame JSON printed to stdout
"""

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path


def probe_video(path: Path):
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", str(path)],
        check=True, capture_output=True, text=True,
    )
    data = json.loads(result.stdout)
    video = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    if not video:
        raise ValueError("no video stream found")
    num, den = (video.get("r_frame_rate", "0/1") or "0/1").split("/")
    fps = float(num) / float(den)
    nb_frames = int(video.get("nb_frames", 0))
    if not nb_frames:
        duration = float(video.get("duration", data.get("format", {}).get("duration", 0)))
        nb_frames = round(duration * fps)
    return {
        "fps": fps,
        "nb_frames": nb_frames,
        "width": int(video.get("width", 0)),
        "height": int(video.get("height", 0)),
    }


def build_pixi_json(key_prefix, nb_frames, cols, frame_w, frame_h, png_filename):
    frames = {}
    anim_frames = []
    for i in range(nb_frames):
        fname = f"{key_prefix}_{i:03d}"
        frames[fname] = {
            "frame": {
                "x": (i % cols) * frame_w,
                "y": (i // cols) * frame_h,
                "w": frame_w,
                "h": frame_h,
            },
            "sourceSize": {"w": frame_w, "h": frame_h},
            "spriteSourceSize": {"x": 0, "y": 0, "w": frame_w, "h": frame_h},
            "rotated": False,
            "trimmed": False,
        }
        anim_frames.append(fname)
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


def slugify(s: str) -> str:
    return s.lower().replace("_", "-").replace(" ", "-")


def main():
    parser = argparse.ArgumentParser(description="MP4 -> spritesheet PNG + PixiJS frame JSON (stdout)")
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
    args = parser.parse_args()
    
    input_path = Path(args.input).resolve()
    if not input_path.exists():
        parser.error(f"input file not found: {input_path}")

    name = slugify(args.name)
    label = args.label or " ".join(w.capitalize() for w in args.name.replace("-", " ").split())
    png_filename = f"{name}-spritesheet.png"
    assets_dir = Path(args.assets_dir).resolve()
    out_png = assets_dir / png_filename

    # 1. Probe
    print(f"  Input: {input_path}", file=sys.stderr)
    info = probe_video(input_path)
    nb_frames = info["nb_frames"]
    src_fps = info["fps"]
    target_fps = args.fps if args.fps and args.fps > 0 else src_fps

    if args.frame_size > 0:
        frame_w = frame_h = args.frame_size
    else:
        frame_w, frame_h = info["width"], info["height"]

    cols = args.columns if args.columns > 0 else math.ceil(math.sqrt(nb_frames))
    rows = math.ceil(nb_frames / cols)
    print(f"      {nb_frames} frames @ {target_fps:.2f} fps  (source {src_fps:.2f} fps, {info['width']}x{info['height']})", file=sys.stderr)
    print(f"      Grid: {cols}x{rows} -> {cols * frame_w}x{rows * frame_h}px (frame {frame_w}x{frame_h})", file=sys.stderr)

    # 2. Build PNG spritesheet
    print(f"[2/3] Building spritesheet PNG...", file=sys.stderr)
    filters = []
    if not args.no_chroma:
        filters.append(f"chromakey=0x{args.color}:{args.similarity}:{args.blend}")
    if args.frame_size > 0:
        filters.append(f"scale={frame_w}:{frame_h}")
    if args.fps and args.fps > 0:
        filters.append(f"fps={target_fps}")
    filters.append(f"tile={cols}x{rows}")

    assets_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-i", str(input_path), "-vf", ",".join(filters),
         "-frames:v", "1", "-update", "1", str(out_png), "-y"],
        check=True, capture_output=True,
    )
    print(f"      Saved: {out_png}", file=sys.stderr)

    # 3. Build PixiJS JSON and print to stdout
    print(f"[3/3] Generating frame JSON...", file=sys.stderr)
    pixi = build_pixi_json(name, nb_frames, cols, frame_w, frame_h, png_filename)
    print(f"      JSON written to stdout", file=sys.stderr)

    # Output the JSON to stdout for piping / capture
    print(json.dumps(pixi))

    if args.character:
        print(f"      Attach to character '{args.character}' via studio API", file=sys.stderr)
        duration = round(nb_frames / target_fps, 6) if target_fps else None
        print(f"      Suggested duration: {duration}s", file=sys.stderr)
        print(f"      -- upload via POST /api/animation or POST /api/spell/animation", file=sys.stderr)


if __name__ == "__main__":
    main()
