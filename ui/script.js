document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Element Caching ---
    const dbListElement = document.getElementById('db-list');
    const welcomeMessageElement = document.getElementById('welcome-message');
    const dataViewElement = document.getElementById('data-view');
    
    const modal = document.getElementById('view-modal');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    const modalKeyElement = document.getElementById('modal-key');
    const modalValueElement = document.getElementById('modal-value');

    const editModal = document.getElementById('edit-modal');
    const editModalCloseBtn = document.getElementById('edit-modal-close-btn');
    const editForm = document.getElementById('edit-form');
    const editKeyElement = document.getElementById('edit-key');
    const editValueElement = document.getElementById('edit-value');

    // --- State ---
    let activeDb = null;
    let activeDbLiElement = null;
    let searchDebounceTimer;

    // --- Event Listeners ---
    if (modal && modalCloseBtn) {
        modalCloseBtn.addEventListener('click', () => modal.classList.add('hidden'));
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.add('hidden');
        });
    }

    if (editModal && editModalCloseBtn) {
        editModalCloseBtn.addEventListener('click', () => editModal.classList.add('hidden'));
        editModal.addEventListener('click', (e) => {
            if (e.target === editModal) editModal.classList.add('hidden');
        });
    }

    if (editForm) {
        editForm.addEventListener('submit', handleSetKey);
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
        
        fetchAndDisplayKeys(dbName);
    }

    async function fetchAndDisplayKeys(dbName, options = {}) {
        try {
            const url = new URL(`/api/db/${dbName}/keys`, window.location.origin);
            if (options.startKey) url.searchParams.append('start', options.startKey);
            if (options.prefix) url.searchParams.append('prefix', options.prefix);

            const response = await fetch(url);
            if (!response.ok) throw new Error(`API response was not ok: ${response.statusText}`);
            
            const data = await response.json();
            renderKeyView(dbName, data.keys || [], data.next_key, options.prefix);
        } catch (error) {
            console.error(`Error fetching keys for ${dbName}:`, error);
            if (dataViewElement) dataViewElement.innerHTML = `<p style="color: #ff5555;">Error loading keys.</p>`;
        }
    }

    function renderKeyView(dbName, keys, nextKey, currentPrefix = '') {
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
                                    <button class="action-btn" data-action="view" data-db="${dbName}" data-key="${escapeHTML(keyStr)}">View</button>
                                    <button class="action-btn" data-action="delete" data-db="${dbName}" data-key="${escapeHTML(keyStr)}">Delete</button>
                                </td>
                            </tr>`).join('')}
                    </tbody>
                </table>`;
        }

        dataViewElement.innerHTML = `
            <div class="db-header">
                 <h3>${dbName}</h3>
                 <div class="db-actions">
                    <input type="text" id="search-key-input" placeholder="Search by key prefix..." value="${escapeHTML(currentPrefix || '')}">
                    <button id="add-key-btn">Add Key</button>
                 </div>
            </div>
            <div id="key-value-container">${keyTableHTML}</div>
            <div class="pagination">
                <button id="next-page-btn" ${!nextKey ? 'disabled' : ''}>Next →</button>
            </div>`;

        // Add event listeners for the newly rendered content
        const nextBtn = document.getElementById('next-page-btn');
        if (nextBtn && nextKey) {
            nextBtn.addEventListener('click', () => fetchAndDisplayKeys(dbName, { startKey: nextKey, prefix: currentPrefix }));
        }

        const searchInput = document.getElementById('search-key-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                clearTimeout(searchDebounceTimer);
                searchDebounceTimer = setTimeout(() => {
                    fetchAndDisplayKeys(dbName, { prefix: e.target.value });
                }, 300);
            });
        }

        document.getElementById('add-key-btn').addEventListener('click', () => {
            document.getElementById('edit-modal-title').textContent = 'Add New Key/Value';
            editForm.reset();
            editKeyElement.disabled = false;
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
                fetchAndDisplayKeys(activeDb, { prefix: document.getElementById('search-key-input').value });
            } else {
                throw new Error(`API Error: ${response.status} ${await response.text()}`);
            }
        } catch (error) {
            console.error('Error setting key:', error);
            alert('Could not save key-value pair. See console for details.');
        }
    }

    async function handleDeleteKey(dbName, key, buttonElement) {
        if (!confirm(`Are you sure you want to delete the key "${key}"?`)) return;

        try {
            const response = await fetch(`/api/db/${dbName}/key/${encodeURIComponent(key)}`, { method: 'DELETE' });

            if (response.status === 204) {
                buttonElement.closest('tr')?.remove();
            } else {
                throw new Error(`API Error: ${response.status} ${await response.text()}`);
            }
        } catch (error) {
            console.error('Error deleting key:', error);
            alert('Could not delete key. See console for details.');
        }
    }

    async function handleViewKey(dbName, key) {
        try {
            const response = await fetch(`/api/db/${dbName}/key/${encodeURIComponent(key)}`);
            if (!response.ok) throw new Error(`API Error: ${response.status} ${await response.text()}`);
            
            const data = await response.json();
            modalKeyElement.textContent = data.key;
            modalValueElement.textContent = data.value;
            modal.classList.remove('hidden');
        } catch (error) {
            console.error('Error fetching key value:', error);
            alert('Could not load key value. See console for details.');
        }
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
