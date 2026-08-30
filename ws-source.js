class WSSource {
  constructor(label, url) {
    this.label = label;
    this.url = url;
    this.ws = null;
    this.connected = false;
    this.reconnectTimer = null;
    this.reconnectDelay = 2000;
    this._initialLoaded = false;
    this._lastGameId = null;
  }

  connect() {
    if (!this.url || this.url.includes('your-')) return;
    try {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => {
        this.connected = true;
        this.reconnectDelay = 2000;
        this._initialLoaded = false;
        this._lastGameId = null;
        this.ws.send('40');
        EventBus.emit('source:connected', { label: this.label });
        EventBus.emit('ws-status', { label: this.label, connected: true });
      };
      this.ws.onmessage = (e) => {
        const raw = typeof e.data === 'string' ? e.data : String(e.data);
        if (!raw) return;
        if (raw === '2') { this.ws.send('3'); return; }
        if (raw === '3' || raw.startsWith('0')) return;

        let jsonPart = raw;
        const match = raw.match(/^(\d+)(.*)/);
        if (match) jsonPart = match[2];
        if (!jsonPart || !jsonPart.startsWith('[')) return;

        try {
          const arr = JSON.parse(jsonPart);
          if (!Array.isArray(arr) || arr.length < 2) return;
          this.handleEvent(arr[0], arr[1]);
        } catch {}
      };
      this.ws.onclose = () => {
        this.connected = false;
        EventBus.emit('source:disconnected', { label: this.label });
        EventBus.emit('ws-status', { label: this.label, connected: false });
        this.scheduleReconnect();
      };
      this.ws.onerror = () => {
        this.connected = false;
        this.scheduleReconnect();
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  handleEvent(eventName, payload) {
    if (eventName === 'gameService-game-status-changed' || eventName === 'gameService-game-state') {
      let emitted = false;

      if (payload.prevRoundResults && Array.isArray(payload.prevRoundResults)) {
        const results = payload.prevRoundResults.map(r => this.normalizeResult(r)).filter(r => r.color);
        if (!this._initialLoaded) {
          this._initialLoaded = true;
          this._lastGameId = payload.gameId;
          this.emitHistory(results);
          emitted = true;
        } else if (results.length > 0 && (payload.gameId === undefined || payload.gameId !== this._lastGameId)) {
          if (payload.gameId !== undefined) this._lastGameId = payload.gameId;
          this.emitResult(results[0]);
          emitted = true;
        }
      }

      const cellResult = this.normalizeResult(payload.cellResult);
      if (!emitted && cellResult.color) {
        this.emitResult(cellResult);
        emitted = true;
      }

      const directResult = this.normalizeResult(payload);
      if (!emitted && directResult.color) {
        this.emitResult(directResult);
      }
      return;
    }

    const directResult = this.normalizeResult(payload);
    if (directResult.color) {
      this.emitResult(directResult);
      return;
    }

    if (payload && payload.number !== undefined) {
      EventBus.emit('result:new', { label: this.label, ...payload });
    }
  }

  emitHistory(results) {
    ResultHistoryStore.merge(this.label, results);
    EventBus.emit('results:history', { label: this.label, results });
  }

  emitResult(result) {
    ResultHistoryStore.add(this.label, result);
    EventBus.emit('result:new', { label: this.label, ...result });
  }

  normalizeResult(raw) {
    if (!raw || typeof raw !== 'object') return { number: undefined, color: '', multiplier: null };
    const source = raw.cell || raw.result || raw;
    return {
      number: source.cellIndex ?? source.number ?? source.index,
      color: String(source.cellColor ?? source.color ?? source.colour ?? '').toLowerCase(),
      multiplier: source.multiplier || null
    };
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 30000);
      this.connect();
    }, this.reconnectDelay);
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) this.ws.close();
    this.connected = false;
  }
}

const ResultHistoryStore = {
  keys: { wheel: 'historico-wheel-v1', double: 'historico-double-v1' },
  maxResults: 100,

  getKey(label) {
    return this.keys[label];
  },

  load(label) {
    try {
      const data = JSON.parse(localStorage.getItem(this.getKey(label)) || '[]');
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  },

  save(label, history) {
    const key = this.getKey(label);
    if (!key) return;
    localStorage.setItem(key, JSON.stringify(history.slice(0, this.maxResults)));
  },

  add(label, result) {
    const item = this.toStorageItem(label, result);
    if (!item) return;
    const history = this.load(label);
    if (this.hasRecentDuplicate(history, item)) return;
    history.unshift(item);
    this.save(label, history);
  },

  merge(label, results) {
    if (!Array.isArray(results) || !results.length) return;
    const history = this.load(label);
    const existing = new Set(history.map(item => this.itemKey(item)));
    const incoming = results
      .map(result => this.toStorageItem(label, result))
      .filter(Boolean)
      .filter(item => !existing.has(this.itemKey(item)));
    this.save(label, incoming.concat(history));
  },

  toStorageItem(label, result) {
    if (!this.getKey(label) || !result?.color) return null;
    const base = {
      color: this.normalizeColor(result.color),
      multiplier: result.multiplier || null,
      time: Date.now()
    };
    if (label === 'wheel') {
      return { cellIndex: result.number, cellColor: base.color, multiplier: base.multiplier, time: base.time };
    }
    return { number: result.number, color: base.color, time: base.time };
  },

  normalizeColor(color) {
    return String(color || '').toLowerCase();
  },

  itemKey(item) {
    const number = item.cellIndex ?? item.number ?? '';
    const color = this.normalizeColor(item.cellColor ?? item.color);
    return number + ':' + color + ':' + (item.multiplier || '');
  },

  hasRecentDuplicate(history, item) {
    const key = this.itemKey(item);
    return history.slice(0, 5).some(current => this.itemKey(current) === key);
  }
};

const Sources = {
  wheel: null,
  double: null,
  init() {
    if (!this.wheel) {
      this.wheel = new WSSource('wheel', CONFIG.wheel.wsUrl);
    }
    if (!this.double) {
      this.double = new WSSource('double', CONFIG.double.wsUrl);
    }
    if (!this.wheel.connected && !this.wheel.ws) this.wheel.connect();
    if (!this.double.connected && !this.double.ws) this.double.connect();
  }
};
