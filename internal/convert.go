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
	Crop       *CropBox
	Fit        string
	Output     string
	OnProgress func(percent float64)
}

// CropBox is a source-pixel rectangle. X/Y is the top-left corner.
type CropBox struct {
	X, Y, W, H int
}

const (
	FitFill  = "fill"
	FitBlack = "fit-black"
	FitBlur  = "fit-blur"
)

func normFit(fit string) string {
	switch fit {
	case FitBlack, FitBlur:
		return fit
	default:
		return FitFill
	}
}

// outputChain builds the video filter body shared by Convert and ProbeSample.
// crop is applied first at source resolution, then scaled to W×H.
// fit decides what happens when shapes differ: fill scales to cover (the
// historical behavior, may trim edges), fit-black letterboxes on black,
// fit-blur composites the fit frame over a blurred fill. Blur needs
// -filter_complex, hence the complex return.
func outputChain(fps float64, crop *CropBox, fit string, w, h int, lanczos bool) (string, bool) {
	flags := ""
	if lanczos {
		flags = ":flags=lanczos"
	}
	base := fmt.Sprintf("fps=%g", fps)
	if crop != nil {
		base += fmt.Sprintf(",crop=%d:%d:%d:%d", crop.W, crop.H, crop.X, crop.Y)
	}
	switch normFit(fit) {
	case FitBlur:
		return base + fmt.Sprintf(",split[a][b];"+
			"[a]scale=%d:%d%s:force_original_aspect_ratio=increase,crop=%d:%d,gblur=sigma=20[bg];"+
			"[b]scale=%d:%d%s:force_original_aspect_ratio=decrease[fg];"+
			"[bg][fg]overlay=(W-w)/2:(H-h)/2", w, h, flags, w, h, w, h, flags), true
	case FitBlack:
		return base + fmt.Sprintf(",scale=%d:%d%s:force_original_aspect_ratio=decrease,"+
			"pad=%d:%d:(ow-iw)/2:(oh-ih)/2", w, h, flags, w, h), false
	default:
		return base + fmt.Sprintf(",scale=%d:%d%s", w, h, flags), false
	}
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
	ditherAlgo := ditherAlgo(opts.Dither)

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

	crop := opts.Crop
	if crop != nil && (crop.W < 1 || crop.H < 1 || crop.X < 0 || crop.Y < 0) {
		crop = nil
	}
	chain, complex := outputChain(opts.FPS, crop, opts.Fit, w, h, mode == "high")

	if mode == "high" {
		palette := out + ".palette.png"
		palFilter := chain + ",palettegen"
		if complex {
			palFilter = "[0:v]" + palFilter
		}
		pass1 := buildArgs(opts.VideoPath, "", opts.Start, dur, w, h,
			palFilter, loopStr, palette, complex)
		if err := runFFmpeg(pass1, nil); err != nil {
			return err
		}

		useFilter := "[0:v]" + chain + "[x];[x][1:v]paletteuse=dither=" + ditherAlgo
		pass2 := buildArgs(opts.VideoPath, palette, opts.Start, dur, w, h,
			useFilter, loopStr, out, true)
		return runFFmpeg(pass2, opts.OnProgress)
	}

	fastFilter := chain
	if complex {
		fastFilter = "[0:v]" + chain
	}
	args := buildArgs(opts.VideoPath, "", opts.Start, dur, w, h,
		fastFilter, loopStr, out, complex)
	return runFFmpeg(args, opts.OnProgress)
}

func ditherAlgo(dither bool) string {
	if dither {
		return "sierra2_4a"
	}
	return "bayer:bayer_scale=5"
}

