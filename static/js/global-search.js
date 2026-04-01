import { api, esc } from './api.js';
import { FileManager } from './file-manager.js';
import { highlightMatch } from './search-utils.js';

export const GlobalSearch = {
    dialog: null,
    input: null,
    resultsEl: null,
    caseSensitive: false,

    init() {
        const toolbar = document.querySelector('.file-toolbar');
        if (toolbar && !document.getElementById('btn-global-search')) {
            const btn = document.createElement('button');
            btn.id = 'btn-global-search';
            btn.textContent = 'SEARCH';
            btn.title = 'Global Search';
            btn.className = 'paper-btn small';
            btn.onclick = () => this.show();
            toolbar.appendChild(btn);
        }

        const dialog = document.createElement('dialog');
        dialog.id = 'globalSearchModal';
        dialog.className = 'paper-modal';
        // Sekarang aman pakai var() karena CSS variables global di :root
        dialog.innerHTML = `
            <div class="modal-box" style="height:80vh; display:flex; flex-direction:column;">
                <header class="modal-header">
                    <h3>⌕ FIND IN FILES</h3>
                    <button id="gs-close" class="paper-btn ghost">[ X ]</button>
                </header>
                <div class="file-toolbar">
                    <div style="display:flex; gap:6px; align-items:center; flex:1">
                        <input id="gs-input" placeholder="Cari di semua file..." style="flex:1; background:var(--bg); border:1px solid var(--border); border-radius:0; padding:8px 12px; color:var(--text); font-size:13px; outline:none; font-family:var(--mono)" />
                        <button id="gs-btn-case" title="Match case" style="background:var(--dark); border:1px solid var(--border); border-radius:0; padding:4px 8px; color:var(--cement); font-size:11px; cursor:pointer; font-family:var(--mono)">Aa</button>
                        <button id="gs-btn-search" class="paper-btn primary" style="padding:8px 14px; font-size:12px; font-family:var(--mono)">CARI</button>
                    </div>
                </div>
                <div id="gs-results" style="flex:1; overflow-y:auto; padding:4px 0; font-family:var(--mono)"></div>
            </div>
        `;
        document.body.appendChild(dialog);

        this.dialog = dialog;
        this.input = document.getElementById('gs-input');
        this.resultsEl = document.getElementById('gs-results');

        document.getElementById('gs-close').onclick = () => this.hide();
        dialog.addEventListener('click', (e) => { if (e.target === dialog) this.hide(); });
        this.input.onkeydown = (e) => { if (e.key === 'Enter') this.doSearch(); if (e.key === 'Escape') this.hide(); };
        document.getElementById('gs-btn-search').onclick = () => this.doSearch();
        
        document.getElementById('gs-btn-case').onclick = () => {
            this.caseSensitive = !this.caseSensitive;
            const btn = document.getElementById('gs-btn-case');
            btn.style.background = this.caseSensitive ? 'var(--surface)' : 'var(--dark)';
            btn.style.color = this.caseSensitive ? 'var(--accent)' : 'var(--cement)';
        };

        this.resultsEl.addEventListener('click', (e) => {
            const match = e.target.closest('.gs-match');
            if (match) { this.hide(); FileManager.openFileWithLine(match.dataset.file, parseInt(match.dataset.line)); return; }
            const header = e.target.closest('.gs-file-header');
            if (header) {
                const matches = header.nextElementSibling;
                if (matches) {
                    matches.classList.toggle('hidden');
                    header.querySelector('.gs-arrow').textContent = matches.classList.contains('hidden') ? '▸' : '▾';
                    header.style.borderLeftColor = matches.classList.contains('hidden') ? 'transparent' : 'var(--accent)';
                }
            }
        });
    },

    show() {
        if (!this.dialog) return;
        this.dialog.showModal();
        this.input.value = '';
        this.resultsEl.innerHTML = '';
        setTimeout(() => this.input.focus(), 50);
    },

    hide() { if (!this.dialog) return; this.dialog.close(); },

    async doSearch() {
        const q = this.input.value.trim(); if (!q) return;
        const btn = document.getElementById('gs-btn-search');
        btn.textContent = '···';
        this.resultsEl.innerHTML = '<div style="padding:20px;color:var(--cement);text-align:center">Mencari...</div>';
        const { ok, data } = await api.get(`/api/files/search?q=${encodeURIComponent(q)}&case=${this.caseSensitive ? '1' : '0'}`);
        btn.textContent = 'CARI';
        const results = (ok && data?.success) ? data.results : [];
        this.renderResults(results, q);
    },

    renderResults(results, q) {
        const total = results.reduce((s, r) => s + r.matches.length, 0);
        if (results.length === 0) {
            this.resultsEl.innerHTML = '<div style="padding:20px;color:var(--cement);text-align:center;font-size:12px">Tidak ada hasil</div>';
            return;
        }
        
        let html = `<div style="padding:4px 12px 8px;font-size:11px;color:var(--cement)">${total} hasil di ${results.length} file</div>`;
        
        results.forEach(({ file, matches }) => {
            const isExpanded = results.length <= 5;
            html += `<div>
                <div class="gs-file-header" data-file="${esc(file)}" style="display:flex;align-items:center;gap:6px;padding:4px 12px;cursor:pointer;border-left:2px solid ${isExpanded ? 'var(--accent)' : 'transparent'}">
                    <span style="color:var(--cement);font-size:10px" class="gs-arrow">${isExpanded ? '▾' : '▸'}</span>
                    <span style="font-size:11px;color:var(--accent);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(file)}</span>
                    <span style="font-size:9px;color:var(--cement);background:var(--dark);padding:1px 6px">${matches.length}</span>
                </div>
                <div class="${isExpanded ? '' : 'hidden'}" style="padding: 2px 0">
                    ${matches.map(m => {
                        const highlighted = highlightMatch(m.text, q, this.caseSensitive);
                        const styled = highlighted.replace('<mark>', '<mark style="background:rgba(255,107,53,.15);color:var(--accent);padding:0 2px">');
                        return `
                        <div class="gs-match" data-file="${esc(file)}" data-line="${m.line}" style="display:flex;gap:8px;padding:2px 12px 2px 28px;cursor:pointer">
                            <span style="font-size:10px;color:var(--cement);min-width:28px;text-align:right">${m.line}</span>
                            <span style="font-size:11px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${styled}</span>
                        </div>`;
                    }).join('')}
                </div></div>`;
        });

        this.resultsEl.innerHTML = html;
    }
};
