import { api, esc, SERVER_HINT_HTML, SERVER_HINT_TEXT, getFileIcon } from './api.js'
import { Terminal, Toast } from './terminal.js'
import { Editor } from './editor.js'

const LANG_MAP = {
  py: 'python', js: 'javascript', ts: 'typescript', sh: 'bash', html: 'html',
  htm: 'html', css: 'css', json: 'json', md: 'markdown', yaml: 'yaml',
  yml: 'yaml', toml: 'toml', cfg: 'ini'
}

const FileTemplates = {
  error: (msg, hint = '') => `<div class="file-item" style="border-left:2px solid var(--danger)"><span class="file-name" style="color:var(--danger)">${esc(msg)}${hint}</span></div>`,
  
  item: (item, isActive, parentPath = null) => {
    const icon = getFileIcon(item.name, item.type === 'directory')
    const size = item.type === 'file' ? esc(String(item.size ?? '')) : ''
    const activeClass = isActive ? ' active-file' : ''
    
    return `
      <div class="file-item${activeClass}" data-path="${esc(item.path)}" data-type="${item.type}">
        <span class="file-name">
          <span class="file-icon ${icon.cls}">${icon.icon}</span>
          ${esc(item.name)}
        </span>
        <span class="file-size">${size}</span>
        <div class="file-actions">
          ${item.type === 'file' ? '<button class="file-download">\u2193</button>' : ''}
          <button class="file-del">\u00D7</button>
        </div>
      </div>`
  },
  
  parentDir: (parentPath) => `
    <div class="file-item" data-path="${esc(parentPath)}" data-type="directory">
      <span class="file-name"><span class="file-icon dir">\u{1F4C1}</span> ..</span>
      <span class="file-size">PARENT</span>
    </div>`,
  
  empty: '<div class="file-item"><span class="file-name" style="color:var(--cement);justify-content:center;display:flex">EMPTY DIRECTORY</span></div>'
}

