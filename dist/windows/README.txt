Javavid — Windows (64-bit) prebuilt bundle
=========================================

This folder is fully self-contained. No install or compile needed.

Contents
--------
  javavid.exe    the app (embeds the web UI)
  ffmpeg.exe     static ffmpeg build (GPL) — required, must stay next to javavid.exe
  LICENSE-ffmpeg.txt   ffmpeg license

Run
---
  1. Double-click javavid.exe, or run it from a terminal:
       javavid.exe

  2. Open your browser to:
       http://127.0.0.1:8090

Notes
-----
  - Keep ffmpeg.exe in the same folder as javavid.exe.
  - To use a different port, set the PORT environment variable:
       set PORT=9000 && javavid.exe
  - Windows may show a SmartScreen warning for unsigned binaries.
    Click "More info" -> "Run anyway".
