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
    this._lastNetworkCheck = 0;
    this._lastIp = null;
  }

  connect() {
    if (!this.url || this.url.includes('your-')) return;
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) return;
    const tokenStatus = this.getAuthorizationStatus();
    try {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => {
        this.connected = true;
        this.reconnectDelay = 2000;
        this._initialLoaded = false;
        this._lastGameId = null;
        this.ws.send('40');
        EventBus.emit('source:connected', { label: this.label });
        EventBus.emit('ws-status', {
          label: this.label,
          connected: true,
          warning: tokenStatus.expired ? 'TOKEN_DATE_CHECK' : '',
          expiresAt: tokenStatus.expiresAt
        });
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

  getAuthorizationStatus() {
    try {
      const url = new URL(this.url);
      const token = url.searchParams.get('Authorization') || '';
      const payload = token.split('.')[1];
      if (!payload) return { expired: false, expiresAt: null };
      const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
      const data = JSON.parse(atob(padded));
      const expiresAt = data.exp ? data.exp * 1000 : null;
      return { expired: !!(expiresAt && Date.now() >= expiresAt), expiresAt };
    } catch {
      return { expired: false, expiresAt: null };
    }
  }

  handleEvent(eventName, payload) {
    if (!payload) return;
    this.scanPayload(payload, eventName, 0);
  }

  emitHistory(results) {
    const savedResults = ResultHistoryStore.merge(this.label, results);
    EventBus.emit('results:history', { label: this.label, results: savedResults || [] });
  }

  emitResult(result) {
    const savedItem = ResultHistoryStore.add(this.label, result);
    if (!savedItem) return;
    EventBus.emit('result:new', { label: this.label, ...result, storageId: savedItem.storageId, time: savedItem.time });
  }

  normalizeResult(raw) {
    if (!raw || typeof raw !== 'object') return { number: undefined, color: '', multiplier: null };
    const source = raw.cell || raw.result || raw;
    const number = Number(
      source.cellIndex ??
      source.number ??
      source.index ??
      source.roll ??
      source.value ??
      source.winningNumber ??
      source.resultNumber ??
      source.drawNumber
    );
    let color = String(
      source.cellColor ??
      source.color ??
      source.colour ??
      source.winningColor ??
      source.resultColor ??
      source.winnerColor ??
      source.selectedColor ??
      source.winner ??
      ''
    ).toLowerCase();
    color = this.normalizeColorAlias(color, number);
    const result = {
      number: Number.isFinite(number) ? number : undefined,
      color,
      multiplier: source.multiplier ?? source.cellMultiplier ?? source.resultMultiplier ?? source.winningMultiplier ?? null
    };
    const roundId = source.roundId ?? source.roundID ?? source.roundUuid ?? source.roundUUID ?? source.gameId ?? source.gameID ?? source.id ?? source.uuid;
    if (roundId !== undefined && roundId !== null) result.roundId = String(roundId);
    return result;
  }

  normalizeColorAlias(color, number) {
    let c = String(color || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (this.label === 'double') {
      const aliases = {
        vermelho: 'red',
        red: 'red',
        r: 'red',
        preto: 'black',
        black: 'black',
        b: 'black',
        branco: 'green',
        white: 'green',
        green: 'green',
        g: 'green'
      };
      c = aliases[c] || c;
      if (!['red', 'black', 'green'].includes(c)) {
        if (number === 0) return 'green';
        if (number >= 1 && number <= 7) return 'red';
        if (number >= 8 && number <= 14) return 'black';
      }
      return ['red', 'black', 'green'].includes(c) ? c : '';
    }

    const aliases = {
      black: 'black',
      gray: 'black',
      grey: 'black',
      preto: 'black',
      red: 'red',
      vermelho: 'red',
      blue: 'blue',
      azul: 'blue',
      green: 'green',
      verde: 'green'
    };
    return aliases[c] || c;
  }

  looksLikeResult(value) {
    if (!value || typeof value !== 'object') return false;
    const hasNumber =
      value.number !== undefined ||
      value.cellIndex !== undefined ||
      value.index !== undefined ||
      value.roll !== undefined ||
      value.value !== undefined ||
      value.winningNumber !== undefined ||
      value.resultNumber !== undefined ||
      value.drawNumber !== undefined;
    const hasColor =
      value.color !== undefined ||
      value.cellColor !== undefined ||
      value.colour !== undefined ||
      value.winningColor !== undefined ||
      value.resultColor !== undefined ||
      value.winnerColor !== undefined ||
      value.selectedColor !== undefined ||
      value.winner !== undefined;
    const hasMultiplier =
      value.multiplier !== undefined ||
      value.cellMultiplier !== undefined ||
      value.resultMultiplier !== undefined ||
      value.winningMultiplier !== undefined;
    return hasNumber && (hasColor || hasMultiplier || Number(value.number ?? value.cellIndex ?? value.roll ?? value.value) === 0);
  }

  isFinalLike(eventName, payload) {
    const eventText = String(eventName || '').toUpperCase();
    const statusText = String(payload?.status || '').toUpperCase();
    return !statusText || /RESULT|FINISH|ENDED|END|COMPLETE|COMPLETED|IN_GAME/.test(statusText) ||
      /RESULT|FINISH|ENDED|END|COMPLETE|COMPLETED/.test(eventText);
  }

  scanPayload(value, eventName, depth) {
    if (!value || depth > 6) return false;
    let emitted = false;

    if (Array.isArray(value)) {
      for (const item of value) emitted = this.scanPayload(item, eventName, depth + 1) || emitted;
      return emitted;
    }

    if (typeof value !== 'object') return false;

    if (Array.isArray(value.prevRoundResults)) {
      const results = value.prevRoundResults.map(r => this.normalizeResult(r)).filter(r => r.color);
      if (results.length) {
        if (!this._initialLoaded) {
          this._initialLoaded = true;
          this._lastGameId = value.gameId;
          this.emitHistory(results);
        } else if (value.gameId === undefined || value.gameId !== this._lastGameId) {
          if (value.gameId !== undefined) this._lastGameId = value.gameId;
          this.emitResult(results[0]);
        }
        emitted = true;
      }
    }

    const resultKeys = ['cellResult', 'result', 'roundResult', 'gameResult', 'lastResult', 'currentResult', 'winnerCell', 'winningCell', 'winner'];
    if (this.isFinalLike(eventName, value)) {
      for (const key of resultKeys) {
        if (!value[key] || typeof value[key] !== 'object') continue;
        const result = this.normalizeResult(value[key]);
        if (result.color) {
          this.emitResult(result);
          emitted = true;
        }
      }

      if (this.looksLikeResult(value)) {
        const result = this.normalizeResult(value);
        if (result.color) {
          this.emitResult(result);
          emitted = true;
        }
      }
    }

    for (const key of Object.keys(value)) {
      if (key === 'prevRoundResults' || resultKeys.includes(key)) continue;
      emitted = this.scanPayload(value[key], eventName, depth + 1) || emitted;
    }
    return emitted;
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 30000);
      this.connect();
    }, this.reconnectDelay);
  }

  forceReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this.connected = false;
    this.reconnectDelay = 2000;
    this.connect();
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) this.ws.close();
    this.connected = false;
  }
}

