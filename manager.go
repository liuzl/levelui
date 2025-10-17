package levelui

import (
	"fmt"
	"log"
	"sync"

	"github.com/syndtr/goleveldb/leveldb"
)

// Manager holds and manages multiple named leveldb instances.
// It is safe for concurrent use.
type Manager struct {
	mu    sync.RWMutex
	dbs   map[string]*leveldb.DB
	paths map[string]string
}

// NewManager creates and returns a new Manager.
func NewManager() *Manager {
	return &Manager{
		dbs:   make(map[string]*leveldb.DB),
		paths: make(map[string]string),
	}
}

// Register opens a leveldb database at the given path and registers it
// with the given name. If a database with the same name already exists,
// it returns an error.
func (m *Manager) Register(name, path string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, ok := m.dbs[name]; ok {
		return fmt.Errorf("database with name '%s' already registered", name)
	}

	db, err := leveldb.OpenFile(path, nil)
	if err != nil {
		return fmt.Errorf("failed to open leveldb at %s: %w", path, err)
	}

	m.dbs[name] = db
	m.paths[name] = path
	return nil
}

// Add registers an already opened leveldb.DB instance with the given name.
// The manager will NOT close this database instance; its lifecycle is managed
// by the calling application.
func (m *Manager) Add(name string, db *leveldb.DB) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, ok := m.dbs[name]; ok {
		return fmt.Errorf("database with name '%s' already registered", name)
	}
	m.dbs[name] = db
	return nil
}

// Get retrieves a database instance by its name.
// It returns the database instance and true if found, otherwise nil and false.
func (m *Manager) Get(name string) (*leveldb.DB, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	db, ok := m.dbs[name]
	return db, ok
}

// List returns a slice of names of all registered database instances.
func (m *Manager) List() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	names := make([]string, 0, len(m.dbs))
	for name := range m.dbs {
		names = append(names, name)
	}
	return names
}

// Close closes only the database instances that were opened by the manager
// via the Register(name, path) method. It does not close DBs added via Add().
func (m *Manager) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for name, path := range m.paths {
		if db, ok := m.dbs[name]; ok {
			log.Printf("Closing database '%s' at path '%s'", name, path)
			db.Close()
			delete(m.dbs, name)
		}
	}
	// Clear the paths map as they are now all closed.
	m.paths = make(map[string]string)
}
