import { Storage } from './storage.js';
// === YUYU_INSERT_POINT ===
import { Terminal } from './terminal.js';
import { ExtraKeys } from './extra-keys.js';
import { FileManager } from './file-manager.js';
import { ModalKeyboard } from './modal-keyboard.js';
import { ViewportFix } from './viewport-fix.js';
import { Editor } from './editor.js';
import { GlobalSearch } from './global-search.js';

document.addEventListener('DOMContentLoaded', () => {
    const cmdInput = document.getElementById('cmdInput');
    const fileModal = document.getElementById('fileModal');
    const extraKeysPaper = document.getElementById('extraKeysPaper');

    // Auto-resize textarea (Gemini style)
    cmdInput.addEventListener('input', () => {
        cmdInput.style.height = '24px';
        cmdInput.style.height = cmdInput.scrollHeight + 'px';
    });

    // Terminal
    document.getElementById('sendBtn').onclick = () => Terminal.run();
    cmdInput.onkeydown = (e) => {
        if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault();
            Terminal.run();
        }
    };

    // File Manager
    document.getElementById('fileBrowser').addEventListener('click', (e) => {
        const item = e.target.closest('.file-item');
        if (!item) return;
        const { path, type } = item.dataset;
        
        if (e.target.closest('.file-del')) {
            e.stopPropagation();
            FileManager.deleteItem(path);
        } else if (e.target.closest('.file-download')) {
            e.stopPropagation();
            FileManager.downloadFile(path);
        } else {
            FileManager.openItem(path, type);
        }
    });

    // File Manager Modal
    document.getElementById('editFileBtn').onclick = () => { 
        fileModal.showModal(); 
        extraKeysPaper.classList.add('hidden'); 
        FileManager.load(''); 
    };
    
    document.getElementById('modalCancel').onclick = () => { 
        fileModal.close(); 
        extraKeysPaper.classList.remove('hidden'); 
    };
    
    document.getElementById('modalSave').onclick = () => FileManager.save();
    document.getElementById('modalNewFile').onclick = () => FileManager.createNew();
    document.getElementById('refreshFileListBtn').onclick = () => FileManager.load(FileManager.dir);
    document.getElementById('previewBtn').onclick = () => FileManager.showPreview();
    document.getElementById('previewClose').onclick = () => document.getElementById('previewModal').close();

    // Upload
    document.getElementById('uploadBtn').onclick = () => document.getElementById('uploadInput').click();
    document.getElementById('uploadInput').onchange = (e) => {
        if (e.target.files[0]) FileManager.uploadFile(e.target.files[0]);
        e.target.value = '';
    };

    // Global Keys
    document.addEventListener('keydown', (e) => { 
        if (e.key === 'Escape' && fileModal.open) {
            fileModal.close(); 
            extraKeysPaper.classList.remove('hidden');
        } 
    });

    // Init Modules
    ViewportFix.init();
    ModalKeyboard.init();
    ExtraKeys.init();
    Storage.load();
    Editor.init();
    GlobalSearch.init();

    // PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/static/service-worker.js').catch(() => {});
    }

    // PWA Install Prompt
    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        document.getElementById('pwaInstallPrompt').classList.remove('hidden');
    });

    document.getElementById('pwaInstallBtn').onclick = async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        document.getElementById('pwaInstallPrompt').classList.add('hidden');
        deferredPrompt = null;
    };

    document.getElementById('pwaDismissBtn').onclick = () => {
        document.getElementById('pwaInstallPrompt').classList.add('hidden');
    };
});