const ResultHistoryStore = {
  keys: { wheel: 'historico-wheel-v1', double: 'historico-double-v1' },
  maxResults: 500,
  duplicateWindowMs: 15000,

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
    const seenRounds = new Set();
    const saved = [];
    for (const item of history) {
      if (!item) continue;
      const roundKey = this.stableKey(item);
      if (roundKey) {
        if (seenRounds.has(roundKey)) continue;
        seenRounds.add(roundKey);
      }
      saved.push(item);
    }
    localStorage.setItem(key, JSON.stringify(saved.slice(0, this.maxResults)));
  },

  add(label, result) {
    const item = this.toStorageItem(label, result);
    if (!item) return null;
    const history = this.load(label);
    if (this.isImmediateDuplicate(history[0], item)) return null;
    history.unshift(item);
    this.save(label, history);
    return item;
  },

  merge(label, results) {
    if (!Array.isArray(results) || !results.length) return [];
    const history = this.load(label);
    const incoming = [];
    for (const result of results) {
      const item = this.toStorageItem(label, result);
      if (!item) continue;
      incoming.push(item);
    }
    if (!incoming.length) return [];
    const overlap = this.findSnapshotOverlap(incoming, history);
    this.save(label, incoming.concat(history.slice(overlap)));
    return incoming;
  },

  toStorageItem(label, result) {
    if (!this.getKey(label) || !result?.color) return null;
    const base = {
      color: this.normalizeColor(result.color),
      multiplier: result.multiplier || null,
      time: result.time || Date.now(),
      storageId: result.storageId || this.createStorageId()
    };
    if (label === 'wheel') {
      const item = { cellIndex: result.number, cellColor: base.color, multiplier: base.multiplier, time: base.time };
      if (result.roundId) item.roundId = result.roundId;
      else item.storageId = base.storageId;
      return item;
    }
    const item = { number: result.number, color: base.color, time: base.time };
    if (result.roundId) item.roundId = result.roundId;
    else item.storageId = base.storageId;
    return item;
  },

  createStorageId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  },

  normalizeColor(color) {
    return String(color || '').toLowerCase();
  },

  itemSignature(item) {
    const number = item.cellIndex ?? item.number ?? '';
    const color = this.normalizeColor(item.cellColor ?? item.color);
    return number + ':' + color + ':' + (item.multiplier || '');
  },

  stableKey(item) {
    if (item.roundId) return 'round:' + item.roundId;
    return '';
  },

  sameRoundOrSignature(a, b) {
    if (!a || !b) return false;
    const stableA = this.stableKey(a);
    const stableB = this.stableKey(b);
    if (stableA && stableB) return stableA === stableB;
    return this.itemSignature(a) === this.itemSignature(b);
  },

  isImmediateDuplicate(previous, item) {
    if (!previous) return false;
    const stablePrevious = this.stableKey(previous);
    const stableItem = this.stableKey(item);
    if (stablePrevious && stableItem) return stablePrevious === stableItem;
    const previousTime = Number(previous.time || 0);
    const itemTime = Number(item.time || Date.now());
    return this.itemSignature(previous) === this.itemSignature(item) &&
      previousTime > 0 &&
      Math.abs(itemTime - previousTime) < this.duplicateWindowMs;
  },

  findSnapshotOverlap(incoming, history) {
    const max = Math.min(incoming.length, history.length);
    for (let size = max; size > 0; size--) {
      let matches = true;
      for (let i = 0; i < size; i++) {
        if (!this.sameRoundOrSignature(incoming[incoming.length - size + i], history[i])) {
          matches = false;
          break;
        }
      }
      if (matches) return size;
    }
    return 0;
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
