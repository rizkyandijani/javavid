package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"javavid/internal"
)

func (a *App) handleHealth(w http.ResponseWriter, r *http.Request) {
	ffmpeg, err := internal.FindFFmpeg()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":    "ok",
		"ffmpeg":    ffmpeg,
		"hasFfmpeg": err == nil,
	})
}

func (a *App) handleUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "POST required")
		return
	}
	if _, err := internal.FindFFmpeg(); err != nil {
		writeJSONError(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	if err := r.ParseMultipartForm(200 << 20); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid multipart form: "+err.Error())
		return
	}
	file, hdr, err := r.FormFile("file")
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "missing file field: "+err.Error())
		return
	}
	defer file.Close()

	dir, err := os.MkdirTemp(a.rootDir, "session-")
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	id := filepath.Base(dir)
	ext := filepath.Ext(hdr.Filename)
	if ext == "" {
		ext = ".bin"
	}
	videoPath := filepath.Join(dir, "source"+ext)
	dst, err := os.Create(videoPath)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if _, err := io.Copy(dst, file); err != nil {
		_ = dst.Close()
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := dst.Close(); err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	meta, err := internal.Probe(videoPath)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "probe failed: "+err.Error())
		return
	}

	a.mu.Lock()
	a.sessions[id] = &Session{ID: id, VideoPath: videoPath, Dir: dir, Meta: meta}
	a.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"id":       id,
		"duration": meta.Duration,
		"width":    meta.Width,
		"height":   meta.Height,
		"fps":      meta.FPS,
		"codec":    meta.Codec,
	})
}

func (a *App) getSession(id string) (*Session, bool) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	s, ok := a.sessions[id]
	return s, ok
}

func (a *App) sessionFromQuery(w http.ResponseWriter, r *http.Request) (*Session, bool) {
	id := r.URL.Query().Get("id")
	if id == "" {
		writeJSONError(w, http.StatusBadRequest, "id required")
		return nil, false
	}
	s, ok := a.getSession(id)
	if !ok {
		writeJSONError(w, http.StatusNotFound, "session not found")
		return nil, false
	}
	return s, true
}

func (a *App) handleProbe(w http.ResponseWriter, r *http.Request) {
	s, ok := a.sessionFromQuery(w, r)
	if !ok {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(s.Meta)
}

func (a *App) handleThumbnails(w http.ResponseWriter, r *http.Request) {
	s, ok := a.sessionFromQuery(w, r)
	if !ok {
		return
	}
	thumbsDir := filepath.Join(s.Dir, "thumbs")
	if err := os.MkdirAll(thumbsDir, 0o755); err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	files, err := internal.Thumbnails(s.VideoPath, thumbsDir, s.Meta.Duration)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]string, len(files))
	for i, f := range files {
		rel, _ := filepath.Rel(s.Dir, f)
		out[i] = "/api/result/" + s.ID + "/" + filepath.ToSlash(rel)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"files": out})
}

func (a *App) handleFrame(w http.ResponseWriter, r *http.Request) {
	s, ok := a.sessionFromQuery(w, r)
	if !ok {
		return
	}
	tStr := r.URL.Query().Get("t")
	if tStr == "" {
		writeJSONError(w, http.StatusBadRequest, "t required")
		return
	}
	t, err := strconv.ParseFloat(tStr, 64)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid t")
		return
	}
	framePath := filepath.Join(s.Dir, "frame.jpg")
	if err := internal.Frame(s.VideoPath, framePath, t); err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	http.ServeFile(w, r, framePath)
}

type convertRequest struct {
	ID           string  `json:"id"`
	Start        float64 `json:"start"`
	End          float64 `json:"end"`
	FPS          float64 `json:"fps"`
	Width        int     `json:"width"`
	Height       int     `json:"height"`
	Mode         string  `json:"mode"`
	Dither       bool    `json:"dither"`
	Loop         int     `json:"loop"`
	SaveToFolder bool    `json:"saveToFolder"`
	Filename     string  `json:"filename"`
}

