import { api } from './api.js';
import { Terminal } from './terminal.js';

export const ExtraKeys = {
    defaults: [
        { label: 'TAB', value: '\t', type: 'insert' },
        { label: '|', value: '|', type: 'insert' },
        { label: '~', value: '~', type: 'insert' },
        { label: '/', value: '/', type: 'insert' },
        { label: '-', value: '-', type: 'insert' },
        { label: '_', value: '_', type: 'insert' },
        { label: '>', value: '>', type: 'insert' },
        { label: '<', value: '<', type: 'insert' },
        { label: '*', value: '*', type: 'insert' },
        { label: '$', value: '$', type: 'insert' },
        { label: 'CTRL+C', value: '', type: 'action', action: 'kill' },
        { label: 'ESC', value: '', type: 'action', action: 'clear' },
        { label: '↑', value: '', type: 'action', action: 'up' },
        { label: '↓', value: '', type: 'action', action: 'down' },
    ],

    init() {
        const row = document.getElementById('extraKeysRow');
        if (!row) return;
        row.innerHTML = '';
        this.defaults.forEach(k => {
            const btn = document.createElement('button');
            btn.className = 'extra-key' + (k.type === 'action' ? ' accent' : '');
            btn.textContent = k.label;
            btn.onclick = () => this.handle(k);
            row.appendChild(btn);
        });
    },

    handle(key) {
        const input = document.getElementById('cmdInput');
        input.focus();
        if (key.type === 'insert') {
            const start = input.selectionStart;
            const end = input.selectionEnd;
            const text = input.value;
            input.value = text.substring(0, start) + key.value + text.substring(end);
            input.selectionStart = input.selectionEnd = start + key.value.length;
            input.dispatchEvent(new Event('input'));
        } else if (key.type === 'action') {
            if (key.action === 'clear') { input.value = ''; input.style.height = '24px'; }
            else if (key.action === 'kill') api.post('/api/execute/kill');
            else if (key.action === 'up') Terminal.navUp();
            else if (key.action === 'down') Terminal.navDown();
        }
    }
};
