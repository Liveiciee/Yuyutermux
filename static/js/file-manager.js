import { api, esc, SERVER_HINT_HTML, SERVER_HINT_TEXT } from './api.js';
import { Terminal } from './terminal.js';
import { Editor } from './editor.js';

const LANG_MAP = {
    py: 'python', js: 'javascript', sh: 'bash', html: 'html',
    htm: 'html', css: 'css', json: 'json', md: 'markdown'
// === YUYU_INSERT_POINT ===
};

export const FileManager = {
    dir: '',
    file: '',
    content: '',

    get el() {
        return {
            browser: document.getElementById('fileBrowser'),
            path: document.getElementById('currentPathDisplay'),
            editor: document.getElementById('modalContent')
        };
    },

    async load(path = '') {
        this.dir = path;
        this.el.browser.innerHTML = '<div style="padding:40px;text-align:center">LOADING...</div>';
        const { ok, data } = await api.get(`/api/files/list?path=${encodeURIComponent(path)}`);
        if (!ok) { this.el.browser.innerHTML = `<div style="padding:20px;color:#FF4D4D">ERROR: Failed to fetch${SERVER_HINT_HTML}</div>`; return; }
        if (data?.error) { this.el.browser.innerHTML = `<div style="padding:20px;color:#FF4D4D">ERROR: ${esc(data.error)}</div>`; return; }
        this.el.path.textContent = data.current_path || '/';
        this.render(data.items);
    },

    render(items) {
        let html = '';
        if (this.dir) {
            const parent = this.dir.split('/').slice(0, -1).join('/');
            html += `<div class="file-item" data-path="${esc(parent)}" data-type="directory"><span class="file-name">[ .. ] PARENT DIRECTORY</span></div>`;
        }
        items.forEach(item => {
            const icon = item.type === 'directory' ? '[ DIR ]' : '[ FILE ]';
            const size = item.type === 'file' ? ` (${item.size})` : '';
            html += `<div class="file-item" data-path="${esc(item.path)}" data-type="${item.type}">
                <span class="file-name">${icon} ${esc(item.name)}${size}</span>
                <div class="file-actions">${item.type === 'file' ? '<button class="file-download">⬇️</button>' : ''}<button class="file-del">🗑️</button></div></div>`;
        });
        this.el.browser.innerHTML = html || '<div style="padding:40px;text-align:center">[ EMPTY ]</div>';
    },

    async openItem(path, type) {
        if (type === 'directory') return this.load(path);
        this.file = path;
        this.el.editor.value = 'LOADING...';
        const { ok, data } = await api.post('/api/files/read', { path });
        if (!ok) { this.el.editor.value = `// ERROR: Failed to fetch${SERVER_HINT_TEXT}`; this.content = ''; return; }
        if (data?.error) { this.el.editor.value = `// ERROR: ${data.error}`; this.content = ''; return; }
        this.content = data.content || '';
        this.el.editor.value = this.content;
        Editor.onLoad();
    },

    downloadFile(path) { window.location.href = `/api/files/download?path=${encodeURIComponent(path)}`; },

    async deleteItem(path) {
        if (!confirm(`DELETE "${path.split('/').pop()}"?`)) return;
        const { ok, data } = await api.post('/api/files/delete', { path });
        if (ok && !data?.error) { this.load(this.dir); } else { alert(!ok ? 'Failed to connect to server' + SERVER_HINT_TEXT : (data?.error || 'Delete failed')); }
    },

    async save() {
        if (!this.file) return alert('SELECT FILE FIRST');
        const btn = document.getElementById('modalSave');
        const orig = btn.textContent;
        btn.textContent = '[ SAVING... ]'; btn.disabled = true;
        const { ok, data } = await api.post('/api/files/write', { path: this.file, content: this.el.editor.value });
        btn.disabled = false;
        if (ok && data?.success) {
            this.content = this.el.editor.value; btn.textContent = '[ SAVED! ]'; setTimeout(() => btn.textContent = orig, 1500);
            Terminal.log(`SAVE ${this.file.split('/').pop()} - FILE SAVED SUCCESSFULLY`);
        } else { btn.textContent = orig; alert(!ok ? 'Failed to connect to server' + SERVER_HINT_TEXT : (data?.error || 'Save failed')); }
    },

    async createNew() {
        const name = prompt('NEW FILENAME:'); if (!name) return;
        const { ok, data } = await api.post('/api/files/create', { path: this.dir, filename: name });
        if (ok && data?.success) { this.load(this.dir); } else { alert(!ok ? 'Failed to connect to server' + SERVER_HINT_TEXT : (data?.error || 'Create failed')); }
    },

    async uploadFile(file) {
        const formData = new FormData(); formData.append('file', file); formData.append('path', this.dir);
        const btn = document.getElementById('uploadBtn'); btn.textContent = '[ UPLOADING... ]'; btn.disabled = true;
        try {
            const res = await fetch('/api/files/upload', { method: 'POST', body: formData });
            const data = await res.json();
            if (res.ok && data.success) { Terminal.log(`UPLOAD ${file.name} - Upload successful`); this.load(this.dir); }
            else { alert(!res.ok ? 'Failed to connect to server' + SERVER_HINT_TEXT : (data.error || 'Upload failed')); }
        } catch (err) { alert('Failed to connect to server' + SERVER_HINT_TEXT); }
        btn.textContent = '[ UPLOAD ]'; btn.disabled = false;
    },

    showPreview() {
        const code = this.el.editor.value; if (!code) return;
        const ext = this.file?.split('.').pop()?.toLowerCase() || '';
        const block = document.getElementById('previewCode');
        block.className = `language-${LANG_MAP[ext] || 'plaintext'}`; block.textContent = code;
        delete block.dataset.highlighted; hljs.highlightElement(block);
        document.getElementById('previewModal').showModal();
    },

    async openFileWithLine(filepath, targetLine) {
        const modal = document.getElementById('fileModal');
        if (!modal.open) modal.showModal();
        this.file = filepath;
        const editor = document.getElementById('modalContent');
        editor.value = 'LOADING...';
        const { ok, data } = await api.post('/api/files/read', { path: filepath });
        if (!ok || data?.error) { editor.value = `// ERROR: ${data?.error || 'Failed to load'}`; return; }
        this.content = data.content || '';
        editor.value = this.content;
        Editor.updateGutter();

        setTimeout(() => {
            const lines = editor.value.split('\n');
            if (targetLine < 1 || targetLine > lines.length) return;
            const lineHeight = parseInt(getComputedStyle(editor).lineHeight) || 20;
            editor.scrollTop = (targetLine - 1) * lineHeight;
            let startPos = 0;
            for (let i = 0; i < targetLine - 1; i++) { startPos += lines[i].length + 1; }
            const endPos = startPos + lines[targetLine - 1].length;
            editor.focus(); editor.setSelectionRange(startPos, endPos);
            const originalBg = editor.style.backgroundColor;
            editor.style.backgroundColor = 'rgba(167,139,250,0.2)';
            setTimeout(() => { editor.style.backgroundColor = originalBg; }, 1000);
        }, 100);
    }
// === YUYU_INSERT_POINT ===
};
