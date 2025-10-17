package main

import (
	"flag"
	"log"
	"net/http"
	"strings"

	"github.com/liuzl/levelui"
)

func main() {
	listenAddr := flag.String("listen", ":8080", "Address to listen on")
	dbsStr := flag.String("dbs", "", "Comma-separated list of databases. Format: <name>:<path>,<name2>:<path2>")
	flag.Parse()

	if *dbsStr == "" {
		log.Fatalf("The -dbs flag is required. Usage: levelui-server -dbs=\"<name>:<path>\"")
	}

	manager := levelui.NewManager()
	defer manager.Close()

	for _, pair := range strings.Split(*dbsStr, ",") {
		pair = strings.TrimSpace(pair)
		if parts := strings.SplitN(pair, ":", 2); len(parts) == 2 {
			name, path := parts[0], parts[1]
			if err := manager.Register(name, path); err != nil {
				log.Fatalf("Failed to register db '%s' at '%s': %v", name, path, err)
			}
			log.Printf("Registered database '%s' from path: %s", name, path)
		}
	}

	handler := levelui.NewHandler(manager)
	log.Printf("LevelUI server starting on %s", *listenAddr)
	if err := http.ListenAndServe(*listenAddr, handler); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}