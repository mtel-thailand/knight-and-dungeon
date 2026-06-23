#!/usr/bin/env python3
"""
make_spritesheet.py — Convert an MP4 with green screen to a spritesheet PNG.

Usage:
  python3 make_spritesheet.py <input.mp4> [options]

Options:
  --out-png PATH        Output PNG path (default: <input>_spritesheet.png)
  --frame-size N        Width/height of each frame in pixels (default: 160)
  --columns N           Number of columns in the grid (default: auto sqrt)
  --color HEX           Chroma key color in hex, no # (default: 04F108)
  --similarity F        Chroma key similarity 0.0–1.0 (default: 0.30)
  --blend F             Chroma key blend 0.0–1.0 (default: 0.05)
  --no-chroma           Skip chroma key (output plain spritesheet)
  --fps F               Override source FPS for display (default: auto-detect)
"""

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path


def probe_video(path: str) -> dict:
    result = subprocess.run(
        [
            "ffprobe", "-v", "quiet",
            "-print_format", "json",
            "-show_streams", "-show_format",
            path,
        ],
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
    return {"fps": fps, "nb_frames": nb_frames, "width": int(video["width"]), "height": int(video["height"])}


def build_vf(frame_size: int, cols: int, rows: int, chroma: bool, color: str, similarity: float, blend: float) -> str:
    filters = []
    if chroma:
        filters.append(f"chromakey=0x{color}:{similarity}:{blend}")
    filters.append(f"scale={frame_size}:{frame_size}")
    filters.append(f"tile={cols}x{rows}")
    return ",".join(filters)


def main():
    parser = argparse.ArgumentParser(description="MP4 → spritesheet PNG with optional chroma key")
    parser.add_argument("input", help="Input MP4 file")
    parser.add_argument("--out-png", help="Output PNG path")
    parser.add_argument("--frame-size", type=int, default=160, help="Frame size in px (default: 160)")
    parser.add_argument("--columns", type=int, default=0, help="Columns (default: auto)")
    parser.add_argument("--color", default="04F108", help="Green screen hex color (default: 04F108)")
    parser.add_argument("--similarity", type=float, default=0.30, help="Chroma similarity (default: 0.30)")
    parser.add_argument("--blend", type=float, default=0.05, help="Chroma blend (default: 0.05)")
    parser.add_argument("--no-chroma", action="store_true", help="Skip chroma key")
    parser.add_argument("--fps", type=float, help="Override FPS for display only")
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    if not input_path.exists():
        print(f"Error: {input_path} not found", file=sys.stderr)
        sys.exit(1)

    stem = input_path.stem
    out_png = Path(args.out_png) if args.out_png else input_path.with_name(f"{stem}_spritesheet.png")

    print(f"Probing {input_path.name}...")
    info = probe_video(str(input_path))
    fps = args.fps or info["fps"]
    nb_frames = info["nb_frames"]
    print(f"  {nb_frames} frames @ {fps:.2f}fps  ({info['width']}×{info['height']})")

    cols = args.columns if args.columns > 0 else math.ceil(math.sqrt(nb_frames))
    rows = math.ceil(nb_frames / cols)
    print(f"  Grid: {cols}×{rows}  →  {cols * args.frame_size}×{rows * args.frame_size}px")

    vf = build_vf(args.frame_size, cols, rows, not args.no_chroma, args.color, args.similarity, args.blend)

    cmd = [
        "ffmpeg", "-i", str(input_path),
        "-vf", vf,
        "-frames:v", "1", "-update", "1",
        str(out_png), "-y",
    ]
    print(f"Running ffmpeg...")
    subprocess.run(cmd, check=True, capture_output=True)
    print(f"  Saved: {out_png}")
    print(f"Done. {nb_frames} frames")


if __name__ == "__main__":
    main()
