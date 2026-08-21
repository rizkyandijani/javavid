package internal

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// FindFFmpeg locates the ffmpeg binary. It checks, in order:
//  1. next to the current executable (bundled static build),
//  2. on PATH.
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