func (a *App) handleConvert(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "POST required")
		return
	}
	var req convertRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	s, ok := a.getSession(req.ID)
	if !ok {
		writeJSONError(w, http.StatusNotFound, "session not found")
		return
	}
	if req.End <= req.Start {
		writeJSONError(w, http.StatusBadRequest, "end must be > start")
		return
	}
	if req.Start < 0 {
		req.Start = 0
	}
	if req.End > s.Meta.Duration {
		req.End = s.Meta.Duration
	}
	if req.Width <= 0 || req.Height <= 0 {
		req.Width = s.Meta.Width
		req.Height = s.Meta.Height
	}
	if req.FPS <= 0 {
		req.FPS = s.Meta.FPS
	}

	resultsDir := filepath.Join(a.rootDir, "results")
	if err := os.MkdirAll(resultsDir, 0o755); err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	name := req.Filename
	if name == "" {
		name = randomID() + ".gif"
	} else if filepath.Ext(name) == "" {
		name = name + ".gif"
	}
	name = sanitizeName(name)
	outPath := filepath.Join(resultsDir, name)
	req.Width = internal.NormalizeDim(req.Width)
	req.Height = internal.NormalizeDim(req.Height)

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSONError(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	enc := json.NewEncoder(w)
	_ = enc.Encode(map[string]any{"percent": 0})

	onProgress := func(pct float64) {
		_ = enc.Encode(map[string]any{"percent": pct})
		flusher.Flush()
	}

	opts := internal.ConvertOptions{
		VideoPath:  s.VideoPath,
		Start:      req.Start,
		End:        req.End,
		FPS:        req.FPS,
		Width:      req.Width,
		Height:     req.Height,
		Mode:       req.Mode,
		Dither:     req.Dither,
		Loop:       req.Loop,
		Output:     outPath,
		OnProgress: onProgress,
	}
	if err := internal.Convert(opts); err != nil {
		_ = enc.Encode(map[string]any{"error": err.Error()})
		flusher.Flush()
		return
	}

	savedTo := ""
	if req.SaveToFolder {
		dest, derr := a.writeToSaveFolder(outPath)
		if derr != nil {
			_ = enc.Encode(map[string]any{"warning": "save-to-folder failed: " + derr.Error()})
		} else {
			savedTo = dest
		}
	}

	downloadURL := "/api/result/results/" + filepath.Base(outPath)
	_ = enc.Encode(map[string]any{"done": true, "file": filepath.Base(outPath), "url": downloadURL, "savedTo": savedTo, "width": req.Width, "height": req.Height})
	flusher.Flush()
}

func (a *App) handleResult(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/result/")
	if rest == "" || strings.Contains(rest, "..") {
		http.Error(w, "bad path", http.StatusBadRequest)
		return
	}
	parts := strings.SplitN(rest, "/", 2)
	if len(parts) < 2 {
		rest = "results/" + filepath.Base(rest)
		parts = strings.SplitN(rest, "/", 2)
	}
	idOrKind, rel := parts[0], parts[1]
	idOrKind = filepath.Clean(idOrKind)
	if strings.Contains(idOrKind, "..") {
		http.Error(w, "bad path", http.StatusBadRequest)
		return
	}
	var path string
	switch idOrKind {
	case "results":
		path = filepath.Join(a.rootDir, "results", filepath.Base(rel))
	default:
		s, ok := a.getSession(idOrKind)
		if !ok {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		path = filepath.Join(s.Dir, rel)
		cleaned := filepath.Clean(path)
		if !strings.HasPrefix(cleaned, s.Dir+string(filepath.Separator)) && cleaned != s.Dir {
			http.Error(w, "bad path", http.StatusBadRequest)
			return
		}
		path = cleaned
	}
	if _, err := os.Stat(path); err != nil {
		http.NotFound(w, r)
		return
	}
	ext := filepath.Ext(path)
	if ct := mime.TypeByExtension(ext); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFile(w, r, path)
}

type savePathReq struct {
	Folder string `json:"folder"`
	File   string `json:"file"`
}

func (a *App) handleSavePath(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "POST required")
		return
	}
	var req savePathReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	folder := strings.TrimSpace(req.Folder)
	if folder == "" {
		writeJSONError(w, http.StatusBadRequest, "folder required")
		return
	}
	info, err := os.Stat(folder)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "folder not accessible: "+err.Error())
		return
	}
	if !info.IsDir() {
		writeJSONError(w, http.StatusBadRequest, "not a directory")
		return
	}
	probe := filepath.Join(folder, ".javavid-write-probe")
	if err := os.WriteFile(probe, []byte("ok"), 0o644); err != nil {
		writeJSONError(w, http.StatusBadRequest, "folder not writable: "+err.Error())
		return
	}
	_ = os.Remove(probe)

	a.mu.Lock()
	a.saveFolder = folder
	a.mu.Unlock()

	savedTo := ""
	if req.File != "" {
		src := filepath.Join(a.rootDir, "results", filepath.Base(req.File))
		if _, err := os.Stat(src); err != nil {
			writeJSONError(w, http.StatusNotFound, "result file not found")
			return
		}
		dest, err := copyFile(src, folder)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "copy failed: "+err.Error())
			return
		}
		savedTo = dest
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "folder": folder, "savedTo": savedTo})
}

func (a *App) writeToSaveFolder(src string) (string, error) {
	a.mu.RLock()
	folder := a.saveFolder
	a.mu.RUnlock()
	if folder == "" {
		return "", errors.New("no save folder set; call /api/save-path first")
	}
	return copyFile(src, folder)
}

func copyFile(src, folder string) (string, error) {
	dest := filepath.Join(folder, filepath.Base(src))
	in, err := os.Open(src)
	if err != nil {
		return "", err
	}
	defer in.Close()
	out, err := os.Create(dest)
	if err != nil {
		return "", err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return "", err
	}
	return dest, nil
}

func writeJSONError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": msg})
}

func randomID() string {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", os.Getpid())
	}
	return hex.EncodeToString(b)
}

func sanitizeName(s string) string {
	s = filepath.Base(s)
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z',
			r >= 'A' && r <= 'Z',
			r >= '0' && r <= '9',
			r == '.', r == '_', r == '-':
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	out := b.String()
	if out == "" {
		return "output.gif"
	}
	return out
}
