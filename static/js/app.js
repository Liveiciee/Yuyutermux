import { Terminal, Toast, StatusBar, Suggestions } from './terminal.js';
import { Storage } from './storage.js';
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
    const charCount = document.getElementById('inputCharCount');

    // ===== SPLASH SCREEN =====
    const splash = document.getElementById('splashScreen');
    const barFill = splash?.querySelector('.splash-bar-fill');
    const splashStatus = splash?.querySelector('.splash-status');
    const container = document.querySelector('.paper-container');

    const splashSteps = [
        { pct: '30%', text: 'Loading modules...' },
        { pct: '60%', text: 'Initializing terminal...' },
        { pct: '85%', text: 'Connecting to server...' },
        { pct: '100%', text: 'Ready!' }
    ];

    let stepIdx = 0;
    const advanceSplash = () => {
        if (stepIdx < splashSteps.length) {
            const step = splashSteps[stepIdx];
            barFill.style.width = step.pct;
            if (splashStatus) splashStatus.textContent = step.text;
            stepIdx++;
            if (stepIdx < splashSteps.length) {
                setTimeout(advanceSplash, 300 + Math.random() * 200);
            } else {
                setTimeout(() => {
                    splash?.classList.add('fade-out');
                    container?.classList.add('visible');
                    setTimeout(() => splash?.remove(), 600);
                }, 300);
            }
        }
    };

    if (barFill) barFill.classList.add('animate');
    setTimeout(advanceSplash, 200);

    // ===== INPUT AUTO-RESIZE =====
    cmdInput.addEventListener('input', () => {
        cmdInput.style.height = '22px';
        cmdInput.style.height = Math.min(cmdInput.scrollHeight, 120) + 'px';
        charCount.textContent = `${cmdInput.value.length} chars`;
    });

    // ===== TERMINAL COMMANDS =====
    document.getElementById('sendBtn').onclick = () => Terminal.run();
    cmdInput.onkeydown = (e) => {
        if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault();
            Terminal.run();
        }
    };

    // ===== CLEAR ALL =====
    document.getElementById('clearAllBtn').onclick = () => Terminal.clearAll();

    // ===== FILE MANAGER =====
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
    document.getElementById('modalRename').onclick = () => FileManager.renameFile();
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

    // ===== INIT MODULES =====
    ViewportFix.init();
    ModalKeyboard.init();
    ExtraKeys.init();
    Toast.init();
    StatusBar.init();
    Suggestions.init();
    Storage.load();
    Editor.init();
    GlobalSearch.init();

    // ===== PWA =====
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
        if (outcome === 'accepted') Toast.show('App installed!', 'success');
    };

    document.getElementById('pwaDismissBtn').onclick = () => {
        document.getElementById('pwaInstallPrompt').classList.add('hidden');
    };
});
