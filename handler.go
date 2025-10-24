package levelui

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/syndtr/goleveldb/leveldb"
	"github.com/syndtr/goleveldb/leveldb/opt"
)

//go:embed all:ui
var uiFS embed.FS

func NewHandler(manager *Manager, opts ...bool) http.Handler {
	debug := false
	if len(opts) > 0 && opts[0] {
		debug = true
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/dbs", handleGetDBs(manager))
	mux.HandleFunc("/api/db/", handleDB(manager))

	var staticFS http.Handler
	if debug {
		log.Println("Serving UI from local 'ui' directory (dev mode).")
		staticFS = http.FileServer(http.Dir("ui"))
	} else {
		log.Println("Serving UI from embedded filesystem.")
		strippedFS, err := fs.Sub(uiFS, "ui")
		if err != nil {
			log.Fatalf("failed to create sub file system for embedded UI: %v", err)
		}
		staticFS = http.FileServer(http.FS(strippedFS))
	}
	mux.Handle("/", staticFS)

	return mux
}

func handleDB(manager *Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/api/db/")
		parts := strings.SplitN(path, "/", 2)

		if len(parts) < 1 || parts[0] == "" {
			http.Error(w, "Database name is missing", http.StatusBadRequest)
			return
		}
		dbName := parts[0]

		var action string
		var rest string
		if len(parts) > 1 {
			actionParts := strings.SplitN(parts[1], "/", 2)
			action = actionParts[0]
			if len(actionParts) > 1 {
				rest = actionParts[1]
			}
		}

		switch action {
		case "keys":
			handleGetKeys(w, r, manager, dbName)
		case "key":
			key, err := url.PathUnescape(rest)
			if err != nil {
				http.Error(w, "Invalid key in URL path", http.StatusBadRequest)
				return
			}
			switch r.Method {
			case http.MethodGet:
				handleGetKey(w, r, manager, dbName, key)
			case http.MethodDelete:
				handleDeleteKey(w, r, manager, dbName, key)
			case http.MethodPost:
				handleSetKey(w, r, manager, dbName)
			default:
				http.Error(w, "Method not allowed for /key", http.StatusMethodNotAllowed)
			}
		default:
			http.NotFound(w, r)
		}
	}
}

func handleGetKeys(w http.ResponseWriter, r *http.Request, manager *Manager, dbName string) {
	db, ok := manager.Get(dbName)
	if !ok {
		http.Error(w, fmt.Sprintf("Database '%s' not found", dbName), http.StatusNotFound)
		return
	}

	q := r.URL.Query()
	startKey := q.Get("start")
	prefix := q.Get("prefix")
	limitStr := q.Get("limit")
	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit <= 0 {
		limit = 50
	}

	keys := make([][]byte, 0, limit)
	var nextKey []byte
	iter := db.NewIterator(nil, &opt.ReadOptions{})
	defer iter.Release()

	if startKey != "" {
		iter.Seek([]byte(startKey))
	} else if prefix != "" {
		iter.Seek([]byte(prefix))
	} else {
		iter.First()
	}

	for len(keys) < limit && iter.Valid() {
		key := iter.Key()
		// Manual prefix check if a prefix is specified
		if prefix != "" && !strings.HasPrefix(string(key), prefix) {
			break // Stop iterating if we've moved past the prefix
		}

		copiedKey := make([]byte, len(key))
		copy(copiedKey, key)
		keys = append(keys, copiedKey)
		iter.Next()
	}

	if iter.Valid() {
		nextKey = make([]byte, len(iter.Key()))
		copy(nextKey, iter.Key())
	}

	stringKeys := make([]string, len(keys))
	for i, k := range keys {
		stringKeys[i] = string(k)
	}

	response := struct {
		Keys    []string `json:"keys"`
		NextKey string   `json:"next_key,omitempty"`
	}{
		Keys:    stringKeys,
		NextKey: string(nextKey),
	}

	writeJSON(w, http.StatusOK, response)
}

func handleGetKey(w http.ResponseWriter, r *http.Request, manager *Manager, dbName, keyStr string) {
	db, ok := manager.Get(dbName)
	if !ok {
		http.Error(w, fmt.Sprintf("Database '%s' not found", dbName), http.StatusNotFound)
		return
	}

	value, err := db.Get([]byte(keyStr), nil)
	if err == leveldb.ErrNotFound {
		http.Error(w, "Key not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get key: %v", err), http.StatusInternalServerError)
		return
	}

	response := struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	}{
		Key:   keyStr,
		Value: string(value),
	}

	writeJSON(w, http.StatusOK, response)
}

func handleDeleteKey(w http.ResponseWriter, r *http.Request, manager *Manager, dbName, keyStr string) {
	db, ok := manager.Get(dbName)
	if !ok {
		http.Error(w, fmt.Sprintf("Database '%s' not found", dbName), http.StatusNotFound)
		return
	}

	err := db.Delete([]byte(keyStr), nil)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to delete key: %v", err), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func handleSetKey(w http.ResponseWriter, r *http.Request, manager *Manager, dbName string) {
	db, ok := manager.Get(dbName)
	if !ok {
		http.Error(w, fmt.Sprintf("Database '%s' not found", dbName), http.StatusNotFound)
		return
	}

	var payload struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	}

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid JSON body", http.StatusBadRequest)
		return
	}

	if err := db.Put([]byte(payload.Key), []byte(payload.Value), nil); err != nil {
		http.Error(w, fmt.Sprintf("Failed to set key-value pair: %v", err), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
}

func handleGetDBs(manager *Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		dbNames := manager.List()
		if dbNames == nil {
			dbNames = []string{}
		}
		writeJSON(w, http.StatusOK, dbNames)
	}
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("ERROR: Failed to encode JSON response: %v", err)
	}
}
