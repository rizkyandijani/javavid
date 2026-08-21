package internal

import (
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
)

func Thumbnails(videoPath, outDir string, duration float64) ([]string, error) {
	bin, err := FindFFmpeg()
	if err != nil {
		return nil, err
	}
	if duration <= 0 {
		return nil, errors.New("duration must be positive")
	}
	interval := duration / 25.0
	if interval < 0.05 {
		interval = 0.05
	}
	pattern := filepath.Join(outDir, "thumb_%03d.jpg")

	cmd := exec.Command(bin,
		"-hide_banner", "-y",
		"-i", videoPath,
		"-vf", fmt.Sprintf("fps=1/%g,scale=160:-1", interval),
		"-frames:v", "30",
		"-q:v", "5",
		pattern,
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("thumbnail strip failed: %w: %s", err, string(out))
	}

	matches, err := filepath.Glob(filepath.Join(outDir, "thumb_*.jpg"))
	if err != nil {
		return nil, err
	}
	return matches, nil
}

func Frame(videoPath, outPath string, t float64) error {
	bin, err := FindFFmpeg()
	if err != nil {
		return err
	}
	cmd := exec.Command(bin,
		"-hide_banner", "-y",
		"-ss", fmt.Sprintf("%g", t),
		"-i", videoPath,
		"-frames:v", "1",
		"-vf", "scale=320:-1",
		"-q:v", "4",
		outPath,
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("frame extract failed: %w: %s", err, string(out))
	}
	return nil
}
