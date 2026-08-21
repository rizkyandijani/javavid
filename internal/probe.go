package internal

import (
	"errors"
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
)

type VideoMeta struct {
	Path     string  `json:"-"`
	Duration float64 `json:"duration"`
	Width    int     `json:"width"`
	Height   int     `json:"height"`
	FPS      float64 `json:"fps"`
	Codec    string  `json:"codec"`
}

var (
	durationRE = regexp.MustCompile(`Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)`)
	streamRE   = regexp.MustCompile(`Stream\s+#\d+:\d+.*?Video:\s*([^,]+),\s*([a-zA-Z0-9_]+)\s*\(([^)]+)\)?[^,]*(?:\s*,)?\s*(\d+)x(\d+)`)
	fpsRE      = regexp.MustCompile(`\b(\d+(?:\.\d+)?)\s*fps`)
)

func Probe(path string) (*VideoMeta, error) {
	meta, err := probeFFprobe(path)
	if err == nil {
		meta.Path = path
		return meta, nil
	}
	if !errors.Is(err, errFFprobeUnavailable) {
		return nil, err
	}
	meta, err = probeFFmpeg(path)
	if err != nil {
		return nil, err
	}
	meta.Path = path
	return meta, nil
}

var errFFprobeUnavailable = fmt.Errorf("ffprobe not available")

func probeFFprobe(path string) (*VideoMeta, error) {
	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		return nil, errFFprobeUnavailable
	}
	cmd := exec.Command(ffprobe,
		"-v", "error",
		"-select_streams", "v:0",
		"-show_entries", "format=duration:stream=width,height,avg_frame_rate,codec_name",
		"-of", "default=noprint_wrappers=1",
		path,
	)
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("ffprobe failed: %w", err)
	}
	return parseFFprobe(string(out))
}

func parseFFprobe(s string) (*VideoMeta, error) {
	meta := &VideoMeta{}
	for _, line := range splitLines(s) {
		eq := indexByte(line, '=')
		if eq < 0 {
			continue
		}
		key := trimSpace(line[:eq])
		val := trimSpace(line[eq+1:])
		switch k(key) {
		case "duration":
			meta.Duration, _ = strconv.ParseFloat(val, 64)
		case "width":
			meta.Width, _ = strconv.Atoi(val)
		case "height":
			meta.Height, _ = strconv.Atoi(val)
		case "codec_name":
			meta.Codec = val
		case "avg_frame_rate":
			meta.FPS = parseFraction(val, 25)
		}
	}
	if meta.Duration == 0 || meta.Width == 0 || meta.Height == 0 {
		return nil, fmt.Errorf("ffprobe output missing required fields")
	}
	if meta.FPS == 0 {
		meta.FPS = 25
	}
	return meta, nil
}

func parseFraction(s string, def float64) float64 {
	if s == "" || s == "0/0" {
		return def
	}
	for i := 0; i < len(s); i++ {
		if s[i] == '/' {
			num, err1 := strconv.ParseFloat(s[:i], 64)
			den, err2 := strconv.ParseFloat(s[i+1:], 64)
			if err1 == nil && err2 == nil && den != 0 {
				return num / den
			}
			return def
		}
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return def
	}
	return f
}

func probeFFmpeg(path string) (*VideoMeta, error) {
	bin, err := FindFFmpeg()
	if err != nil {
		return nil, err
	}
	cmd := exec.Command(bin, "-hide_banner", "-i", path)
	out, err := cmd.CombinedOutput()
	if err == nil {
		return nil, fmt.Errorf("ffmpeg exited 0 on probe (expected failure): %s", string(out))
	}
	text := string(out)
	meta := &VideoMeta{}

	if m := durationRE.FindStringSubmatch(text); m != nil {
		h, _ := strconv.ParseFloat(m[1], 64)
		mi, _ := strconv.ParseFloat(m[2], 64)
		s, _ := strconv.ParseFloat(m[3], 64)
		meta.Duration = h*3600 + mi*60 + s
	}

	for _, line := range splitLines(text) {
		if !containsAny(line, "Video:") {
			continue
		}
		if m := streamRE.FindStringSubmatch(line); m != nil {
			meta.Codec = m[3]
			meta.Width, _ = strconv.Atoi(m[4])
			meta.Height, _ = strconv.Atoi(m[5])
		}
		if m := fpsRE.FindStringSubmatch(line); m != nil {
			meta.FPS, _ = strconv.ParseFloat(m[1], 64)
		}
	}

	if meta.Duration == 0 {
		return nil, fmt.Errorf("could not parse duration from ffmpeg output")
	}
	if meta.Width == 0 || meta.Height == 0 {
		return nil, fmt.Errorf("could not parse video dimensions from ffmpeg output")
	}
	if meta.FPS == 0 {
		meta.FPS = 25
	}
	return meta, nil
}

func splitLines(s string) []string {
	var lines []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' || s[i] == '\r' {
			if i > start {
				lines = append(lines, s[start:i])
			}
			start = i + 1
		}
	}
	if start < len(s) {
		lines = append(lines, s[start:])
	}
	return lines
}

func indexByte(s string, b byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == b {
			return i
		}
	}
	return -1
}

func trimSpace(s string) string {
	start, end := 0, len(s)
	for start < end && (s[start] == ' ' || s[start] == '\t') {
		start++
	}
	for end > start && (s[end-1] == ' ' || s[end-1] == '\t') {
		end--
	}
	return s[start:end]
}

func containsAny(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

func k(s string) string {
	return s
}
