# AGENTS.md — javavid

## What this is

Local video → GIF converter. Go single binary serving an embedded web UI; ffmpeg does the heavy lifting via `os/exec`.

## Repo map

- `main.go` — HTTP server, route registration, embedded static FS.
- `internal/ffmpeg.go` — locate ffmpeg (next to binary, then PATH).
- `internal/probe.go` — (todo) `ffmpeg -i` metadata.
- `internal/thumbs.go` — (todo) thumbnail strip + frame-at-time.
- `internal/convert.go` — (todo) convert + progress parsing.
- `static/` — vanilla HTML/CSS/JS UI (no build step).
- `bin/` — bundled ffmpeg per-OS (git-ignored).

## Commands

```bash
go build -o javavid .
go vet ./...
gofmt -w .
./javavid            # http://127.0.0.1:8090
```

## Conventions

- No comments unless they explain *why*.
- Port from `PORT` env, default `8090`, bind `127.0.0.1`.
- ffmpeg width/height must be even — normalize in code.
- Progress: parse `out_time_ms=` from ffmpeg stderr.
- Temp workspace via `os.MkdirTemp`, cleanup on shutdown.

## Spec

Full requirements live in `PLAN.md`. Read it before implementing.
