# Javavid

Local, lightweight video → GIF converter. Single Go binary + browser UI + ffmpeg.

Convert a chosen segment of a video to a GIF with an interactive timeline for start/end seconds, plus FPS, resolution, width/height, and quality controls.

## Run

```bash
cd /opt/projects/javavid
go build -o javavid .
./javavid            # opens http://127.0.0.1:8090
```

## Prebuilt binaries

Windows 64-bit bundle (no Go or ffmpeg install needed):

```
dist/windows/
├── javavid.exe        # the app (UI embedded)
├── ffmpeg.exe         # static ffmpeg — must stay next to javavid.exe
└── LICENSE-ffmpeg.txt
```

Download `dist/windows/`, double-click `javavid.exe`, open http://127.0.0.1:8090.

## Build from source

```bash
go build -o javavid .
./javavid            # opens http://127.0.0.1:8090
```

## Dependencies (source builds)

- Go 1.22+
- ffmpeg (static binary next to `javavid`, or on PATH)

## Status

Implemented. See `PLAN.md` for the full spec.
