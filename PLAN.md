# Javavid — Implementation Plan

Local, lightweight, fast **video → GIF** converter. Single Go binary + browser UI + bundled ffmpeg.

## Decisions (locked)

- **Runtime:** Go single binary (no runtime deps, embeds UI via `embed`).
- **ffmpeg:** bundled static binary (next to the executable), with PATH fallback.
- **Output:** browser download **and** save-to-folder (native folder picker in UI).
- **Frontend:** vanilla HTML/CSS/JS, no build step.

## Architecture

```
javavid (Go binary)
├── embeds static/ (UI)
└── shells out to ffmpeg via os/exec
```

ffmpeg discovery order (`internal/ffmpeg.go`): same dir as binary → PATH → error with instructions.

## Backend endpoints

| Route | Method | Purpose |
|---|---|---|
| `/api/health` | GET | `{status, ffmpeg, hasFfmpeg}` |
| `/api/upload` | POST | save video to temp workspace, probe, return `{id, duration, width, height, fps, codec}` |
| `/api/probe?id=` | GET | metadata for a stored video |
| `/api/thumbnails?id=` | GET | low-res JPEG strip across timeline for the slider |
| `/api/frame?id=&t=` | GET | single frame at time `t` (scrub preview) |
| `/api/convert` | POST | `{id, start, end, fps, width, height, mode, dither, loop, saveToFolder}` → ffmpeg, stream progress |
| `/api/result/:file` | GET | download finished GIF |
| `/api/save-path` | POST | resolve a user-chosen folder for "save to folder" |

Workspace: temp dir under the OS temp (e.g. `os.MkdirTemp`), keyed by `id`. Clean up on exit.

## ffmpeg commands

```bash
# Probe
ffmpeg -hide_banner -i input

# Thumbnail strip (interval chosen so ~20-30 frames)
ffmpeg -i input -vf "fps=1/<interval>,scale=160:-1" -frames:v 30 thumbs_%03d.jpg

# Single frame at t
ffmpeg -ss <t> -i input -frames:v 1 -vf "scale=320:-1" frame.jpg

# High-quality (two-pass palette)
ffmpeg -ss START -t DUR -i in -vf "fps=FPS,scale=W:H:flags=lanczos,palettegen" -y palette.png
ffmpeg -ss START -t DUR -i in -i palette.png \
  -filter_complex "fps=FPS,scale=W:H:flags=lanczos[x];[x][1:v]paletteuse=dither=<mode>" \
  -loop <loop> -y out.gif

# Fast (single-pass, built-in palette)
ffmpeg -ss START -t DUR -i in -vf "fps=FPS,scale=W:H" -loop <loop> -y out.gif
```

Notes:
- `W`/`H` must be **even numbers** (normalize odd → round down).
- `-loop 0` = infinite; `-loop N` = play N times.
- Progress: parse `out_time=` / `out_time_ms=` from stderr to report percent.
- `-ss` before `-i` (fast seek); `-t DUR = end - start`.

## Frontend controls

- File picker + drag-drop → `<video>` preview
- Dual-handle timeline slider over a thumbnail strip; scrub shows live frame
- **FPS**: presets 10/15/20/24/30 + custom
- **Resolution**: presets original/1080p/720p/480p + custom W×H with aspect-lock
- **Quality mode**: Fast (single-pass) vs High (two-pass palette)
- **Dithering**: toggle (only applies in High mode)
- **Loop**: infinite / N times
- Convert → progress bar → GIF preview + **Download** + **Save to folder…**
- Error states: missing ffmpeg, invalid input, empty selection

## File layout

```
javavid/
├── main.go              # server + routes
├── go.mod
├── internal/
│   ├── ffmpeg.go        # locate ffmpeg (done)
│   ├── probe.go         # metadata
│   ├── thumbs.go        # thumbnail strip + frame
│   └── convert.go       # convert + progress
├── static/
│   ├── index.html
│   ├── app.js
│   └── style.css
├── bin/                 # bundled ffmpeg per-OS (git-ignored)
├── PLAN.md
├── README.md
└── AGENTS.md
```

## Milestones (build order)

1. Go skeleton: serve UI, upload + probe
2. Thumbnail strip + frame-at-time
3. UI: picker, video preview, timeline slider + thumbnails
4. Convert endpoint (both modes) with progress streaming
5. Quality controls + save-to-folder
6. Result preview/download + error handling
7. Packaging: `go build` + bundled ffmpeg per OS

## Test plan

- Short MP4: metadata, thumbnails, frame extraction
- Default convert → verify size/fps/dims
- High vs Fast mode comparison
- Edge cases: non-square aspect, sub-second clip, missing ffmpeg, odd dimensions

## Build & run

```bash
cd /opt/projects/javavid
go build -o javavid .
./javavid            # opens http://127.0.0.1:8090
```
