document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Element Caching ---
    const dbListElement = document.getElementById('db-list');
    const welcomeMessageElement = document.getElementById('welcome-message');
    const dataViewElement = document.getElementById('data-view');
    const dbNav = document.getElementById('db-nav');
    const dbNavToggle = document.getElementById('db-nav-toggle');
    
    const modal = document.getElementById('view-modal');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    const modalKeyElement = document.getElementById('modal-key');
    const modalValueElement = document.getElementById('modal-value');
    const editFromViewBtn = document.getElementById('edit-from-view-btn');

    const editModal = document.getElementById('edit-modal');
    const editModalCloseBtn = document.getElementById('edit-modal-close-btn');
    const editForm = document.getElementById('edit-form');
    const editKeyElement = document.getElementById('edit-key');
    const editValueElement = document.getElementById('edit-value');

    const confirmModal = document.getElementById('confirm-modal');
    const confirmModalCloseBtn = document.getElementById('confirm-modal-close-btn');
    const confirmModalText = document.getElementById('confirm-modal-text');
    const confirmCancelBtn = document.getElementById('confirm-cancel-btn');
    const confirmDeleteBtn = document.getElementById('confirm-delete-btn');

    // --- State ---
    let activeDb = null;
    let activeDbLiElement = null;
    let searchDebounceTimer;
    let isEditMode = false;
    let editingKey = null;

    // Pagination state
    let paginationHistory = [];
    let currentStartKey = null;
    let currentPrefix = '';

    // --- Event Listeners ---
    if (dbNavToggle && dbNav) {
        dbNavToggle.addEventListener('click', () => {
            dbNav.classList.toggle('collapsed');
        });
    }

    if (modal && modalCloseBtn) {
        modalCloseBtn.addEventListener('click', () => modal.classList.add('hidden'));
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.add('hidden');
        });
    }

    if (editModal && editModalCloseBtn) {
        editModalCloseBtn.addEventListener('click', () => {
            editModal.classList.add('hidden');
            resetEditState();
        });
        editModal.addEventListener('click', (e) => {
            if (e.target === editModal) {
                editModal.classList.add('hidden');
                resetEditState();
            }
        });
    }

    if (editForm) {
        editForm.addEventListener('submit', handleSetKey);
    }

    if (editFromViewBtn) {
        editFromViewBtn.addEventListener('click', handleEditFromView);
    }

    if (confirmModal) {
        confirmModalCloseBtn.addEventListener('click', () => {
            confirmModal.classList.add('hidden');
            confirmDeleteBtn.onclick = null; // Clear the handler
        });
        confirmCancelBtn.addEventListener('click', () => {
            confirmModal.classList.add('hidden');
            confirmDeleteBtn.onclick = null; // Clear the handler
        });
        confirmModal.addEventListener('click', (e) => {
            if (e.target === confirmModal) {
                confirmModal.classList.add('hidden');
                confirmDeleteBtn.onclick = null; // Clear the handler
            }
        });

        // Add keyboard support
        confirmModal.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                confirmModal.classList.add('hidden');
                confirmDeleteBtn.onclick = null; // Clear the handler
            } else if (e.key === 'Enter' && confirmDeleteBtn.onclick) {
                // Only trigger delete if Enter is pressed and there's an active handler
                confirmDeleteBtn.click();
            }
        });
    }

    // --- Core Functions ---

    async function fetchAndDisplayDBs() {
        try {
            const response = await fetch('/api/dbs');
            if (!response.ok) throw new Error(`Network response was not ok: ${response.statusText}`);
            const dbNames = await response.json();

            dbListElement.innerHTML = '';
            if (!dbNames || dbNames.length === 0) {
                dbListElement.innerHTML = '<li style="color: #888;">No databases found.</li>';
                return;
            }

            dbNames.forEach(name => {
                const li = document.createElement('li');
                li.textContent = name;
                li.dataset.dbName = name;
                li.addEventListener('click', () => handleDbSelection(name, li));
                dbListElement.appendChild(li);
            });
        } catch (error) {
            console.error('Error fetching database list:', error);
            dbListElement.innerHTML = '<li style="color: #ff5555;">Error loading databases.</li>';
        }
    }

    function handleDbSelection(dbName, liElement) {
        if (activeDbLiElement) activeDbLiElement.classList.remove('active');

        liElement.classList.add('active');
        activeDb = dbName;
        activeDbLiElement = liElement;

        welcomeMessageElement.classList.add('hidden');
        dataViewElement.classList.remove('hidden');

        // Reset pagination state
        paginationHistory = [];
        currentStartKey = null;
        currentPrefix = '';

        fetchAndDisplayKeys(dbName);
    }

    async function fetchAndDisplayKeys(dbName, options = {}) {
        try {
            const url = new URL(`/api/db/${dbName}/keys`, window.location.origin);
            if (options.startKey) url.searchParams.append('start', options.startKey);
            if (options.prefix) url.searchParams.append('prefix', options.prefix);
            console.log(`[DEBUG] Fetching keys with URL: ${url}`);

            // Update pagination state
            const newPrefix = options.prefix || '';
            const newStartKey = options.startKey || null;

            // Only add to history if we're moving forward (not going back)
            if (newPrefix === currentPrefix && newStartKey && newStartKey !== currentStartKey) {
                // Check if we're moving forward to a new page
                const isInHistory = paginationHistory.some(item => item.startKey === newStartKey);
                if (!isInHistory) {
                    paginationHistory.push({ startKey: currentStartKey, prefix: currentPrefix });
                }
            } else if (newPrefix !== currentPrefix) {
                // Prefix changed, reset history
                paginationHistory = [];
                currentStartKey = null;
            }

            currentPrefix = newPrefix;
            currentStartKey = newStartKey;

            const response = await fetch(url);
            if (!response.ok) throw new Error(`API response was not ok: ${response.statusText}`);

            const data = await response.json();
            console.log(`[DEBUG] Received data.keys.length: ${data.keys ? data.keys.length : 'null'}`);
            renderKeyView(dbName, data.keys || [], data.next_key, newPrefix, options.startKey);
        } catch (error) {
            console.error(`Error fetching keys for ${dbName}:`, error);
            if (dataViewElement) dataViewElement.innerHTML = `<p style="color: #ff5555;">Error loading keys.</p>`;
        }
    }

    function renderKeyView(dbName, keys, nextKey, currentPrefix = '', startKey = null) {
        let keyTableHTML = '<p class="empty-state">No keys found.</p>';
        if (keys.length > 0) {
            keyTableHTML = `
                <table class="key-table">
                    <thead><tr><th>Key</th><th>Actions</th></tr></thead>
                    <tbody>
                        ${keys.map(keyStr => `
                            <tr>
                                <td class="key-cell" title="${escapeHTML(keyStr)}">${escapeHTML(keyStr)}</td>
                                <td>
                                    <button class="action-btn" data-action="view" data-db="${dbName}" data-key="${escapeHTML(keyStr)}" title="View key"></button>
                                    <button class="action-btn" data-action="delete" data-db="${dbName}" data-key="${escapeHTML(keyStr)}" title="Delete key"></button>
                                </td>
                            </tr>`).join('')}
                    </tbody>
                </table>`;
        }

        // Get current search input value, focus state, and cursor position before rebuilding
        const searchInput = document.getElementById('search-key-input');
        const searchInputValue = searchInput ? searchInput.value : (currentPrefix || '');
        const searchInputFocused = searchInput && document.activeElement === searchInput;
        const searchCursorPosition = searchInput ? searchInput.selectionStart : 0;

        // Determine if Previous button should be enabled
        const hasPrevious = paginationHistory.length > 0;

        dataViewElement.innerHTML = `
            <div class="db-header">
                 <h3>${dbName}</h3>
                 <div class="db-actions">
                    <input type="text" id="search-key-input" placeholder="Search by key prefix..." value="${escapeHTML(searchInputValue)}">
                    <button id="add-key-btn">Add Key</button>
                 </div>
            </div>
            <div id="key-value-container">${keyTableHTML}</div>
            <div class="pagination">
                <button id="prev-page-btn" ${!hasPrevious ? 'disabled' : ''}>← Previous</button>
                <button id="next-page-btn" ${!nextKey ? 'disabled' : ''}>Next →</button>
            </div>`;

        // Add event listeners for the newly rendered content
        const prevBtn = document.getElementById('prev-page-btn');
        if (prevBtn && paginationHistory.length > 0) {
            prevBtn.addEventListener('click', () => {
                const previousPage = paginationHistory.pop();
                currentStartKey = previousPage.startKey;
                currentPrefix = previousPage.prefix;
                fetchAndDisplayKeys(dbName, { startKey: previousPage.startKey, prefix: previousPage.prefix });
            });
        }

        const nextBtn = document.getElementById('next-page-btn');
        if (nextBtn && nextKey) {
            nextBtn.addEventListener('click', () => fetchAndDisplayKeys(dbName, { startKey: nextKey, prefix: currentPrefix }));
        }

        const newSearchInput = document.getElementById('search-key-input');
        if (newSearchInput) {
            // Restore focus if it was focused before
            if (searchInputFocused) {
                setTimeout(() => {
                    newSearchInput.focus();
                    // Restore cursor position
                    newSearchInput.setSelectionRange(searchCursorPosition, searchCursorPosition);
                }, 0);
            }

            newSearchInput.addEventListener('input', (e) => {
                console.log(`[DEBUG] Input event. activeDb: ${activeDb}, searchValue: "${e.target.value}"`);
                clearTimeout(searchDebounceTimer);
                searchDebounceTimer = setTimeout(() => {
                    if (!activeDb) return;
                    paginationHistory = [];
                    currentStartKey = null;
                    fetchAndDisplayKeys(dbName, { prefix: e.target.value });
                }, 300);
            });
        }

        document.getElementById('add-key-btn').addEventListener('click', () => {
            document.getElementById('edit-modal-title').textContent = 'Add New Key/Value';
            editForm.reset();
            editKeyElement.disabled = false;
            isEditMode = false;
            editingKey = null;
            editModal.classList.remove('hidden');
        });

        document.querySelectorAll('.action-btn[data-action="view"]').forEach(btn => {
            btn.addEventListener('click', e => handleViewKey(e.target.dataset.db, e.target.dataset.key));
        });
        document.querySelectorAll('.action-btn[data-action="delete"]').forEach(btn => {
            btn.addEventListener('click', e => handleDeleteKey(e.target.dataset.db, e.target.dataset.key, e.target));
        });
    }

    async function handleSetKey(e) {
        e.preventDefault();
        if (!activeDb) return;

        const key = editKeyElement.value;
        const value = editValueElement.value;
        if (!key) return alert('Key cannot be empty.');

        try {
            const response = await fetch(`/api/db/${activeDb}/key`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key, value }),
            });

            if (response.status === 201) {
                editModal.classList.add('hidden');
                const searchPrefix = document.getElementById('search-key-input')?.value || '';

                // Reset pagination when adding new keys
                paginationHistory = [];
                currentStartKey = null;
                fetchAndDisplayKeys(activeDb, { prefix: searchPrefix });

                // Reset edit state
                isEditMode = false;
                editingKey = null;
                editKeyElement.disabled = false;
            } else {
                throw new Error(`API Error: ${response.status} ${await response.text()}`);
            }
        } catch (error) {
            console.error('Error setting key:', error);
            alert('Could not save key-value pair. See console for details.');
        }
    }

    async function handleDeleteKey(dbName, key, buttonElement) {
        confirmModalText.textContent = `Are you sure you want to delete the key "${key}"? This action cannot be undone.`;
        confirmModal.classList.remove('hidden');

        // Focus the cancel button for better accessibility
        setTimeout(() => confirmCancelBtn.focus(), 100);

        confirmDeleteBtn.onclick = async () => {
            try {
                // Add loading state
                confirmDeleteBtn.disabled = true;
                confirmDeleteBtn.textContent = 'Deleting...';

                const response = await fetch(`/api/db/${dbName}/key/${encodeURIComponent(key)}`, { method: 'DELETE' });

                if (response.status === 204) {
                    const row = buttonElement.closest('tr');
                    if (row) row.remove();
                } else {
                    throw new Error(`API Error: ${response.status} ${await response.text()}`);
                }
            } catch (error) {
                console.error('Error deleting key:', error);
                alert('Could not delete key. See console for details.');
            } finally {
                // Reset button state
                confirmDeleteBtn.disabled = false;
                confirmDeleteBtn.textContent = 'Delete';
                confirmModal.classList.add('hidden');
            }
        };
    }

    async function handleViewKey(dbName, key) {
        try {
            const response = await fetch(`/api/db/${dbName}/key/${encodeURIComponent(key)}`);
            if (!response.ok) throw new Error(`API Error: ${response.status} ${await response.text()}`);

            const data = await response.json();
            modalKeyElement.textContent = data.key;
            modalValueElement.textContent = data.value;
            editingKey = data.key;
            modal.classList.remove('hidden');
        } catch (error) {
            console.error('Error fetching key value:', error);
            alert('Could not load key value. See console for details.');
        }
    }

    function handleEditFromView() {
        if (!editingKey || !activeDb) return;

        // Switch to edit mode
        modal.classList.add('hidden');
        editModal.classList.remove('hidden');

        // Update modal title for edit mode
        document.getElementById('edit-modal-title').textContent = 'Edit Key/Value';

        // Populate edit form with current values
        editKeyElement.value = editingKey;
        editValueElement.value = modalValueElement.textContent;

        // Disable key editing for existing keys (to maintain consistency)
        editKeyElement.disabled = true;

        isEditMode = true;
    }

    function resetEditState() {
        isEditMode = false;
        editingKey = null;
        editKeyElement.disabled = false;
        document.getElementById('edit-modal-title').textContent = 'Add New Key/Value';
        editForm.reset();
    }

    // --- Utility Functions ---
    function escapeHTML(str) {
        const p = document.createElement('p');
        p.textContent = str;
        return p.innerHTML;
    }

    // --- Initial Load ---
    fetchAndDisplayDBs();
});
