import { Terminal, Toast, StatusBar, Suggestions } from './terminal.js'
import { Storage } from './storage.js'
import { ExtraKeys } from './extra-keys.js'
import { FileManager } from './file-manager.js'
import { ModalKeyboard } from './modal-keyboard.js'
import { Editor } from './editor.js'
import { GlobalSearch } from './global-search.js'
import { GitHub } from './github.js'
import { Auth } from './api.js'

document.addEventListener('DOMContentLoaded', () => {
  initSplash()
  initInput()
  initTerminal()
  initFileManager()
  initGitHub()
  initPWA()
  initModules()
  initAuth()
})

function initAuth() {
  const logoutBtn = document.getElementById('logoutBtn')
  if (logoutBtn) {
    logoutBtn.style.display = ''
    logoutBtn.onclick = () => {
      if (confirm('Logout? Session akan berakhir.')) {
        Auth.logout()
      }
    }
  }
}

function initSplash() {
  const splash = document.getElementById('splashScreen')
  const barFill = splash?.querySelector('.splash-bar-fill')
  const splashStatus = splash?.querySelector('.splash-status')
  const container = document.querySelector('.paper-container')

  const steps = [
    { pct: '30%', text: 'Loading modules...' },
    { pct: '60%', text: 'Initializing terminal...' },
    { pct: '85%', text: 'Connecting to server...' },
    { pct: '100%', text: 'Ready!' }
  ]

  let idx = 0
  const advance = () => {
    if (idx >= steps.length) return

    const step = steps[idx]
    barFill.style.width = step.pct
    if (splashStatus) splashStatus.textContent = step.text
    idx++

    if (idx < steps.length) {
      setTimeout(advance, 300 + Math.random() * 200)
    } else {
      setTimeout(() => {
        splash?.classList.add('fade-out')
        container?.classList.add('visible')
        setTimeout(() => splash?.remove(), 600)
      }, 300)
    }
  }

  if (barFill) barFill.classList.add('animate')
  setTimeout(advance, 200)
}

function initInput() {
  const cmdInput = document.getElementById('cmdInput')
  const charCount = document.getElementById('inputCharCount')

  cmdInput.addEventListener('input', () => {
    cmdInput.style.height = '22px'
    cmdInput.style.height = Math.min(cmdInput.scrollHeight, 120) + 'px'
    charCount.textContent = `${cmdInput.value.length} chars`
  })
}

function initTerminal() {
  const cmdInput = document.getElementById('cmdInput')

  document.getElementById('sendBtn').onclick = () => Terminal.run()
  cmdInput.onkeydown = (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault()
      Terminal.run()
    }
  }

  document.getElementById('clearAllBtn').onclick = () => Terminal.clearAll()

  // Live cwd in status bar - poll every 2 seconds
  const updateCwd = async () => {
    try {
      const res = await fetch('/api/execute/cwd')
      if (res.ok) {
        const data = await res.json()
        const el = document.getElementById('statusDir')
        if (el && data.display) el.textContent = data.display
      }
    } catch { /* server might not be ready yet */ }
  }
  updateCwd()
  setInterval(updateCwd, 2000)
}

function initFileManager() {
  const fileModal = document.getElementById('fileModal')
  const extraKeysPaper = document.getElementById('extraKeysPaper')
  const browser = document.getElementById('fileBrowser')

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

  document.getElementById('editFileBtn').onclick = () => {
    fileModal.showModal()
    extraKeysPaper.classList.add('hidden')
    FileManager.load('')
  }

  document.getElementById('modalCancel').onclick = () => {
    fileModal.close()
    extraKeysPaper.classList.remove('hidden')
  }

  document.getElementById('modalSave').onclick = () => FileManager.save()
  document.getElementById('modalNewFile').onclick = () => FileManager.createNew()
  document.getElementById('modalRename').onclick = () => FileManager.renameFile()
  document.getElementById('refreshFileListBtn').onclick = () => FileManager.load(FileManager.dir)
  document.getElementById('previewBtn').onclick = () => FileManager.showPreview()
  document.getElementById('previewClose').onclick = () => document.getElementById('previewModal').close()

  document.getElementById('uploadBtn').onclick = () => document.getElementById('uploadInput').click()
  document.getElementById('uploadInput').onchange = (e) => {
    if (e.target.files[0]) FileManager.uploadFile(e.target.files[0])
    e.target.value = ''
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && fileModal.open) {
      fileModal.close()
      extraKeysPaper.classList.remove('hidden')
    }
  })
}

function initGitHub() {
  GitHub.init()

  document.getElementById('gitBtn')?.addEventListener('click', () => GitHub.open())
}

function initPWA() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/static/service-worker.js').catch(() => {})
  }

  let deferredPrompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e
    document.getElementById('pwaInstallPrompt').classList.remove('hidden')
  })

  document.getElementById('pwaInstallBtn').onclick = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    document.getElementById('pwaInstallPrompt').classList.add('hidden')
    deferredPrompt = null
    if (outcome === 'accepted') Toast.show('App installed!', 'success')
  }

  document.getElementById('pwaDismissBtn').onclick = () => {
    document.getElementById('pwaInstallPrompt').classList.add('hidden')
  }
}

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
