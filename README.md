# Javavid

Local, lightweight video → GIF converter. Single Go binary + browser UI + ffmpeg.

Convert a chosen segment of a video to a GIF with an interactive timeline for start/end seconds, plus FPS, resolution, width/height, and quality controls.

## Run

```bash
cd /opt/projects/javavid
go build -o javavid .
./javavid            # opens http://127.0.0.1:8090
```

## Dependencies

- Go 1.22+
- ffmpeg (static binary next to `javavid`, or on PATH)

## Status

Implemented. See `PLAN.md` for the full spec.
