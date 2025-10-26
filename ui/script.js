document.addEventListener('DOMContentLoaded', () => {
    const DEBUG = false;
    const dlog = (...args) => { if (DEBUG) console.log(...args); };
    // --- DOM Element Caching ---
    const appContainer = document.getElementById('app-container');
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
    let keysAbortController = null;
    let lastFocusBeforeView = null;
    let lastFocusBeforeEdit = null;
    let lastFocusBeforeConfirm = null;

    // Pagination state
    let paginationHistory = [];
    let currentStartKey = null;
    let currentPrefix = '';

    // --- Event Listeners ---
    if (dbNavToggle && appContainer) {
        // Restore nav collapsed state
        const savedCollapsed = localStorage.getItem('navCollapsed');
        if (savedCollapsed === 'true') {
            appContainer.classList.add('nav-collapsed');
            dbNavToggle.setAttribute('aria-expanded', 'false');
        } else {
            dbNavToggle.setAttribute('aria-expanded', 'true');
        }

        dbNavToggle.addEventListener('click', () => {
            const collapsed = appContainer.classList.toggle('nav-collapsed');
            dbNavToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            localStorage.setItem('navCollapsed', String(collapsed));
        });
    }

    if (modal && modalCloseBtn) {
        const closeViewModal = () => {
            modal.classList.add('hidden');
            if (lastFocusBeforeView && typeof lastFocusBeforeView.focus === 'function') {
                lastFocusBeforeView.focus();
            }
        };
        modalCloseBtn.addEventListener('click', closeViewModal);
        modal.addEventListener('click', (e) => { if (e.target === modal) closeViewModal(); });
        // Add keyboard support
        modal.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeViewModal();
        });
    }

    if (editModal && editModalCloseBtn) {
        const closeEditModal = () => {
            editModal.classList.add('hidden');
            resetEditState();
            if (lastFocusBeforeEdit && typeof lastFocusBeforeEdit.focus === 'function') {
                lastFocusBeforeEdit.focus();
            }
        };
        editModalCloseBtn.addEventListener('click', closeEditModal);
        editModal.addEventListener('click', (e) => { if (e.target === editModal) closeEditModal(); });
        editModal.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeEditModal();
        });
    }

    if (editForm) {
        editForm.addEventListener('submit', handleSetKey);
    }

    if (editFromViewBtn) {
        editFromViewBtn.addEventListener('click', (e) => { lastFocusBeforeEdit = e.currentTarget; handleEditFromView(); });
    }

    if (confirmModal) {
        const closeConfirm = () => {
            confirmModal.classList.add('hidden');
            confirmDeleteBtn.onclick = null; // Clear the handler
            if (lastFocusBeforeConfirm && typeof lastFocusBeforeConfirm.focus === 'function') {
                lastFocusBeforeConfirm.focus();
            }
        };
        confirmModalCloseBtn.addEventListener('click', closeConfirm);
        confirmCancelBtn.addEventListener('click', closeConfirm);
        confirmModal.addEventListener('click', (e) => {
            if (e.target === confirmModal) {
                closeConfirm();
            }
        });

        // Add keyboard support
        confirmModal.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeConfirm();
            } else if (e.key === 'Enter' && confirmDeleteBtn.onclick) {
                // Only trigger delete if Enter is pressed and there's an active handler
                confirmDeleteBtn.click();
            }
        });
    }

    // --- Core Functions ---

    async function fetchAndDisplayDBs() {
        try {
            dbListElement.innerHTML = '<li style="color:#888;">Loading databases...</li>';
            const response = await fetch(new URL('/api/dbs', window.location.origin), { credentials: 'same-origin' });
            if (!response.ok) throw new Error(`Network response was not ok: ${response.statusText}`);
            const dbNames = await response.json();

            dbListElement.innerHTML = '';
            if (!dbNames || dbNames.length === 0) {
                dbListElement.innerHTML = '<li style="color: #888;">No databases found.</li>';
                return;
            }

            dbNames.forEach(name => {
                const li = document.createElement('li');
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.textContent = name;
                btn.setAttribute('aria-label', `Open database ${name}`);
                btn.addEventListener('click', () => handleDbSelection(name, li));
                li.dataset.dbName = name;
                li.appendChild(btn);
                dbListElement.appendChild(li);
            });
        } catch (error) {
            console.error('Error fetching database list:', error);
            dbListElement.innerHTML = '<li style="color: #ff5555;">Error loading databases.</li>';
        }
    }

    function handleDbSelection(dbName, liElement) {
        if (activeDbLiElement) {
            activeDbLiElement.classList.remove('active');
            const prevBtn = activeDbLiElement.querySelector('button');
            if (prevBtn) prevBtn.removeAttribute('aria-current');
        }

        liElement.classList.add('active');
        const currentBtn = liElement.querySelector('button');
        if (currentBtn) currentBtn.setAttribute('aria-current', 'true');
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
            dlog(`[DEBUG] Fetching keys with URL: ${url}`);

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

            // show loading if container present
            const kvc = document.getElementById('key-value-container');
            if (kvc) kvc.innerHTML = '<div class="empty-state">Loading keys...</div>';

            if (keysAbortController) {
                try { keysAbortController.abort(); } catch (_) {}
            }
            keysAbortController = new AbortController();

            const response = await fetch(url, { signal: keysAbortController.signal, credentials: 'same-origin' });
            if (!response.ok) throw new Error(`API response was not ok: ${response.statusText}`);

            const data = await response.json();
            dlog(`[DEBUG] Received data.keys.length: ${data.keys ? data.keys.length : 'null'}`);
            renderKeyView(dbName, data.keys || [], data.next_key, newPrefix, options.startKey);
        } catch (error) {
            if (error.name === 'AbortError') {
                dlog('Previous keys request aborted');
                return;
            }
            console.error(`Error fetching keys for ${dbName}:`, error);
            if (dataViewElement) dataViewElement.innerHTML = `<p style="color: #ff5555;">Error loading keys.</p>`;
        }
    }

    function renderKeyView(dbName, keys, nextKey, currentPrefix = '', startKey = null) {
        let keyTableHTML = '<p class="empty-state">No keys found.</p>';
        if (keys.length > 0) {
            keyTableHTML = `
                <table class="key-table">
                    <tbody>
                        ${keys.map(keyStr => `
                            <tr>
                                <td class="key-cell" title="${escapeHTML(keyStr)}">${escapeHTML(keyStr)}</td>
                                <td>
                                    <button class="action-btn" data-action="view" data-db="${dbName}" data-key="${escapeHTML(keyStr)}" title="View key" aria-label="View key ${escapeHTML(keyStr)}"></button>
                                    <button class="action-btn" data-action="delete" data-db="${dbName}" data-key="${escapeHTML(keyStr)}" title="Delete key" aria-label="Delete key ${escapeHTML(keyStr)}"></button>
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

        // Determine if Previous/Next buttons should be enabled
        const hasPrevious = paginationHistory.length > 0;
        const canNext = Boolean(nextKey) && keys.length > 0;

        const topPaginationHTML = `
            <div class="pagination pagination-top">
                <button class="prev-page-btn" ${!hasPrevious ? 'disabled' : ''}>←</button>
                <button class="next-page-btn" ${!canNext ? 'disabled' : ''} ${canNext ? `data-next-key="${escapeHTML(nextKey)}"` : ''}>→</button>
            </div>`;

        const bottomPaginationHTML = `
            <div class="pagination">
                <button class="prev-page-btn" ${!hasPrevious ? 'disabled' : ''}>← Previous</button>
                <button class="next-page-btn" ${!canNext ? 'disabled' : ''} ${canNext ? `data-next-key="${escapeHTML(nextKey)}"` : ''}>Next →</button>
            </div>`;

        dataViewElement.innerHTML = `
            <div class="db-header">
                <h3>${dbName}</h3>
                <div class="db-actions">
                    <input type="text" id="search-key-input" placeholder="Search by key prefix..." value="${escapeHTML(searchInputValue)}">
                    <button id="add-key-btn">Add Key</button>
                </div>
            </div>
            <div class="table-controls">
                <span class="table-label">Keys</span>
                ${topPaginationHTML}
            </div>
            <div id="key-value-container">${keyTableHTML}</div>
            ${bottomPaginationHTML}`;

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
                dlog(`[DEBUG] Input event. activeDb: ${activeDb}, searchValue: "${e.target.value}"`);
                clearTimeout(searchDebounceTimer);
                searchDebounceTimer = setTimeout(() => {
                    if (!activeDb) return;
                    paginationHistory = [];
                    currentStartKey = null;
                    fetchAndDisplayKeys(dbName, { prefix: e.target.value });
                }, 300);
            });

            // Enter to search immediately, Escape to clear
            newSearchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    clearTimeout(searchDebounceTimer);
                    paginationHistory = [];
                    currentStartKey = null;
                    fetchAndDisplayKeys(dbName, { prefix: e.target.value });
                } else if (e.key === 'Escape') {
                    if (newSearchInput.value) {
                        newSearchInput.value = '';
                        paginationHistory = [];
                        currentStartKey = null;
                        fetchAndDisplayKeys(dbName, { prefix: '' });
                    }
                }
            });
        }

        // Note: event handlers for actions are delegated globally (see below)
    }

    async function handleSetKey(e) {
        e.preventDefault();
        if (!activeDb) return;

        const key = editKeyElement.value;
        const value = editValueElement.value;
        if (!key) return alert('Key cannot be empty.');

        try {
            const saveBtn = document.getElementById('save-kv-btn');
            if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }
            const url = new URL(`/api/db/${activeDb}/key`, window.location.origin);
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
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
        finally {
            const saveBtn = document.getElementById('save-kv-btn');
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
        }
    }

    async function handleDeleteKey(dbName, key, buttonElement) {
        lastFocusBeforeConfirm = buttonElement;
        confirmModalText.textContent = `Are you sure you want to delete the key "${key}"? This action cannot be undone.`;
        confirmModal.classList.remove('hidden');

        // Focus the cancel button for better accessibility
        setTimeout(() => confirmCancelBtn.focus(), 100);

        confirmDeleteBtn.onclick = async () => {
            try {
                // Add loading state
                confirmDeleteBtn.disabled = true;
                confirmDeleteBtn.textContent = 'Deleting...';

                const url = new URL(`/api/db/${dbName}/key/${encodeURIComponent(key)}`, window.location.origin);
                const response = await fetch(url, { method: 'DELETE', credentials: 'same-origin' });

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
            const url = new URL(`/api/db/${dbName}/key/${encodeURIComponent(key)}`, window.location.origin);
            const response = await fetch(url, { credentials: 'same-origin' });
            if (!response.ok) throw new Error(`API Error: ${response.status} ${await response.text()}`);

            const data = await response.json();
            modalKeyElement.textContent = data.key;
            modalValueElement.textContent = data.value;
            editingKey = data.key;
            modal.classList.remove('hidden');
            const focusTarget = modal.querySelector('.modal-content');
            if (focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus();
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
        const focusTarget = editModal.querySelector('.modal-content');
        if (focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus();
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

    // Delegated events for actions within data view
    if (dataViewElement) {
        dataViewElement.addEventListener('click', (e) => {
            const actionBtn = e.target.closest('.action-btn');
            if (actionBtn) {
                const action = actionBtn.dataset.action;
                const db = actionBtn.dataset.db;
                const key = actionBtn.dataset.key;
                if (action === 'view') {
                    lastFocusBeforeView = e.target;
                    handleViewKey(db, key);
                } else if (action === 'delete') {
                    handleDeleteKey(db, key, actionBtn);
                }
                return;
            }

            const addKeyBtn = e.target.closest('#add-key-btn');
            if (addKeyBtn) {
                lastFocusBeforeEdit = addKeyBtn;
                document.getElementById('edit-modal-title').textContent = 'Add New Key/Value';
                editForm.reset();
                editKeyElement.disabled = false;
                isEditMode = false;
                editingKey = null;
                editModal.classList.remove('hidden');
                const focusTarget = editModal.querySelector('.modal-content');
                if (focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus();
                return;
            }

            const prevBtn = e.target.closest('.prev-page-btn');
            if (prevBtn && !prevBtn.disabled && paginationHistory.length > 0) {
                const previousPage = paginationHistory.pop();
                currentStartKey = previousPage.startKey;
                currentPrefix = previousPage.prefix;
                fetchAndDisplayKeys(activeDb, { startKey: previousPage.startKey, prefix: previousPage.prefix });
                return;
            }

            const nextBtn = e.target.closest('.next-page-btn');
            if (nextBtn && !nextBtn.disabled) {
                const nk = nextBtn.getAttribute('data-next-key');
                fetchAndDisplayKeys(activeDb, { startKey: nk, prefix: currentPrefix });
                return;
            }
        });
    }
});
