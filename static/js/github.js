import { api, esc } from './api.js'
import { Toast } from './terminal.js'

// ── GITHUB / GIT PANEL ────────────────────────────────────────────────────────

export const GitHub = {
  state: null,
  activeTab: 'status',
  _initialized: false,

  init() {
    if (this._initialized) return
    this._initialized = true
    this._bindStaticEvents()
  },

  // ── OPEN / CLOSE ─────────────────────────────────────────────────────────

  async open() {
    const modal = document.getElementById('gitModal')
    if (!modal) return
    modal.showModal()
    document.getElementById('extraKeysPaper')?.classList.add('hidden')
    this.switchTab('status')
    await this.refresh()
    // Pre-load config into settings tab
    this._loadConfig()
  },

  close() {
    document.getElementById('gitModal')?.close()
    document.getElementById('extraKeysPaper')?.classList.remove('hidden')
  },

  // ── TABS ─────────────────────────────────────────────────────────────────

  switchTab(tab) {
    this.activeTab = tab
    document.querySelectorAll('.git-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === tab)
    )
    document.querySelectorAll('.git-tab-pane').forEach(p =>
      p.classList.toggle('hidden', p.dataset.tab !== tab)
    )
    if (tab === 'log') this._loadLog()
    if (tab === 'branches') this._loadBranches()
  },

  // ── REFRESH STATUS ────────────────────────────────────────────────────────

  async refresh() {
    const btn = document.getElementById('gitRefreshBtn')
    if (btn) { btn.textContent = '↻'; btn.disabled = true }

    const { ok, data } = await api.get('/api/git/status')

    if (btn) { btn.textContent = '↺'; btn.disabled = false }

    if (!ok || !data) { this._renderError('Server unreachable'); return }

    this.state = data

    if (!data.is_repo) {
      this._renderNoRepo()
      return
    }

    this._renderBranchBadge(data)
    this._renderStatusTab(data)

    // Update commit tab hint
    const staged = data.staged?.length || 0
    const hint = document.getElementById('gitCommitHint')
    if (hint) hint.textContent = staged > 0 ? `${staged} file(s) staged` : 'No files staged'
  },

  // ── RENDER HELPERS ────────────────────────────────────────────────────────

  _renderBranchBadge(data) {
    const badge = document.getElementById('gitBranchBadge')
    if (badge) badge.textContent = data.branch || '?'

    const sync = document.getElementById('gitSyncBadge')
    if (!sync) return
    const parts = []
    if (data.ahead > 0) parts.push(`↑${data.ahead}`)
    if (data.behind > 0) parts.push(`↓${data.behind}`)
    sync.textContent = parts.join(' ')
    sync.style.display = parts.length ? 'inline-flex' : 'none'
  },

  _renderNoRepo() {
    const badge = document.getElementById('gitBranchBadge')
    if (badge) badge.textContent = 'NO REPO'
    document.getElementById('gitStatusPane').innerHTML = `
      <div class="git-empty">
        <div class="git-empty-icon">⚠</div>
        <div style="margin-bottom:12px">Not a git repository</div>
        <button class="paper-btn primary" id="gitInitBtn">GIT INIT</button>
      </div>`
    document.getElementById('gitInitBtn')?.addEventListener('click', () => this.initRepo())
  },

  _renderError(msg) {
    document.getElementById('gitStatusPane').innerHTML =
      `<div class="git-empty"><div class="git-empty-icon" style="color:var(--danger)">✗</div><div>${esc(msg)}</div></div>`
  },

  _renderStatusTab(data) {
    const pane = document.getElementById('gitStatusPane')
    const total = (data.staged?.length || 0) + (data.unstaged?.length || 0) + (data.untracked?.length || 0)

    if (total === 0) {
      pane.innerHTML = `<div class="git-clean"><span>✓</span> Working tree clean</div>`
      return
    }

    let html = ''

    if (data.staged?.length) {
      html += `<div class="git-group-header">
        <span class="git-group-label success">STAGED (${data.staged.length})</span>
        <button class="paper-btn small" data-bulk="unstage-all">UNSTAGE ALL</button>
      </div>`
      data.staged.forEach(f => {
        html += `<div class="git-file-row" data-file="${esc(f.file)}">
          <span class="git-status-badge success">${esc(f.status)}</span>
          <span class="git-file-label">${esc(f.file)}</span>
          <div class="git-row-actions">
            <button class="paper-btn small" data-action="unstage" data-file="${esc(f.file)}">−</button>
          </div>
        </div>`
      })
    }

    if (data.unstaged?.length) {
      html += `<div class="git-group-header">
        <span class="git-group-label warning">MODIFIED (${data.unstaged.length})</span>
        <button class="paper-btn small accent" data-bulk="stage-modified">STAGE ALL</button>
      </div>`
      data.unstaged.forEach(f => {
        html += `<div class="git-file-row" data-file="${esc(f.file)}">
          <span class="git-status-badge warning">${esc(f.status)}</span>
          <span class="git-file-label">${esc(f.file)}</span>
          <div class="git-row-actions">
            <button class="paper-btn small accent" data-action="stage" data-file="${esc(f.file)}">+</button>
            <button class="paper-btn small" data-action="discard" data-file="${esc(f.file)}" style="color:var(--danger)">↩</button>
          </div>
        </div>`
      })
    }

    if (data.untracked?.length) {
      html += `<div class="git-group-header">
        <span class="git-group-label" style="color:var(--cement)">UNTRACKED (${data.untracked.length})</span>
        <button class="paper-btn small" data-bulk="stage-all">ADD ALL</button>
      </div>`
      data.untracked.forEach(f => {
        html += `<div class="git-file-row" data-file="${esc(f)}">
          <span class="git-status-badge" style="color:var(--cement)">?</span>
          <span class="git-file-label">${esc(f)}</span>
          <div class="git-row-actions">
            <button class="paper-btn small" data-action="stage" data-file="${esc(f)}">+</button>
          </div>
        </div>`
      })
    }

    pane.innerHTML = html

    // Bind delegated events on the pane
    pane.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action],[data-bulk]')
      if (!btn) return

      const action = btn.dataset.action || btn.dataset.bulk
      const file = btn.dataset.file

      const actions = {
        'stage': () => this._stageFile(file),
        'unstage': () => this._unstageFile(file),
        'discard': () => this._discardFile(file),
        'stage-all': () => this.stageAll(),
        'stage-modified': () => this.stageAll(),
        'unstage-all': () => this.unstageAll(),
      }
      if (actions[action]) await actions[action]()
    }, { once: true })   // re-bound on next render
  },

  // ── FILE OPERATIONS ───────────────────────────────────────────────────────

  async _stageFile(file) {
    const { ok, data } = await api.post('/api/git/add', { files: [file] })
    ok && data?.success ? Toast.show(`Staged: ${file}`, 'success') : Toast.show(data?.error || 'Failed', 'error')
    await this.refresh()
  },

  async _unstageFile(file) {
    const { ok, data } = await api.post('/api/git/unstage', { file })
    ok && data?.success ? Toast.show(`Unstaged: ${file}`, 'info') : Toast.show(data?.error || 'Failed', 'error')
    await this.refresh()
  },

  async _discardFile(file) {
    if (!confirm(`Discard changes to "${file}"?\nThis cannot be undone.`)) return
    const { ok, data } = await api.post('/api/git/discard', { file })
    ok && data?.success ? Toast.show(`Discarded: ${file}`, 'warning') : Toast.show(data?.error || 'Failed', 'error')
    await this.refresh()
  },

  async stageAll() {
    const { ok, data } = await api.post('/api/git/add', { files: ['.'] })
    ok && data?.success ? Toast.show('All changes staged', 'success') : Toast.show(data?.error || 'Failed', 'error')
    await this.refresh()
  },

  async unstageAll() {
    const { ok, data } = await api.post('/api/git/unstage', { file: '.' })
    ok && data?.success ? Toast.show('Unstaged all', 'info') : Toast.show(data?.error || 'Failed', 'error')
    await this.refresh()
  },

  // ── COMMIT ────────────────────────────────────────────────────────────────

  async commit() {
    const msgEl = document.getElementById('gitCommitMsg')
    const message = msgEl?.value.trim()
    if (!message) { Toast.show('Enter a commit message', 'warning'); return }

    const btn = document.getElementById('gitCommitBtn')
    btn.textContent = 'COMMITTING...'
    btn.disabled = true

    const { ok, data } = await api.post('/api/git/commit', { message })

    btn.disabled = false
    btn.textContent = 'COMMIT'

    if (ok && data?.success) {
      Toast.show('Committed!', 'success')
      if (msgEl) msgEl.value = ''
      await this.refresh()
    } else {
      Toast.show(data?.error || 'Commit failed', 'error')
    }
  },

  // ── SYNC (push / pull / fetch) ────────────────────────────────────────────

  async push() {
    const btn = document.getElementById('gitPushBtn')
    const remote = document.getElementById('gitRemoteSelect')?.value || 'origin'
    btn.textContent = 'PUSHING...'
    btn.disabled = true

    const { ok, data } = await api.post('/api/git/push', { remote })

    btn.disabled = false
    btn.textContent = 'PUSH ↑'

    if (ok && data?.success) {
      Toast.show('Pushed!', 'success')
      await this.refresh()
    } else if (data?.needs_upstream) {
      // Auto-retry with --set-upstream
      const branch = this.state?.branch
      if (branch) {
        Toast.show('Setting upstream and pushing...', 'info')
        const retry = await api.post('/api/git/push', { remote, branch, set_upstream: true })
        retry.ok && retry.data?.success
          ? Toast.show('Pushed with upstream set!', 'success')
          : Toast.show(retry.data?.error || 'Push failed', 'error')
        await this.refresh()
      } else {
        Toast.show(data?.error || 'Push failed', 'error')
      }
    } else {
      Toast.show(data?.error || 'Push failed', 'error')
    }
  },

  async pull() {
    const btn = document.getElementById('gitPullBtn')
    const remote = document.getElementById('gitRemoteSelect')?.value || 'origin'
    btn.textContent = 'PULLING...'
    btn.disabled = true

    const { ok, data } = await api.post('/api/git/pull', { remote })

    btn.disabled = false
    btn.textContent = 'PULL ↓'

    if (ok && data?.success) {
      Toast.show(data.message || 'Pulled!', 'success')
      await this.refresh()
    } else {
      Toast.show(data?.error || 'Pull failed', 'error')
    }
  },

  async fetch() {
    const btn = document.getElementById('gitFetchBtn')
    btn.textContent = 'FETCHING...'
    btn.disabled = true

    const { ok, data } = await api.post('/api/git/fetch', {})

    btn.disabled = false
    btn.textContent = 'FETCH'

    ok && data?.success ? Toast.show('Fetched!', 'success') : Toast.show(data?.error || 'Fetch failed', 'error')
    await this.refresh()
  },

  // ── LOG ───────────────────────────────────────────────────────────────────

  async _loadLog() {
    const pane = document.getElementById('gitLogPane')
    pane.innerHTML = '<div class="git-loading">Loading commits...</div>'

    const { ok, data } = await api.get('/api/git/log?limit=20')

    if (!ok || !data?.success || !data.commits?.length) {
      pane.innerHTML = '<div class="git-empty">No commits yet</div>'
      return
    }

    pane.innerHTML = data.commits.map(c => `
      <div class="git-commit-row">
        <div class="git-commit-top">
          <code class="git-commit-hash">${esc(c.short)}</code>
          <span class="git-commit-time">${esc(c.time)}</span>
        </div>
        <div class="git-commit-msg">${esc(c.message)}</div>
        <div class="git-commit-author">${esc(c.author)}</div>
      </div>`).join('')
  },

  // ── BRANCHES ─────────────────────────────────────────────────────────────

  async _loadBranches() {
    const pane = document.getElementById('gitBranchPane')
    pane.innerHTML = '<div class="git-loading">Loading...</div>'

    const { ok, data } = await api.get('/api/git/branches')
    if (!ok || !data?.success) {
      pane.innerHTML = '<div class="git-empty">Could not load branches</div>'
      return
    }

    pane.innerHTML = `
      <div class="git-group-header">
        <span class="git-group-label">BRANCHES</span>
        <button class="paper-btn small accent" id="gitNewBranchBtn">+ NEW</button>
      </div>
      ${data.branches.map(b => `
        <div class="git-branch-row ${b.current ? 'current' : ''}">
          <span class="git-branch-dot">${b.current ? '●' : '○'}</span>
          <span class="git-branch-name">${esc(b.name)}</span>
          ${b.current
            ? '<span class="git-branch-current-badge">CURRENT</span>'
            : `<button class="paper-btn small" data-action="checkout" data-branch="${esc(b.name)}">CHECKOUT</button>`
          }
        </div>`).join('')}`

    document.getElementById('gitNewBranchBtn')?.addEventListener('click', () => this.newBranch())

    pane.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action="checkout"]')
      if (!btn) return
      await this._checkout(btn.dataset.branch)
    }, { once: true })
  },

  async _checkout(branch) {
    const { ok, data } = await api.post('/api/git/checkout', { branch })
    ok && data?.success
      ? Toast.show(`Switched to ${branch}`, 'success')
      : Toast.show(data?.error || 'Checkout failed', 'error')
    await this._loadBranches()
    await this.refresh()
  },

  async newBranch() {
    const name = prompt('New branch name:')?.trim()
    if (!name) return
    const { ok, data } = await api.post('/api/git/checkout', { branch: name, create: true })
    ok && data?.success
      ? Toast.show(`Created & switched to ${name}`, 'success')
      : Toast.show(data?.error || 'Failed', 'error')
    await this._loadBranches()
    await this.refresh()
  },

  // ── INIT REPO ─────────────────────────────────────────────────────────────

  async initRepo() {
    const { ok, data } = await api.post('/api/git/init', {})
    ok && data?.success ? Toast.show('Repository initialized', 'success') : Toast.show(data?.error || 'Init failed', 'error')
    await this.refresh()
  },

  // ── CONFIG ────────────────────────────────────────────────────────────────

  async _loadConfig() {
    const { ok, data } = await api.get('/api/git/config')
    if (!ok || !data?.success) return
    const nameEl = document.getElementById('gitConfigName')
    const emailEl = document.getElementById('gitConfigEmail')
    if (nameEl && data.name) nameEl.placeholder = data.name
    if (emailEl && data.email) emailEl.placeholder = data.email

    // Pre-fill remotes
    const remotes = this.state?.remotes || []
    const remoteUrl = document.getElementById('gitRemoteUrl')
    if (remoteUrl && remotes.length > 0) remoteUrl.placeholder = remotes[0].url
  },

  async saveConfig() {
    const name = document.getElementById('gitConfigName')?.value.trim()
    const email = document.getElementById('gitConfigEmail')?.value.trim()
    if (!name && !email) { Toast.show('Enter name or email', 'warning'); return }

    const { ok, data } = await api.post('/api/git/config', { name, email })
    ok && data?.success ? Toast.show(data.message, 'success') : Toast.show(data?.error || 'Failed', 'error')
  },

  async saveRemote() {
    const url = document.getElementById('gitRemoteUrl')?.value.trim()
    const name = document.getElementById('gitRemoteName')?.value.trim() || 'origin'
    if (!url) { Toast.show('Enter remote URL', 'warning'); return }

    const { ok, data } = await api.post('/api/git/remote', { action: 'add', name, url })
    ok && data?.success ? Toast.show(data.message, 'success') : Toast.show(data?.error || 'Failed', 'error')
    await this.refresh()
  },

  // ── STATIC EVENT BINDING ──────────────────────────────────────────────────

  _bindStaticEvents() {
    // Tab bar
    document.getElementById('gitModal')?.addEventListener('click', (e) => {
      const tab = e.target.closest('.git-tab')
      if (tab?.dataset.tab) this.switchTab(tab.dataset.tab)
    })

    // Header buttons
    document.getElementById('gitRefreshBtn')?.addEventListener('click', () => this.refresh())
    document.getElementById('gitCloseBtn')?.addEventListener('click', () => this.close())

    // Commit tab
    document.getElementById('gitStageAllBtn')?.addEventListener('click', () => this.stageAll())
    document.getElementById('gitCommitBtn')?.addEventListener('click', () => this.commit())

    // Quick commit with Ctrl+Enter in textarea
    document.getElementById('gitCommitMsg')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); this.commit() }
    })

    // Sync tab
    document.getElementById('gitPushBtn')?.addEventListener('click', () => this.push())
    document.getElementById('gitPullBtn')?.addEventListener('click', () => this.pull())
    document.getElementById('gitFetchBtn')?.addEventListener('click', () => this.fetch())

    // Config tab
    document.getElementById('gitSaveConfigBtn')?.addEventListener('click', () => this.saveConfig())
    document.getElementById('gitSaveRemoteBtn')?.addEventListener('click', () => this.saveRemote())

    // Close on backdrop click
    document.getElementById('gitModal')?.addEventListener('click', (e) => {
      if (e.target === document.getElementById('gitModal')) this.close()
    })

    // ESC
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('gitModal')?.open) this.close()
    })
  }
}
