const App = {
  _syncTimer: null,
  _lastRobotsRaw: null,
  _clientId: typeof uid === 'function' ? uid() : String(Date.now() + Math.random()),
  _leaderTimer: null,
  _leaderWaitTimer: null,
  _leaderKey: 'ws-background-leader',
  _backgroundStarted: false,
  _historySyncTimer: null,

  init() {
    const isBackground = document.title === 'WS Background';
    this.applySavedProjectData();
    RobotEngine.load({ loadHistory: isBackground, emitStarted: isBackground });
    if (isBackground) {
      if (!this.claimBackgroundLeadership()) {
        this.waitForBackgroundLeadership();
        return;
      }
      this.startBackgroundExecutor();
    } else {
      this.ensureBackgroundRunner();
      this.startRobotStateSync();
    }
  },

  ensureBackgroundRunner() {
    if (!document.body || document.getElementById('__wsBackgroundRunner')) return;
    const frame = document.createElement('iframe');
    frame.id = '__wsBackgroundRunner';
    frame.src = 'ws-background.html';
    frame.title = 'Executor dos robos';
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-9999px;top:-9999px;border:0;opacity:0;pointer-events:none';
    document.body.appendChild(frame);
  },

  startRobotStateSync() {
    if (this._syncTimer) return;
    this._lastRobotsRaw = localStorage.getItem('robots') || '';
    const sync = () => {
      const raw = localStorage.getItem('robots') || '';
      if (raw === this._lastRobotsRaw) return;
      this._lastRobotsRaw = raw;
      RobotEngine.syncFromStorage();
    };
    window.addEventListener('storage', (e) => {
      if (e.key === 'robots') sync();
    });
    this._syncTimer = setInterval(sync, 1000);
  },

  watchRobotConfigChanges() {
    window.addEventListener('storage', (e) => {
      if (e.key === 'robots') {
        RobotEngine.load({ loadHistory: true, emitStarted: false });
      }
    });
  },

  getSourceStatus(label) {
    return Store.get('source-status-' + label, {});
  },

  applySavedProjectData() {
    const data = window.SAVED_PROJECT_DATA;
    if (!data || typeof data !== 'object') return;

    this.mergeStoredList('telegram-channels', data.telegram?.channels, 'id');
    this.mergeStoredList('robots', data.robots, 'id');
    this.mergeStoredObject('telegram-message-templates-v1', data.messageTemplates);

    if (data.telegram?.owner && !localStorage.getItem('telegram-owner-name')) {
      localStorage.setItem('telegram-owner-name', data.telegram.owner);
    }

    const wsConfig = data.wsConfig || {};
    if (wsConfig.wheelWsUrl || wsConfig.doubleWsUrl) {
      const current = Store.get('ws-config-v1', {});
      const merged = { ...wsConfig, ...current };
      Store.set('ws-config-v1', merged);
      if (merged.wheelWsUrl) CONFIG.wheel.wsUrl = merged.wheelWsUrl;
      if (merged.doubleWsUrl) CONFIG.double.wsUrl = merged.doubleWsUrl;
    }
  },

  mergeStoredList(key, savedItems, idKey) {
    if (!Array.isArray(savedItems) || !savedItems.length) return;
    const current = Store.get(key, []);
    const list = Array.isArray(current) ? current : [];
    const existing = new Set(list.map(item => String(item?.[idKey] || '')));
    let changed = false;
    savedItems.forEach(item => {
      const id = String(item?.[idKey] || '');
      if (!id || existing.has(id)) return;
      list.push(item);
      existing.add(id);
      changed = true;
    });
    if (changed) Store.set(key, list);
  },

  mergeStoredObject(key, savedObject) {
    if (!savedObject || typeof savedObject !== 'object' || Array.isArray(savedObject)) return;
    const current = Store.get(key, {});
    const merged = { ...savedObject, ...(current && typeof current === 'object' ? current : {}) };
    Store.set(key, merged);
  },

  startBackgroundExecutor() {
    if (this._backgroundStarted) return;
    this._backgroundStarted = true;
    if (typeof TelegramService !== 'undefined') TelegramService.init();
    EventBus.on('ws-status', (d) => {
      Store.set('source-status-' + d.label, {
        connected: !!d.connected,
        updatedAt: Date.now(),
        error: d.error || '',
        reason: d.reason || '',
        expiresAt: d.expiresAt || null
      });
    });
    Sources.init();
    this.watchRobotConfigChanges();
    this.startHistorySync();
  },

  startHistorySync() {
    if (this._historySyncTimer) return;
    this._historySyncTimer = setInterval(() => {
      RobotEngine.syncHistoriesFromStorage();
    }, 1000);
  },

  claimBackgroundLeadership() {
    const now = Date.now();
    const current = Store.get(this._leaderKey, null);
    if (current?.owner && current.owner !== this._clientId && current.expiresAt > now) return false;
    Store.set(this._leaderKey, { owner: this._clientId, expiresAt: now + 5000 });
    const confirmed = Store.get(this._leaderKey, null);
    if (confirmed?.owner !== this._clientId) return false;
    if (!this._leaderTimer) {
      this._leaderTimer = setInterval(() => {
        Store.set(this._leaderKey, { owner: this._clientId, expiresAt: Date.now() + 5000 });
      }, 2000);
      window.addEventListener('beforeunload', () => {
        const active = Store.get(this._leaderKey, null);
        if (active?.owner === this._clientId) Store.remove(this._leaderKey);
      });
    }
    return true;
  },

  waitForBackgroundLeadership() {
    if (this._leaderWaitTimer) return;
    this._leaderWaitTimer = setInterval(() => {
      if (!this.claimBackgroundLeadership()) return;
      clearInterval(this._leaderWaitTimer);
      this._leaderWaitTimer = null;
      this.startBackgroundExecutor();
    }, 2000);
  }
};