export const FileManager = {
  dir: '',
  file: '',
  content: '',

  get el() {
    return {
      browser: document.getElementById('fileBrowser'),
      path: document.getElementById('currentPathDisplay'),
      editor: document.getElementById('modalContent')
    }
  },

  async load(path = '') {
    const browser = this.el.browser
    const pathEl = this.el.path
    if (!browser) return

    this.dir = path
    browser.innerHTML = FileTemplates.error('Loading...')
    
    const { ok, data } = await api.get(`/api/files/list?path=${encodeURIComponent(path)}`)
    
    if (!ok) {
      browser.innerHTML = FileTemplates.error('ERROR: Failed to fetch', SERVER_HINT_HTML)
      return
    }
    
    if (data?.error) {
      browser.innerHTML = FileTemplates.error(`ERROR: ${data.error}`)
      return
    }
    
    if (pathEl) pathEl.textContent = data.current_path || '~/Yuyutermux'
    this.render(data.items || [])
  },

  render(items) {
    const browser = this.el.browser
    if (!browser) return

    // Compute full path for each item (Zig doesn't return 'path' field)
    const itemsWithPath = (items || []).map(item => ({
      ...item,
      path: this.dir ? `${this.dir}/${item.name}` : item.name
    }))

    let html = ''
    
    if (this.dir) {
      const parent = this.dir.split('/').slice(0, -1).join('/') || ''
      html += FileTemplates.parentDir(parent)
    }
    
    itemsWithPath.forEach(item => {
      const isActive = this.file === item.path
      html += FileTemplates.item(item, isActive)
    })
    
    browser.innerHTML = html || FileTemplates.empty
  },

  async openItem(path, type) {
    const editorEl = this.el.editor
    if (!editorEl) return

    if (type === 'directory') {
      return this.load(path)
    }
    
    this.file = path
    editorEl.value = 'Loading...'
    
    const name = path.split('/').pop() || 'unknown'
    const ext = name.split('.').pop()?.toLowerCase() || ''
    
    const fileNameSpan = document.getElementById('editorFileName')
    const langSpan = document.getElementById('editorLang')
    const renameBtn = document.getElementById('modalRename')
    if (fileNameSpan) fileNameSpan.textContent = name
    if (langSpan) langSpan.textContent = LANG_MAP[ext] || ext || 'text'
    if (renameBtn) renameBtn.classList.remove('hidden')
    
    const { ok, data } = await api.post('/api/files/read', { path })
    
    if (!ok || data?.error) {
      editorEl.value = `// ERROR: ${data?.error || 'Failed to fetch'}${SERVER_HINT_TEXT}`
      this.content = ''
      return
    }
    
    this.content = data.content || ''
    Editor.onLoad(LANG_MAP[ext] || ext || '', this.content)
    this.load(this.dir)
  },

  downloadFile(path) {
    const a = document.createElement('a')
    a.href = `/api/files/download?path=${encodeURIComponent(path)}`
    a.download = (path.split('/').pop()) || 'download'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    setTimeout(() => document.body.removeChild(a), 200)
    Toast.show('Downloading...', 'info')
  },

  async deleteItem(path) {
    const name = path.split('/').pop()
    if (!confirm(`Delete "${name}"?`)) return
    
    const { ok, data } = await api.post('/api/files/delete', { path })
    
    if (ok && !data?.error) {
      Toast.show(`Deleted: ${name}`, 'success')
      this.load(this.dir)
      
      if (this.file === path) {
        this.clearEditor()
      }
    } else {
      Toast.show(!ok ? 'Connection failed' : (data?.error || 'Delete failed'), 'error')
    }
  },

  clearEditor() {
    this.file = ''
    this.content = ''
    const editorEl = this.el.editor
    if (editorEl) editorEl.value = ''
    const fileNameSpan = document.getElementById('editorFileName')
    const langSpan = document.getElementById('editorLang')
    const renameBtn = document.getElementById('modalRename')
    if (fileNameSpan) fileNameSpan.textContent = 'No file selected'
    if (langSpan) langSpan.textContent = '\u2014'
    if (renameBtn) renameBtn.classList.add('hidden')
  },

  async save() {
    if (!this.file) {
      Toast.show('Select a file first', 'warning')
      return
    }
    
    const btn = document.getElementById('modalSave')
    if (!btn) return
    
    const originalText = btn.innerHTML
    btn.innerHTML = 'SAVING...'
    btn.disabled = true
    
    const editorEl = this.el.editor
    const { ok, data } = await api.post('/api/files/write', { 
      path: this.file, 
      content: editorEl ? editorEl.value : ''
    })
    
    btn.disabled = false
    
    if (ok && data?.success) {
      if (editorEl) this.content = editorEl.value
      btn.innerHTML = '\u2713 SAVED'
      const filename = this.file.split('/').pop()
      Toast.show(`${filename} saved`, 'success')
      Terminal.log(`SAVE ${filename} \u2014 File saved successfully`)
      setTimeout(() => { if (btn.isConnected) btn.innerHTML = originalText }, 1500)
    } else {
      btn.innerHTML = originalText
      Toast.show(!ok ? 'Connection failed' : (data?.error || 'Save failed'), 'error')
    }
  },

  async createNew() {
    const name = prompt('New filename:')
    if (!name) return
    
    const { ok, data } = await api.post('/api/files/create', { path: this.dir, filename: name })
    
    if (ok && data?.success) {
      Toast.show(`Created: ${name}`, 'success')
      this.load(this.dir)
    } else {
      Toast.show(!ok ? 'Connection failed' : (data?.error || 'Create failed'), 'error')
    }
  },

  async renameFile() {
    if (!this.file) {
      Toast.show('No file selected', 'warning')
      return
    }
    
    const oldName = this.file.split('/').pop() || 'file'
    const newName = prompt(`Rename "${oldName}" to:`, oldName)
    if (!newName || newName === oldName) return
    
    const parent = this.file.substring(0, this.file.lastIndexOf('/')) || ''
    const newPath = parent ? parent + '/' + newName : newName
    
    const { ok: readOk, data: readData } = await api.post('/api/files/read', { path: this.file })
    if (!readOk || readData?.error) {
      Toast.show('Failed to read file', 'error')
      return
    }
    
    const { ok: writeOk } = await api.post('/api/files/write', { path: newPath, content: readData.content })
    if (!writeOk) {
      Toast.show('Failed to write new file', 'error')
      return
    }
    
    const { ok: delOk } = await api.post('/api/files/delete', { path: this.file })
    if (!delOk) {
      Toast.show('Failed to delete old file', 'error')
      return
    }
    
    this.file = newPath
    this.content = readData.content
    const fileNameSpan = document.getElementById('editorFileName')
    if (fileNameSpan) fileNameSpan.textContent = newName
    Toast.show(`Renamed to ${newName}`, 'success')
    this.load(this.dir)
  },

  async uploadFile(file) {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('path', this.dir)
    
    const btn = document.getElementById('uploadBtn')
    const originalText = btn?.innerHTML
    
    if (btn) {
      btn.innerHTML = 'UPLOADING...'
      btn.style.pointerEvents = 'none'
      btn.style.opacity = '0.5'
    }
    
    try {
      const res = await fetch('/api/files/upload', { method: 'POST', body: formData, credentials: 'same-origin' })

      if (res.status === 401) {
        window.location.href = '/login'
        return
      }

      const data = await res.json()
      
      if (res.ok && data.success) {
        Toast.show(`Uploaded: ${file.name}`, 'success')
        Terminal.log(`UPLOAD ${file.name} \u2014 Upload successful`)
        this.load(this.dir)
      } else {
        Toast.show(data.error || 'Upload failed', 'error')
      }
    } catch {
      Toast.show('Connection failed', 'error')
    } finally {
      if (btn) {
        btn.innerHTML = originalText
        btn.style.pointerEvents = ''
        btn.style.opacity = ''
      }
    }
  },

  async openFileWithLine(filepath, targetLine) {
    const modal = document.getElementById('fileModal')
    const extraKeys = document.getElementById('extraKeysPaper')
    if (modal) {
      if (!modal.open) {
        try { modal.showModal() } catch { modal.show?.() || (modal.hidden = false) }
        if (extraKeys) extraKeys.classList.add('hidden')
      }
    } else return
    
    this.file = filepath
    const editor = this.el.editor
    if (!editor) return
    editor.value = 'Loading...'
    
    const name = filepath.split('/').pop() || 'unknown'
    const ext = name.split('.').pop()?.toLowerCase() || ''
    
    const fileNameSpan = document.getElementById('editorFileName')
    const langSpan = document.getElementById('editorLang')
    const renameBtn = document.getElementById('modalRename')
    if (fileNameSpan) fileNameSpan.textContent = name
    if (langSpan) langSpan.textContent = LANG_MAP[ext] || ext || 'text'
    if (renameBtn) renameBtn.classList.remove('hidden')
    
    const { ok, data } = await api.post('/api/files/read', { path: filepath })
    
    if (!ok || data?.error) {
      editor.value = `// ERROR: ${data?.error || 'Failed to load'}`
      return
    }
    
    this.content = data.content || ''
    Editor.onLoad(LANG_MAP[ext] || ext || '', this.content)
    
    setTimeout(() => {
      const lines = editor.value.split('\n')
      if (targetLine < 1 || targetLine > lines.length) return
      
      const lineHeight = parseInt(getComputedStyle(editor).lineHeight) || 20
      editor.scrollTop = (targetLine - 1) * lineHeight
      
      let startPos = 0
      for (let i = 0; i < targetLine - 1; i++) {
        startPos += lines[i].length + 1
      }
      const endPos = startPos + lines[targetLine - 1].length
      
      editor.focus()
      editor.setSelectionRange(startPos, endPos)
      
      const wrapper = document.getElementById('editorWrapper')
      if (wrapper) {
        wrapper.style.background = 'rgba(255,107,53,0.15)'
        setTimeout(() => { if (wrapper) wrapper.style.background = '' }, 1000)
      }
    }, 100)
  }
}
