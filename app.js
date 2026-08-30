const App = {
  _syncTimer: null,
  _lastRobotsRaw: null,
  _clientId: typeof uid === 'function' ? uid() : String(Date.now() + Math.random()),
  _leaderTimer: null,
  _leaderWaitTimer: null,
  _leaderKey: 'ws-background-leader',
  _backgroundStarted: false,

  init() {
    const isBackground = document.title === 'WS Background';
    RobotEngine.load({ loadHistory: isBackground, emitStarted: isBackground });
    if (RobotEngine.getAllRobots().length === 0) {
      RobotEngine.createRobot({ id: 'wheel-alt', name: 'Wheel Alternancia', game: 'wheel', strategy: 'alternancia', resultsToAnalyze: 40, minimumConfidence: 80, confirmations: 2, intervalMin: 60, galeMax: 2, mode: 'monitoramento' });
      RobotEngine.createRobot({ id: 'wheel-freq', name: 'Wheel Frequencia', game: 'wheel', strategy: 'frequencia', resultsToAnalyze: 40, minimumConfidence: 75, confirmations: 2, intervalMin: 60, galeMax: 1, mode: 'monitoramento' });
      RobotEngine.createRobot({ id: 'double-tend', name: 'Double Tendencia', game: 'double', strategy: 'tendencia', resultsToAnalyze: 30, minimumConfidence: 75, confirmations: 2, intervalMin: 60, galeMax: 2, mode: 'monitoramento' });
      RobotEngine.save();
    }
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

  startBackgroundExecutor() {
    if (this._backgroundStarted) return;
    this._backgroundStarted = true;
    if (typeof TelegramService !== 'undefined') TelegramService.init();
    EventBus.on('ws-status', (d) => {
      Store.set('source-status-' + d.label, { connected: !!d.connected, updatedAt: Date.now() });
    });
    Sources.init();
    this.watchRobotConfigChanges();
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
