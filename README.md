# LevelUI

A simple, self-contained, and embeddable web UI for managing `goleveldb` instances. Built with a pure Go backend and a lightweight, dependency-free vanilla JavaScript frontend.

## Features

- ✅ **Manage Multiple Databases**: Register and manage several LevelDB instances from a single UI.
- ✅ **Key-Value Operations**:
    - View all keys with pagination.
    - View the value of a specific key.
    - Add or update key-value pairs.
    - Delete keys with confirmation.
- ✅ **Live Prefix Search**: Filter keys in real-time by typing a prefix.
- ✅ **Embeddable**: Can be used as a Go library and integrated into your existing web applications.
- ✅ **Single Binary Deployment**: All frontend assets (HTML, CSS, JS) are embedded into the final executable for easy, zero-dependency distribution.

## Getting Started

### Prerequisites

- Go 1.16+ (for the `embed` package)

### Running as a Standalone Server

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/liuzl/levelui.git
    cd levelui
    ```

2.  **Download dependencies:**
    ```bash
    go mod tidy
    ```

3.  **Run the server:**
    Use the `-dbs` flag to provide a comma-separated list of databases you want to manage. The format for each entry is `<name>:<path>`.

    ```bash
    # Manage a single database named "test" located at /tmp/levelui_test_db
    go run ./cmd/levelui-server -dbs="test:/tmp/levelui_test_db"

    # Manage multiple databases
    go run ./cmd/levelui-server -dbs="users:/data/users.db,cache:/data/cache.db"
    ```
    The server will start, and you can access the UI at `http://localhost:8080`.

### Using as a Library

You can easily embed the LevelUI into your own Go application.

1.  **Import the library:**
    ```go
    import "github.com/liuzl/levelui"
    ```

2.  **Create a manager, register your DB, and mount the handler:**

    ```go
    package main

    import (
    	"log"
    	"net/http"

    	"github.com/liuzl/levelui"
    	"github.com/syndtr/goleveldb/leveldb"
    )

    func main() {
    	// Assume you already have your own LevelDB instance(s)
    	myAppDB, err := leveldb.OpenFile("/path/to/my/app.db", nil)
    	if err != nil {
    		log.Fatalf("Failed to open my app DB: %v", err)
    	}
    	// Note: The manager does not take ownership or close the DB in this case.
    	// You are responsible for the DB's lifecycle.

    	// 1. Create a LevelUI manager
    	uiManager := levelui.NewManager()

    	// 2. (Optional) You can still use Register to let LevelUI open files
    	if err := uiManager.Register("another_db", "/tmp/another.db"); err != nil {
    		log.Fatalf("Failed to register another_db: %v", err)
    	}
    	defer uiManager.Close() // This will close "another_db"

    	// 3. Create the UI handler
    	uiHandler := levelui.NewHandler(uiManager)

    	// 4. Mount it in your application's router
    	mux := http.NewServeMux()
    	mux.Handle("/levelui/", http.StripPrefix("/levelui", uiHandler))

    	// Your application's other routes
    	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
    		w.Write([]byte("<h1>My Awesome App</h1><a href=\"/levelui/\">Manage Database</a>"))
    	})

    	log.Println("Starting server on :8080...")
    	http.ListenAndServe(":8080", mux)
    }
    ```

## Architecture

-   **Backend**: A pure Go API server using only the standard library (`net/http`, `embed`). It serves a JSON API for all database operations and hosts the static frontend assets.
-   **Frontend**: A simple, dependency-free Single Page Application (SPA) built with vanilla HTML, CSS, and JavaScript. All frontend files are located in the `/ui` directory and embedded into the Go binary at compile time.
-   **Project Structure**: The project follows the standard Go "library-first" pattern. The root package (`.`) is the reusable library, and the `cmd/` directory contains the standalone server application that uses the library.

## A Note on the Development Process

This project was developed entirely through a conversational "vibe coding" session, without the user directly viewing the code in an IDE. The process was iterative and collaborative:

1.  **Initial Goal**: To create a simple, embeddable web UI for goleveldb.
2.  **Architectural Refinement**: We progressively refined the architecture through dialogue, moving from server-side templates to a frontend/backend separation, then to embedding the UI, and finally settling on the robust library-first structure.
3.  **Collaborative Debugging**: The path wasn't always smooth. We encountered a series of challenging bugs, from mysterious compilation errors caused by tooling issues to a particularly stubborn search bug. Each challenge was overcome through a process of hypothesis, testing, and precise feedback. The key breakthrough in solving the search functionality was to simplify the problem by temporarily removing Base64 encoding, which allowed us to isolate and fix the underlying logic in the backend.

This iterative and conversational development process, including its debugging challenges, ultimately led to a more robust and thoroughly tested final product.

## License

MIT
