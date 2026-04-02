import { api, esc, SERVER_HINT_HTML, SERVER_HINT_TEXT, getFileIcon } from './api.js';
import { Terminal, Toast } from './terminal.js';
import { Editor } from './editor.js';

const LANG_MAP = {
    py: 'python', js: 'javascript', ts: 'typescript', sh: 'bash', html: 'html',
    htm: 'html', css: 'css', json: 'json', md: 'markdown', yaml: 'yaml',
    yml: 'yaml', toml: 'toml', cfg: 'ini'
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
        this.el.browser.innerHTML = '<div class="file-item"><span class="file-name" style="color:var(--cement)">Loading...</span></div>';
        const { ok, data } = await api.get(`/api/files/list?path=${encodeURIComponent(path)}`);
        if (!ok) { this.el.browser.innerHTML = `<div class="file-item" style="border-left:2px solid var(--danger)"><span class="file-name" style="color:var(--danger)">ERROR: Failed to fetch${SERVER_HINT_HTML}</span></div>`; return; }
        if (data?.error) { this.el.browser.innerHTML = `<div class="file-item" style="border-left:2px solid var(--danger)"><span class="file-name" style="color:var(--danger)">ERROR: ${esc(data.error)}</span></div>`; return; }
        this.el.path.textContent = data.current_path || '~/Yuyutermux';
        this.render(data.items);
    },

    render(items) {
        let html = '';
        if (this.dir) {
            const parent = this.dir.split('/').slice(0, -1).join('/');
            html += `<div class="file-item" data-path="${esc(parent)}" data-type="directory">
                <span class="file-name"><span class="file-icon dir">📁</span> ..</span>
                <span class="file-size">PARENT</span></div>`;
        }
        items.forEach(item => {
            const icon = getFileIcon(item.name, item.type === 'directory');
            const size = item.type === 'file' ? item.size : '';
            const isActive = this.file === item.path ? ' active-file' : '';
            html += `<div class="file-item${isActive}" data-path="${esc(item.path)}" data-type="${item.type}">
                <span class="file-name">
                    <span class="file-icon ${icon.cls}">${icon.icon}</span>
                    ${esc(item.name)}
                </span>
                <span class="file-size">${size}</span>
                <div class="file-actions">
                    ${item.type === 'file' ? '<button class="file-download">↓</button>' : ''}
                    <button class="file-del">×</button>
                </div>
            </div>`;
        });
        this.el.browser.innerHTML = html || '<div class="file-item"><span class="file-name" style="color:var(--cement);justify-content:center;display:flex">EMPTY DIRECTORY</span></div>';
    },

    async openItem(path, type) {
        if (type === 'directory') return this.load(path);
        this.file = path;
        this.el.editor.value = 'Loading...';

        // Update editor header
        const name = path.split('/').pop();
        const ext = name.split('.').pop()?.toLowerCase() || '';
        document.getElementById('editorFileName').textContent = name;
        document.getElementById('editorLang').textContent = LANG_MAP[ext] || ext || 'text';

        // Show rename button
        document.getElementById('modalRename').classList.remove('hidden');

        const { ok, data } = await api.post('/api/files/read', { path });
        if (!ok) {
            this.el.editor.value = `// ERROR: Failed to fetch${SERVER_HINT_TEXT}`;
            this.content = '';
            return;
        }
        if (data?.error) {
            this.el.editor.value = `// ERROR: ${data.error}`;
            this.content = '';
            return;
        }
        this.content = data.content || '';
        this.el.editor.value = this.content;
        Editor.onLoad();

        // Re-render file list to show active file
        this.load(this.dir);
    },

    downloadFile(path) {
        Toast.show('Downloading...', 'info');
        window.location.href = `/api/files/download?path=${encodeURIComponent(path)}`;
    },

    async deleteItem(path) {
        const name = path.split('/').pop();
        if (!confirm(`Delete "${name}"?`)) return;
        const { ok, data } = await api.post('/api/files/delete', { path });
        if (ok && !data?.error) {
            Toast.show(`Deleted: ${name}`, 'success');
            this.load(this.dir);
            if (this.file === path) {
                this.file = '';
                this.content = '';
                this.el.editor.value = '';
                document.getElementById('editorFileName').textContent = 'No file selected';
                document.getElementById('editorLang').textContent = '—';
                document.getElementById('modalRename').classList.add('hidden');
            }
        } else {
            Toast.show(!ok ? 'Connection failed' : (data?.error || 'Delete failed'), 'error');
        }
    },

    async save() {
        if (!this.file) return Toast.show('Select a file first', 'warning');
        const btn = document.getElementById('modalSave');
        const orig = btn.innerHTML;
        btn.innerHTML = 'SAVING...';
        btn.disabled = true;
        const { ok, data } = await api.post('/api/files/write', { path: this.file, content: this.el.editor.value });
        btn.disabled = false;
        if (ok && data?.success) {
            this.content = this.el.editor.value;
            btn.innerHTML = '✓ SAVED';
            Toast.show(`${this.file.split('/').pop()} saved`, 'success');
            Terminal.log(`SAVE ${this.file.split('/').pop()} — File saved successfully`);
            setTimeout(() => btn.innerHTML = orig, 1500);
        } else {
            btn.innerHTML = orig;
            Toast.show(!ok ? 'Connection failed' : (data?.error || 'Save failed'), 'error');
        }
    },

    async createNew() {
        const name = prompt('New filename:');
        if (!name) return;
        const { ok, data } = await api.post('/api/files/create', { path: this.dir, filename: name });
        if (ok && data?.success) {
            Toast.show(`Created: ${name}`, 'success');
            this.load(this.dir);
        } else {
            Toast.show(!ok ? 'Connection failed' : (data?.error || 'Create failed'), 'error');
        }
    },

    async renameFile() {
        if (!this.file) return;
        const oldName = this.file.split('/').pop();
        const newName = prompt(`Rename "${oldName}" to:`, oldName);
        if (!newName || newName === oldName) return;
        const parent = this.file.substring(0, this.file.lastIndexOf('/'));
        const newPath = parent + '/' + newName;

        // Read current content, write to new path, delete old
        const { ok: readOk, data: readData } = await api.post('/api/files/read', { path: this.file });
        if (!readOk || readData?.error) { Toast.show('Failed to read file', 'error'); return; }

        const { ok: writeOk } = await api.post('/api/files/write', { path: newPath, content: readData.content });
        if (!writeOk) { Toast.show('Failed to write new file', 'error'); return; }

        const { ok: delOk } = await api.post('/api/files/delete', { path: this.file });
        if (!delOk) { Toast.show('Failed to delete old file', 'error'); return; }

        this.file = newPath;
        this.content = readData.content;
        document.getElementById('editorFileName').textContent = newName;
        Toast.show(`Renamed to ${newName}`, 'success');
        this.load(this.dir);
    },

    async uploadFile(file) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('path', this.dir);
        const btn = document.getElementById('uploadBtn');
        const orig = btn.innerHTML;
        btn.innerHTML = 'UPLOADING...';
        btn.disabled = true;
        try {
            const res = await fetch('/api/files/upload', { method: 'POST', body: formData });
            const data = await res.json();
            if (res.ok && data.success) {
                Toast.show(`Uploaded: ${file.name}`, 'success');
                Terminal.log(`UPLOAD ${file.name} — Upload successful`);
                this.load(this.dir);
            } else {
                Toast.show(data.error || 'Upload failed', 'error');
            }
        } catch {
            Toast.show('Connection failed', 'error');
        }
        btn.innerHTML = orig;
        btn.disabled = false;
    },

    showPreview() {
        const code = this.el.editor.value;
        if (!code) return Toast.show('No content to preview', 'warning');
        const ext = this.file?.split('.').pop()?.toLowerCase() || '';
        const block = document.getElementById('previewCode');
        block.className = `language-${LANG_MAP[ext] || 'plaintext'}`;
        block.textContent = code;
        delete block.dataset.highlighted;
        hljs.highlightElement(block);
        document.getElementById('previewModal').showModal();
    },

    async openFileWithLine(filepath, targetLine) {
        const modal = document.getElementById('fileModal');
        if (!modal.open) {
            modal.showModal();
            document.getElementById('extraKeysPaper')?.classList.add('hidden');
        }
        this.file = filepath;
        const editor = document.getElementById('modalContent');
        editor.value = 'Loading...';

        const name = filepath.split('/').pop();
        const ext = name.split('.').pop()?.toLowerCase() || '';
        document.getElementById('editorFileName').textContent = name;
        document.getElementById('editorLang').textContent = LANG_MAP[ext] || ext || 'text';
        document.getElementById('modalRename').classList.remove('hidden');

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
            for (let i = 0; i < targetLine - 1; i++) startPos += lines[i].length + 1;
            const endPos = startPos + lines[targetLine - 1].length;
            editor.focus();
            editor.setSelectionRange(startPos, endPos);
            // Highlight line briefly
            const originalBg = editor.style.backgroundColor;
            editor.style.backgroundColor = 'rgba(255,107,53,0.15)';
            setTimeout(() => { editor.style.backgroundColor = originalBg; }, 1000);
        }, 100);
    }
};
