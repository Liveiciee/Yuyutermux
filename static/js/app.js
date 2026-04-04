import { Terminal, Toast, StatusBar, Suggestions } from './terminal.js'
import { Storage } from './storage.js'
import { ExtraKeys } from './extra-keys.js'
import { FileManager } from './file-manager.js'
import { ModalKeyboard } from './modal-keyboard.js'
import { Editor } from './editor.js'
import { GlobalSearch } from './global-search.js'
import { GitHub } from './github.js'
import { Auth } from './api.js'

/* ===== MOBILE DEBUG (NO DEVTOOLS) ===== */
window.onerror = function (msg, src, line, col, err) {
  alert("JS ERROR:\n" + msg + "\n" + src + ":" + line)
}
window.onunhandledrejection = function (e) {
  alert("PROMISE ERROR:\n" + (e.reason?.message || e.reason))
}

/* ===== INTERNAL STATE ===== */
let _cwdInterval = null
let _connectionInterval = {}

/* ===== BOOT ===== */
document.addEventListener('DOMContentLoaded', () => {
  alert("INIT START")

  try { initSplash(); alert("splash ok") } catch (e) { alert("splash fail") }
  try { initInput(); alert("input ok") } catch (e) { alert("input fail") }
  try { initModules(); alert("modules ok") } catch (e) { alert("modules fail") }
  try { initTerminal(); alert("terminal ok") } catch (e) { alert("terminal fail") }
  try { initFileManager(); alert("files ok") } catch (e) { alert("files fail") }
  try { initGitHub(); alert("github ok") } catch (e) { alert("github fail") }
  try { initPWA(); alert("pwa ok") } catch (e) { alert("pwa fail") }
  try { initAuth(); alert("auth ok") } catch (e) { alert("auth fail") }
  try { initShortcuts(); alert("shortcuts ok") } catch (e) { alert("shortcuts fail") }
})

/* ===== AUTH ===== */
function initAuth() {
  const logoutBtn = document.getElementById('logoutBtn')
  if (logoutBtn) {
    logoutBtn.onclick = () => {
      if (confirm('Logout? Session akan berakhir.')) Auth.logout()
    }
  }
}

/* ===== SPLASH ===== */
function initSplash() {
  const splash = document.getElementById('splashScreen')
  const container = document.querySelector('.paper-container')

  // FORCE UNLOCK (no waiting)
  setTimeout(() => {
    splash?.classList.add('fade-out')
    container?.classList.add('visible')
    setTimeout(() => splash?.remove(), 300)
  }, 300)
}

/* ===== INPUT ===== */
function initInput() {
  const cmdInput = document.getElementById('cmdInput')
  const charCount = document.getElementById('inputCharCount')
  if (!cmdInput || !charCount) return

  cmdInput.addEventListener('input', () => {
    cmdInput.style.height = '22px'
    cmdInput.style.height = Math.min(cmdInput.scrollHeight, 120) + 'px'
    charCount.textContent = `${cmdInput.value.length} chars`
  })
}

/* ===== TERMINAL ===== */
function initTerminal() {
  const sendBtn = document.getElementById('sendBtn')
  const clearBtn = document.getElementById('clearAllBtn')
  const cmdInput = document.getElementById('cmdInput')

  if (sendBtn) sendBtn.onclick = () => Terminal.run()
  if (clearBtn) clearBtn.onclick = () => Terminal.clearAll()

  if (cmdInput) {
    cmdInput.onkeydown = (e) => {
      if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault()
        Terminal.run()
      }
    }
  }

  const updateCwd = async () => {
    try {
      const res = await fetch('/api/execute/cwd', {
        credentials: 'same-origin'
      })
      if (res.ok) {
        const data = await res.json()
        if (res.status !== 401 && data.success && data.display) {
          const el = document.getElementById('statusDir')
          if (el) el.textContent = data.display
        }
      }
    } catch (e) {
      console.log("CWD FAIL", e)
    }
  }

  updateCwd()
  _cwdInterval = setInterval(updateCwd, 5000)
}

/* ===== FILE MANAGER ===== */
function initFileManager() {
  const fileModal = document.getElementById('fileModal')
  const extraKeysPaper = document.getElementById('extraKeysPaper')
  const browser = document.getElementById('fileBrowser')
  if (!fileModal || !browser) return

  browser.addEventListener('click', (e) => {
    const item = e.target.closest('.file-item')
    if (!item) return
    const { path, type } = item.dataset

    if (e.target.closest('.file-del')) {
      e.stopPropagation()
      FileManager.deleteItem(path)
    } else if (e.target.closest('.file-download')) {
      e.stopPropagation()
      FileManager.downloadFile(path)
    } else {
      FileManager.openItem(path, type)
    }
  })

  const editBtn = document.getElementById('editFileBtn')
  const modalCancel = document.getElementById('modalCancel')
  const modalSave = document.getElementById('modalSave')
  const modalNewFile = document.getElementById('modalNewFile')
  const modalRename = document.getElementById('modalRename')
  const refreshBtn = document.getElementById('refreshFileListBtn')
  const uploadInput = document.getElementById('uploadInput')

  if (editBtn) {
    editBtn.onclick = () => {
      try { fileModal.showModal() } catch { fileModal.show?.() || (fileModal.hidden = false) }
      extraKeysPaper?.classList.add('hidden')
      FileManager.load('')
    }
  }

  if (modalCancel) {
    modalCancel.onclick = () => {
      fileModal.close()
      extraKeysPaper?.classList.remove('hidden')
    }
  }

  if (modalSave) modalSave.onclick = () => FileManager.save()
  if (modalNewFile) modalNewFile.onclick = () => FileManager.createNew()
  if (modalRename) modalRename.onclick = () => FileManager.renameFile()
  if (refreshBtn) refreshBtn.onclick = () => FileManager.load(FileManager.dir)

  if (uploadInput) {
    uploadInput.onchange = (e) => {
      if (e.target.files[0]) FileManager.uploadFile(e.target.files[0])
      e.target.value = ''
    }
  }

  const globalSearchBtn = document.getElementById('btn-global-search')
  if (globalSearchBtn) globalSearchBtn.onclick = () => GlobalSearch.show()

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && fileModal.open) {
      fileModal.close()
      extraKeysPaper?.classList.remove('hidden')
    }
  })
}

/* ===== GITHUB ===== */
function initGitHub() {
  GitHub.init()
  const gitBtn = document.getElementById('gitBtn')
  if (gitBtn) gitBtn.addEventListener('click', () => GitHub.open())
}

/* ===== PWA ===== */
function initPWA() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/static/service-worker.js').catch(() => {})
  }
}

/* ===== MODULES ===== */
function initModules() {
  ModalKeyboard.init()
  ExtraKeys.init()
  Toast.init()
  StatusBar.init()
  Suggestions.init()
  Storage.load()
  Editor.init()
  GlobalSearch.init()
}

/* ===== SHORTCUTS ===== */
function initShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'k') {
      e.preventDefault()
      const input = document.getElementById('cmdInput')
      const charCount = document.getElementById('inputCharCount')
      if (!input) return
      if (document.activeElement !== input) input.focus()
      input.value = ''
      input.style.height = '22px'
      if (charCount) charCount.textContent = '0 chars'
    }
  })
}

/* ===== CLEANUP ===== */
window.addEventListener('beforeunload', () => {
  if (_cwdInterval) clearInterval(_cwdInterval)
  if (_connectionInterval?.interval) clearInterval(_connectionInterval.interval)
})