// ProbeSample renders 1-frame and 2-frame GIFs through the same pipeline as
// Convert and reports their byte sizes, so callers can extrapolate total size
// as b1 * frames * clamp(b2/(2*b1)). t0 is the sample position in seconds.
func ProbeSample(videoPath string, t0, fps float64, w, h int, mode string, dither bool, crop *CropBox, fit, dir string) (b1, b2 int64, err error) {
	if videoPath == "" {
		return 0, 0, errors.New("video path required")
	}
	if fps <= 0 {
		fps = 10
	}
	w, h = NormalizeDim(w), NormalizeDim(h)
	if w == 0 || h == 0 {
		return 0, 0, errors.New("width and height must be positive")
	}
	if t0 < 0 {
		t0 = 0
	}
	if mode != "fast" && mode != "high" {
		mode = "high"
	}
	if crop != nil && (crop.W < 1 || crop.H < 1 || crop.X < 0 || crop.Y < 0) {
		crop = nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return 0, 0, err
	}

	chain, complex := outputChain(fps, crop, fit, w, h, mode == "high")
	var render func(frames int, out string) error

	if mode == "high" {
		palette := filepath.Join(dir, "est.palette.png")
		palFilter := chain + ",palettegen"
		if complex {
			palFilter = "[0:v]" + palFilter
		}
		pass1 := buildArgs(videoPath, "", t0, 0.5, w, h, palFilter, "0", palette, complex)
		if err := runFFmpeg(pass1, nil); err != nil {
			return 0, 0, err
		}
		filter := "[0:v]" + chain + "[x];[x][1:v]paletteuse=dither=" + ditherAlgo(dither)
		render = func(frames int, out string) error {
			args := buildArgs(videoPath, palette, t0, 0.5, w, h, filter, "0", out, true, "-frames:v", strconv.Itoa(frames))
			return runFFmpeg(args, nil)
		}
	} else {
		fast := chain
		if complex {
			fast = "[0:v]" + chain
		}
		render = func(frames int, out string) error {
			args := buildArgs(videoPath, "", t0, 0.5, w, h, fast, "0", out, complex, "-frames:v", strconv.Itoa(frames))
			return runFFmpeg(args, nil)
		}
	}

	out1 := filepath.Join(dir, "est1.gif")
	out2 := filepath.Join(dir, "est2.gif")
	if err := render(1, out1); err != nil {
		return 0, 0, err
	}
	if err := render(2, out2); err != nil {
		return 0, 0, err
	}
	st1, err := os.Stat(out1)
	if err != nil {
		return 0, 0, err
	}
	st2, err := os.Stat(out2)
	if err != nil {
		return 0, 0, err
	}
	return st1.Size(), st2.Size(), nil
}

func buildArgs(video, secondInput string, start, dur float64, w, h int, filter, loop, out string, complex bool, extra ...string) []string {
	args := []string{
		"-hide_banner", "-y",
		"-nostdin",
		"-progress", "pipe:2",
		"-ss", strconv.FormatFloat(start, 'f', -1, 64),
		"-t", strconv.FormatFloat(dur, 'f', -1, 64),
		"-i", video,
	}
	if secondInput != "" {
		args = append(args, "-i", secondInput)
	}
	if filter != "" {
		if complex || secondInput != "" {
			args = append(args, "-filter_complex", filter)
		} else {
			args = append(args, "-vf", filter)
		}
	}
	args = append(args, "-loop", loop)
	args = append(args, extra...)
	args = append(args, "-y", out)
	return args
}

func runFFmpeg(args []string, progress func(float64)) error {
	bin, err := FindFFmpeg()
	if err != nil {
		return err
	}
	cmd := exec.Command(bin, args...)
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	var captured bytes.Buffer
	if err := cmd.Start(); err != nil {
		return err
	}
	dur := parseDurFromArgs(args)
	scanner := bufio.NewScanner(stderr)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		captured.WriteString(line)
		captured.WriteByte('\n')
		if progress == nil {
			continue
		}
		if pct := parseProgress(line, dur); pct >= 0 {
			progress(pct)
		}
	}
	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("ffmpeg: %w: %s", err, captured.String())
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
