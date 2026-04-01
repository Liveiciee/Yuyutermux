export const Storage = {
    KEY: 'yuyu_terminal_history',
    
    save() {
        const entries = document.querySelectorAll('#outputArea .output-entry');
        if (entries.length === 0) return;
        const html = Array.from(entries).slice(-30).map(e => e.outerHTML).join('');
        localStorage.setItem(this.KEY, html);
    },

    load() {
        const html = localStorage.getItem(this.KEY);
        if (html) {
            const area = document.getElementById('outputArea');
            area.innerHTML = html;
            this.rebindEvents();
        }
    },

    rebindEvents() {
        document.querySelectorAll('#outputArea .output-entry').forEach(entry => {
            const pre = entry.querySelector('pre');
            const copyBtn = entry.querySelector('.act-copy');
            const delBtn = entry.querySelector('.act-del');
            
            if (copyBtn) {
                copyBtn.onclick = function() {
                    if(pre) navigator.clipboard.writeText(pre.textContent).then(() => this.textContent = '[ OK ]');
                };
            }
            if (delBtn) {
                delBtn.onclick = () => entry.remove();
            }
        });
    }
};
