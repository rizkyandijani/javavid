package internal

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// Prefer a bundled binary next to the executable so tested builds win over PATH.
func FindFFmpeg() (string, error) {
	candidates := []string{"ffmpeg"}
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		if runtime.GOOS == "windows" {
			candidates = append([]string{filepath.Join(dir, "ffmpeg.exe")}, candidates...)
		} else {
			candidates = append([]string{filepath.Join(dir, "ffmpeg")}, candidates...)
		}
	}
	for _, c := range candidates {
		if p, err := exec.LookPath(c); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("ffmpeg not found: place a static ffmpeg binary next to javavid or on PATH")
}
