package internal

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
)

var (
	timeMSRE = regexp.MustCompile(`out_time_ms=(\d+)`)
	timeRE   = regexp.MustCompile(`out_time=(\d+):(\d+):(\d+(?:\.\d+)?)`)
)

type ConvertOptions struct {
	VideoPath  string
	Start      float64
	End        float64
	FPS        float64
	Width      int
	Height     int
	Mode       string
	Dither     bool
	Loop       int
	Output     string
	OnProgress func(percent float64)
}

func NormalizeDim(n int) int {
	if n < 1 {
		return 0
	}
	if n%2 != 0 {
		return n - 1
	}
	return n
}

func Convert(opts ConvertOptions) error {
	if opts.VideoPath == "" {
		return errors.New("video path required")
	}
	if opts.End <= opts.Start {
		return errors.New("end must be greater than start")
	}
	if opts.FPS <= 0 {
		opts.FPS = 10
	}
	if opts.Loop < 0 {
		opts.Loop = 0
	}
	w, h := NormalizeDim(opts.Width), NormalizeDim(opts.Height)
	if w == 0 || h == 0 {
		return errors.New("width and height must be positive")
	}
	dur := opts.End - opts.Start
	mode := opts.Mode
	if mode != "fast" && mode != "high" {
		mode = "high"
	}
	dither := "bayer:bayer_scale=5"
	if opts.Dither {
		dither = "sierra2_4a"
	}

	out := opts.Output
	if out == "" {
		return errors.New("output path required")
	}
	if dir := filepath.Dir(out); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	loopStr := strconv.Itoa(opts.Loop)

	if mode == "high" {
		palette := out + ".palette.png"
		pass1 := buildArgs(opts.VideoPath, "", opts.Start, dur, w, h,
			fmt.Sprintf("fps=%g,scale=%d:%d:flags=lanczos,palettegen", opts.FPS, w, h),
			loopStr, palette)
		if err := runFFmpeg(pass1, nil); err != nil {
			return err
		}

		filter := fmt.Sprintf("[0:v]fps=%g,scale=%d:%d:flags=lanczos[x];[x][1:v]paletteuse=dither=%s", opts.FPS, w, h, dither)
		pass2 := buildArgs(opts.VideoPath, palette, opts.Start, dur, w, h, filter, loopStr, out)
		return runFFmpeg(pass2, opts.OnProgress)
	}

	filter := fmt.Sprintf("fps=%g,scale=%d:%d", opts.FPS, w, h)
	args := buildArgs(opts.VideoPath, "", opts.Start, dur, w, h, filter, loopStr, out)
	return runFFmpeg(args, opts.OnProgress)
}

func buildArgs(video, secondInput string, start, dur float64, w, h int, filter, loop, out string) []string {
	args := []string{
		"-hide_banner", "-y",
		"-nostdin",
		"-progress", "pipe:1",
		"-ss", strconv.FormatFloat(start, 'f', -1, 64),
		"-t", strconv.FormatFloat(dur, 'f', -1, 64),
		"-i", video,
	}
	if secondInput != "" {
		args = append(args, "-i", secondInput)
		if filter != "" {
			args = append(args, "-filter_complex", filter)
		}
	} else if filter != "" {
		args = append(args, "-vf", filter)
	}
	args = append(args, "-loop", loop, "-y", out)
	return args
}

func runFFmpeg(args []string, progress func(float64)) error {
	bin, err := FindFFmpeg()
	if err != nil {
		return err
	}
	cmd := exec.Command(bin, args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return err
	}
	dur := parseDurFromArgs(args)
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		if progress == nil {
			continue
		}
		if pct := parseProgress(line, dur); pct >= 0 {
			progress(pct)
		}
	}
	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("ffmpeg: %w: %s", err, stderr.String())
	}
	return nil
}

func parseDurFromArgs(args []string) float64 {
	for i, a := range args {
		if a == "-t" && i+1 < len(args) {
			f, _ := strconv.ParseFloat(args[i+1], 64)
			return f
		}
	}
	return 0
}

func parseProgress(line string, dur float64) float64 {
	if m := timeMSRE.FindStringSubmatch(line); m != nil {
		ms, _ := strconv.ParseInt(m[1], 10, 64)
		secs := float64(ms) / 1_000_000.0
		return pct(secs, dur)
	}
	if m := timeRE.FindStringSubmatch(line); m != nil {
		h, _ := strconv.ParseFloat(m[1], 64)
		mi, _ := strconv.ParseFloat(m[2], 64)
		s, _ := strconv.ParseFloat(m[3], 64)
		secs := h*3600 + mi*60 + s
		return pct(secs, dur)
	}
	return -1
}

func pct(elapsed, dur float64) float64 {
	if dur <= 0 {
		return 0
	}
	v := elapsed / dur * 100
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return v
}
