package main

import (
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"sync"
	"syscall"
	"time"

	"javavid/internal"
)

//go:embed static
var staticFS embed.FS

type Session struct {
	ID        string              `json:"id"`
	VideoPath string              `json:"-"`
	Dir       string              `json:"-"`
	Meta      *internal.VideoMeta `json:"meta"`
	Created   int64               `json:"-"`
}

type App struct {
	rootDir    string
	mu         sync.RWMutex
	sessions   map[string]*Session
	resultDirs []string
	saveFolder string
}

func main() {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("unexpected error: %v", r)
			waitForEnter()
		}
	}()

	ffmpeg, err := internal.FindFFmpeg()
	if err != nil {
		log.Printf("WARNING: %v", err)
	} else {
		log.Printf("ffmpeg found: %s", ffmpeg)
	}

	root, err := os.MkdirTemp("", "javavid-")
	if err != nil {
		log.Printf("error: %v", err)
		waitForEnter()
		return
	}
	app := &App{
		rootDir:  root,
		sessions: make(map[string]*Session),
	}
	log.Printf("workspace: %s", root)

	sub, err := fs.Sub(staticFS, "static")
	if err != nil {
		log.Printf("error: %v", err)
		waitForEnter()
		return
	}

	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.FS(sub)))
	mux.HandleFunc("/api/health", app.handleHealth)
	mux.HandleFunc("/api/upload", app.handleUpload)
	mux.HandleFunc("/api/probe", app.handleProbe)
	mux.HandleFunc("/api/thumbnails", app.handleThumbnails)
	mux.HandleFunc("/api/frame", app.handleFrame)
	mux.HandleFunc("/api/convert", app.handleConvert)
	mux.HandleFunc("/api/result/", app.handleResult)
	mux.HandleFunc("/api/save-path", app.handleSavePath)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8090"
	}
	addr := "127.0.0.1:" + port
	log.Printf("javavid listening on http://%s", addr)
	srv := &http.Server{Addr: addr, Handler: mux}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)

	done := make(chan error, 1)
	go func() {
		done <- srv.ListenAndServe()
	}()

	go func() {
		time.Sleep(300 * time.Millisecond)
		if err := openBrowser("http://" + addr); err != nil {
			log.Printf("could not open browser: %v", err)
		}
	}()

	select {
	case err := <-done:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			_ = os.RemoveAll(app.rootDir)
			log.Printf("server error: %v", err)
			waitForEnter()
		}
	case <-sigCh:
		log.Printf("shutting down, cleaning %s", app.rootDir)
		_ = srv.Close()
		<-done
	}

	if err := os.RemoveAll(app.rootDir); err != nil {
		log.Printf("workspace cleanup failed: %v", err)
	}
}

func openBrowser(url string) error {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		return exec.Command("open", url).Start()
	default:
		return exec.Command("xdg-open", url).Start()
	}
}

func waitForEnter() {
	log.Printf("Press Enter to exit...")
	_, _ = fmt.Scanln()
}
