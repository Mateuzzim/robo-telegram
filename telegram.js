const TelegramService = {
  tokenKey: 'telegram-bot-token',
  liveStoreKey: 'telegram-live-messages-v1',
  entryStoreKey: 'telegram-entry-messages-v1',
  entryEventStoreKey: 'telegram-entry-events-v1',
  errorStoreKey: 'telegram-last-error-v1',
  maintenanceStoreKey: 'telegram-maintenance-messages-v1',
  lockPrefix: 'telegram-live-lock:',
  ownerKey: 'telegram-owner-name',
  liveSendingTimeoutMs: 20000,
  clientId: uid(),
  initialized: false,
  queues: {},
  _cachedTime: '',
  _cachedTimeAt: 0,
  _normalProcessed: {},

  getCachedTime() {
    const now = Date.now();
    if (!this._cachedTime || now - this._cachedTimeAt > 60000) {
      this._cachedTime = formatTime(now);
      this._cachedTimeAt = now;
    }
    return this._cachedTime;
  },

  _signalLimitSent: new Set(),
  signalLimitProcessedKey: 'telegram-signal-limit-processed-v1',

  getSignalLimitProcessed() {
    try { return JSON.parse(localStorage.getItem(this.signalLimitProcessedKey) || '{}'); }
    catch { return {}; }
  },

  saveSignalLimitProcessed(data) {
    localStorage.setItem(this.signalLimitProcessedKey, JSON.stringify(data));
  },

  getSignalLimitNotificationKey(data, fallbackType, fallbackRobotId) {
    const type = data?.type || fallbackType || '';
    const robotId = data?.robotId || data?.id || fallbackRobotId || '';
    const time = data?.time || '';
    if (!type || !robotId || !time) return '';
    return [type, robotId, time].join(':');
  },

  shouldProcessSignalLimitNotification(data, fallbackType, fallbackRobotId) {
    const key = this.getSignalLimitNotificationKey(data, fallbackType, fallbackRobotId);
    if (!key) return true;
    const now = Date.now();
    const processed = this.getSignalLimitProcessed();
    Object.keys(processed).forEach(k => {
      if (now - processed[k] > 10 * 60 * 1000) delete processed[k];
    });
    if (processed[key]) {
      this.saveSignalLimitProcessed(processed);
      return false;
    }
    processed[key] = now;
    this.saveSignalLimitProcessed(processed);
    return true;
  },

  clearSignalLimitNotification(data, fallbackType, fallbackRobotId) {
    const handledKey = this.getSignalLimitNotificationKey(data, fallbackType, fallbackRobotId);
    if (!handledKey) return;
    try {
      const current = JSON.parse(localStorage.getItem('signalLimitNotify') || 'null');
      const currentKey = this.getSignalLimitNotificationKey(current, fallbackType, fallbackRobotId);
      if (currentKey === handledKey) localStorage.removeItem('signalLimitNotify');
    } catch {}
  },

  init() {
    if (this.initialized) return;
    this.initialized = true;
    EventBus.on('result:new', (result) => this.handleResultChange(result));
    EventBus.on('results:history', (history) => this.handleHistoryChange(history));
    EventBus.on('signal:created', (signal) => this.handleSignalCreated(signal));
    EventBus.on('signal:gale', (signal) => this.handleSignalChange(signal));
    EventBus.on('signal:win', (signal) => this.handleSignalChange(signal));
    EventBus.on('signal:loss', (signal) => this.handleSignalChange(signal));
    EventBus.on('signal:resolved', (signal) => this.handleSignalResolved(signal));
    EventBus.on('robot:started', (d) => this.handleRobotStarted(d));
    EventBus.on('robot:signalLimitStart', (d) => this.handleSignalLimitStart(d));
    EventBus.on('robot:signalLimitReached', (d) => this.handleSignalLimitReached(d));
    EventBus.on('robot:signalLimitUpdate', (d) => this.handleSignalLimitUpdate(d));
    EventBus.on('robot:signalLimitWarning', (d) => this.handleSignalLimitWarning(d));
    window.addEventListener('storage', (e) => {
      if (e.key === 'signalLimitNotify' && e.newValue) {
        try {
          const data = JSON.parse(e.newValue);
          if (data.type === 'start') this.handleSignalLimitStart(data);
          else if (data.type === 'reached') this.handleSignalLimitReached(data);
          else if (data.type === 'update') this.handleSignalLimitUpdate(data);
          else if (data.type === 'warning') this.handleSignalLimitWarning(data);
        } catch {}
      }
    });
    this.checkPendingSignalLimitNotifications();
    this.startRecalibration();
    setTimeout(() => this.sendAllPendingEntryMessages(), 0);
    setTimeout(() => this.sendAllInitialLiveMessages(), 0);
  },

  async sendAllInitialLiveMessages() {
    if (!this.initialized) return;
    const robots = RobotEngine.getAllRobots().filter(robot => (
      robot.status === 'online' && this.shouldSendLive(robot)
    ));
    for (const robot of robots) {
      if (this.isDynamicMode(robot)) {
        await this.updateDynamicMessage(robot);
      } else {
        await this.enqueueLiveMessage(robot);
      }
    }
  },

  startRecalibration() {
    setInterval(() => this.recalibrateAll(), 5 * 60 * 1000);
  },

  async recalibrateAll() {
    if (!this.hasAnyToken()) return;
    await this.cleanupStaleMessages();
    const robots = RobotEngine.getAllRobots().filter(r => (
      r.status === 'online' && this.shouldSendLive(r)
    ));
    for (const robot of robots) {
      await this.recalibrateRobot(robot);
    }
  },

  async recalibrateRobot(robot) {
    if (!this.hasAnyToken()) return;
    const destinations = this.getDestinations(robot);
    for (const dest of destinations) {
      const chatId = dest.channelId;
      if (!chatId) continue;
      const token = this.getTokenForChat(chatId);
      const prefix = this.entryMessageKey(robot, dest);
      const allEntries = this.getEntryMessages();
      const robotEntries = Object.entries(allEntries)
        .filter(([k]) => k.startsWith(prefix + ':') || k === prefix)
        .sort((a, b) => (b[1].updatedAt || b[1].createdAt || 0) - (a[1].updatedAt || a[1].createdAt || 0));

      if (robotEntries.length <= 1) continue;

      const keep = robotEntries[0];
      const toDelete = robotEntries.slice(1);
      for (const [key, msg] of toDelete) {
        if (msg.messageId) {
          await this.api(token, 'deleteMessage', { chat_id: chatId, message_id: msg.messageId }).catch(() => {});
        }
        delete allEntries[key];
      }
      this.saveEntryMessages(allEntries);
    }
    await this.enqueueLiveMessage(robot);
  },

  async cleanupStaleMessages() {
    if (!this.hasAnyToken()) return;
    const allRobots = RobotEngine.getAllStates();
    const robotIds = new Set(allRobots.map(r => r.id));
    const liveMessages = this.getLiveMessages();
    const maintenanceMessages = this.getMaintenanceMessages();
    let changed = false;
    for (const [key, msg] of Object.entries(liveMessages)) {
      const robotId = key.split(':')[0];
      if (!robotIds.has(robotId) && msg.messageId) {
        const chatId = key.split(':')[1] || '';
        if (chatId) {
          const token = this.getTokenForChat(chatId);
          await this.api(token, 'deleteMessage', { chat_id: chatId, message_id: msg.messageId }).catch(() => {});
        }
        delete liveMessages[key];
        changed = true;
      }
    }
    for (const [key, msg] of Object.entries(maintenanceMessages)) {
      const robotId = key.split(':')[0];
      if (!robotIds.has(robotId) && msg.messageId) {
        const chatId = msg.chatId || '';
        if (chatId) {
          const token = this.getTokenForChat(chatId);
          await this.api(token, 'deleteMessage', { chat_id: chatId, message_id: msg.messageId }).catch(() => {});
        }
        delete maintenanceMessages[key];
        changed = true;
      }
    }
    if (changed) {
      this.saveLiveMessages(liveMessages);
      this.saveMaintenanceMessages(maintenanceMessages);
    }
  },

  getToken() {
    return localStorage.getItem(this.tokenKey) || '';
  },

  getTokenGroup() {
    return localStorage.getItem('telegram-bot-token-grupos') || '';
  },

  hasAnyToken() {
    if (this.getToken() || this.getTokenGroup()) return true;
    try {
      const channels = JSON.parse(localStorage.getItem('telegram-channels') || '[]');
      return channels.some(ch => ch?.tokenKey && localStorage.getItem(ch.tokenKey));
    } catch { return false; }
  },

  getChannelType(channelId) {
    if (!channelId) return 'channel';
    try {
      const channels = JSON.parse(localStorage.getItem('telegram-channels') || '[]');
      const ch = channels.find(c => String(c.id) === String(channelId));
      return ch?.type || 'channel';
    } catch { return 'channel'; }
  },

  getChannelConfig(channelId) {
    if (!channelId) return null;
    try {
      const channels = JSON.parse(localStorage.getItem('telegram-channels') || '[]');
      return channels.find(c => String(c.id) === String(channelId)) || null;
    } catch { return null; }
  },

  getTokenForChat(channelId) {
    const channel = this.getChannelConfig(channelId);
    if (channel?.tokenKey) {
      const customToken = localStorage.getItem(channel.tokenKey);
      if (customToken) return customToken;
    }
    if (channelId && (channel?.type || this.getChannelType(channelId)) === 'group') {
      const groupToken = this.getTokenGroup();
      if (groupToken) return groupToken;
    }
    return this.getToken();
  },

  getLiveMessages() {
    try { return JSON.parse(localStorage.getItem(this.liveStoreKey) || '{}'); }
    catch { return {}; }
  },

  saveLiveMessages(data) {
    localStorage.setItem(this.liveStoreKey, JSON.stringify(data));
  },

  getEntryMessages() {
    try { return JSON.parse(localStorage.getItem(this.entryStoreKey) || '{}'); }
    catch { return {}; }
  },

  saveEntryMessages(data) {
    localStorage.setItem(this.entryStoreKey, JSON.stringify(data));
  },

  getEntryEvents() {
    try { return JSON.parse(localStorage.getItem(this.entryEventStoreKey) || '{}'); }
    catch { return {}; }
  },

  saveEntryEvents(data) {
    localStorage.setItem(this.entryEventStoreKey, JSON.stringify(data));
  },

  getMaintenanceMessages() {
    try { return JSON.parse(localStorage.getItem(this.maintenanceStoreKey) || '{}'); }
    catch { return {}; }
  },

  saveMaintenanceMessages(data) {
    localStorage.setItem(this.maintenanceStoreKey, JSON.stringify(data));
  },

  getDestinations(robot) {
    const tg = robot?.telegram || {};
    if (Array.isArray(tg.destinations) && tg.destinations.length > 0) {
      return tg.destinations.filter(d => d.channelId);
    }
    if (tg.channelId) {
      return [{ channelId: tg.channelId, threadId: tg.threadId || null }];
    }
    return [];
  },

  messageKey(robot, dest) {
    const chatId = dest?.channelId || robot.telegram?.channelId || '';
    const threadId = dest?.threadId ?? robot.telegram?.threadId ?? null;
    return [robot.id, chatId, threadId ? 't' + threadId : ''].filter(Boolean).join(':');
  },

  legacyMessageKey(robot, dest) {
    const chatId = dest?.channelId || robot.telegram?.channelId || '';
    return [robot.id, chatId].join(':');
  },

  migrateLegacyMessage(messages, robot, dest, key) {
    const legacyBase = this.legacyMessageKey(robot, dest);
    const legacyKey = key.endsWith(':entry') ? legacyBase + ':entry' : key.endsWith(':maint') ? legacyBase + ':maint' : legacyBase;
    if (key === legacyKey || messages[key] || !messages[legacyKey]) return false;
    messages[key] = {
      ...messages[legacyKey],
      chatId: messages[legacyKey].chatId || dest?.channelId || robot.telegram?.channelId || '',
      threadId: dest?.threadId ?? robot.telegram?.threadId ?? null
    };
    delete messages[legacyKey];
    return true;
  },

  entryMessageKey(robot, dest) {
    return this.messageKey(robot, dest) + ':entry';
  },

  maintenanceKey(robot, dest) {
    return this.messageKey(robot, dest) + ':maint';
  },

  isTelegramEnabled(robot) {
    if (!robot?.telegram?.enabled) return false;
    return this.getDestinations(robot).length > 0;
  },

  shouldSendLive(robot) {
    if (!this.isTelegramEnabled(robot)) return false;
    return ['live', 'both', 'dynamic', 'live_dynamic'].includes(this.getMessageType(robot));
  },

  shouldSendSignal(robot) {
    if (!this.isTelegramEnabled(robot)) return false;
    return ['signal', 'both', 'normal', 'dynamic', 'live_dynamic'].includes(this.getMessageType(robot));
  },

  getMessageType(robot) {
    const msgType = robot?.telegram?.msgType || 'both';
    return ['live', 'signal', 'both', 'normal', 'dynamic', 'live_dynamic'].includes(msgType) ? msgType : 'both';
  },

  isNormalMode(robot) {
    return this.getMessageType(robot) === 'normal';
  },

  isDynamicMode(robot) {
    return this.getMessageType(robot) === 'dynamic';
  },

  isLiveDynamicMode(robot) {
    return this.getMessageType(robot) === 'live_dynamic';
  },

  isDynamicEntryMode(robot) {
    return this.isDynamicMode(robot) || this.isLiveDynamicMode(robot);
  },

  async updateLiveMessages(result) {
    const game = result?.label || result?.game;
    if (!game) return;
    const robots = RobotEngine.getAllRobots().filter(robot => (
      robot.status === 'online' &&
      robot.game === game &&
      this.shouldSendLive(robot)
    ));
    for (const robot of robots) {
      if (this.isDynamicMode(robot)) {
        await this.updateDynamicMessage(robot);
      } else {
        await this.enqueueLiveMessage(robot);
      }
    }
  },

  async handleResultChange(result) {
    await this.updateLiveMessages(result);
    await this.sendPendingEntryMessages(result);
  },

  async handleHistoryChange(history) {
    const game = history?.label || history?.game;
    if (!game || !Array.isArray(history?.results) || !history.results.length) return;
    await this.updateLiveMessages({ label: game, game });
  },

  async handleRobotStarted(d) {
    const robot = RobotEngine.getRobot(d?.id);
    if (!robot || !this.shouldSendLive(robot)) return;
    if (robot.status !== 'online') return;
    if (this.isDynamicMode(robot)) {
      await this.updateDynamicMessage(robot);
    } else {
      await this.enqueueLiveMessage(robot);
    }
  },

  async sendPendingEntryMessages(result) {
    const game = result?.label || result?.game;
    await this.sendAllPendingEntryMessages(game);
  },

  async sendAllPendingEntryMessages(game) {
    const robots = RobotEngine.getAllRobots().filter(robot => (
      robot.status === 'online' &&
      (!game || robot.game === game) &&
      this.shouldSendSignal(robot) &&
      !this.isDynamicEntryMode(robot) &&
      robot.currentSignal &&
      !robot.currentSignal.entrySending &&
      (!robot.currentSignal.entrySent || !this.hasEntryMessageForAnyDest(robot, robot.currentSignal))
    ));
    for (const robot of robots) {
      const snapshot = { ...robot.currentSignal };
      if (robot.currentSignal?.id === snapshot.id) robot.currentSignal.entrySending = true;
      try {
        const sent = await this.enqueueEntryMessage(robot, snapshot);
        if (sent && robot.currentSignal?.id === snapshot.id) {
          robot.currentSignal.entrySent = true;
        } else if (!sent) {
          if (robot.currentSignal?.id === snapshot.id) robot.currentSignal.entrySent = false;
          this.forgetEntryEvent(snapshot.entryEventKey);
        }
      } finally {
        if (robot.currentSignal?.id === snapshot.id) robot.currentSignal.entrySending = false;
      }
    }
  },

  async handleSignalCreated(signal) {
    const robot = RobotEngine.getRobot(signal?.robotId);
    if (!this.shouldSendSignal(robot) || !signal?.id) return;
    const snapshot = {
      ...signal,
      result: signal.result ? { ...signal.result } : null,
      pattern: Array.isArray(signal.pattern) ? [...signal.pattern] : signal.pattern
    };

    if (this.isDynamicMode(robot)) {
      if (robot.currentSignal?.id === signal.id) robot.currentSignal.entrySending = true;
      try {
        const destinations = this.getDestinations(robot);
        for (const dest of destinations) {
          await this.updateDynamicMessage(robot, dest);
        }
        if (robot.currentSignal?.id === snapshot.id) robot.currentSignal.entrySent = true;
      } finally {
        if (robot.currentSignal?.id === snapshot.id) robot.currentSignal.entrySending = false;
      }
    } else {
      if (robot.currentSignal?.id === signal.id) robot.currentSignal.entrySending = true;
      try {
        let sent;
        if (this.isLiveDynamicMode(robot)) {
          sent = await this.sendFreshEntryMessage(robot, snapshot);
        } else {
          sent = await this.enqueueEntryMessage(robot, snapshot);
        }
        if (sent && robot.currentSignal?.id === snapshot.id) {
          robot.currentSignal.entrySent = true;
        } else if (!sent) {
          if (robot.currentSignal?.id === snapshot.id) robot.currentSignal.entrySent = false;
          this.forgetEntryEvent(snapshot.entryEventKey);
        }
        if (this.shouldSendLive(robot)) {
          this.enqueueLiveMessage(robot);
        }
      } finally {
        if (robot.currentSignal?.id === snapshot.id) robot.currentSignal.entrySending = false;
      }
    }
  },

  async refreshResolvedEntryMessages(result) {
    const game = result?.label || result?.game;
    if (!game) return;
    const robots = RobotEngine.getAllRobots().filter(robot => (
      robot.status === 'online' &&
      robot.game === game &&
      this.shouldSendSignal(robot) &&
      !robot.currentSignal
    ));

    for (const robot of robots) {
      const destinations = this.getDestinations(robot);
      for (const dest of destinations) {
        const messages = this.getEntryMessages();
        const key = this.entryMessageKey(robot, dest);
        const current = messages[key];
        const status = String(current?.status || '').toLowerCase();
        if (status !== 'win' && status !== 'loss') continue;

        const historyResultKey = this.getRobotResultKey(robot, result);
        if (historyResultKey && current.historyResultKey === historyResultKey) continue;

        const lastSignal = robot.lastSignal || {};
        const snapshot = {
          id: current.signalId || lastSignal.id || key,
          status,
          gale: current.gale || lastSignal.gale || 0,
          result: current.result || lastSignal.result || null,
          entryEventKey: 'refresh|' + key + '|' + status + '|' + (historyResultKey || Date.now()),
          historyResultKey
        };
        await this.enqueueEntryMessage(robot, snapshot);
      }
    }
  },

  async handleSignalChange(signal) {
    const robot = RobotEngine.getRobot(signal?.robotId);
    if (!this.shouldSendSignal(robot) || !signal?.id) return;
    const snapshot = {
      ...signal,
      result: signal.result ? { ...signal.result } : null,
      pattern: Array.isArray(signal.pattern) ? [...signal.pattern] : signal.pattern
    };
    const status = String(snapshot.status || 'approved').toLowerCase();
    const shouldSend = status === 'win' || status === 'loss' || status === 'gale_pending';
    if (!shouldSend) return;

    if (this.isDynamicMode(robot)) {
      const destinations = this.getDestinations(robot);
      for (const dest of destinations) {
        await this.updateDynamicMessage(robot, dest);
      }
    } else if (this.isLiveDynamicMode(robot)) {
      await this.sendFreshEntryMessage(robot, snapshot);
    } else {
      await this.enqueueEntryMessage(robot, snapshot);
    }
    if (!this.isDynamicMode(robot) && this.shouldSendLive(robot)) {
      this.enqueueLiveMessage(robot);
    }
  },

  async handleSignalResolved(signal) {
    const robot = RobotEngine.getRobot(signal?.robotId);
    if (!robot || !this.isDynamicEntryMode(robot)) return;
    if (this.isDynamicMode(robot)) {
      await this.updateDynamicMessage(robot);
    }
    if (!robot.currentSignal) {
      setTimeout(() => {
        const current = RobotEngine.getRobot(robot.id);
        if (current && !current.currentSignal && this.isDynamicEntryMode(current)) {
          if (this.isDynamicMode(current)) {
            this.updateDynamicMessage(current);
          } else {
            this.sendFreshEntryMessage(current, { id: 'cleanup' });
          }
        }
      }, 5000);
    }
  },

  entryEventKey(robot, signal, dest) {
    if (!robot || !signal?.id) return '';
    const result = signal.result || {};
    const resultKey = signal.lastCheckedResultKey || signal.waitingAfterResultKey || signal.sourceResultKey ||
      [result.color || '', result.number ?? '', result.multiplier || ''].join(':');
    const chatId = dest?.channelId || robot.telegram?.channelId || '';
    const threadId = dest?.threadId ?? robot.telegram?.threadId ?? '';
    return [
      robot.id,
      chatId,
      threadId ? 't' + threadId : 'main',
      signal.id,
      signal.status || 'approved',
      signal.gale || 0,
      resultKey
    ].join('|');
  },

  getRobotResultKey(robot, result) {
    if (!robot || !result) return '';
    if (typeof robot.normalizeResult === 'function' && typeof robot.getResultKey === 'function') {
      return robot.getResultKey(robot.normalizeResult(result));
    }
    const color = String(result.color ?? result.cellColor ?? '').toUpperCase();
    const number = result.number ?? result.cellIndex ?? '';
    return color + ':' + number;
  },

  hasEntryMessageForSignal(robot, signal, dest) {
    if (!robot || !signal?.id) return false;
    const messages = this.getEntryMessages();
    const current = messages[this.entryMessageKey(robot, dest)];
    return current?.signalId === signal.id && !!current.messageId;
  },

  hasEntryMessageForAnyDest(robot, signal) {
    if (!robot || !signal?.id) return false;
    const destinations = this.getDestinations(robot);
    return destinations.some(dest => this.hasEntryMessageForSignal(robot, signal, dest));
  },

  shouldProcessEntryEvent(robot, signal, dest) {
    const eventKey = this.entryEventKey(robot, signal, dest);
    if (!eventKey) return true;
    const events = this.getEntryEvents();
    if (events[eventKey]) {
      const current = this.getEntryMessages()[this.entryMessageKey(robot, dest)];
      if (current?.eventKey === eventKey && current.messageId) return false;
      delete events[eventKey];
    }
    events[eventKey] = Date.now();
    const entries = Object.entries(events).sort((a, b) => b[1] - a[1]).slice(0, 300);
    this.saveEntryEvents(Object.fromEntries(entries));
    signal.entryEventKey = eventKey;
    return true;
  },

  forgetEntryEvent(eventKey) {
    if (!eventKey) return;
    const events = this.getEntryEvents();
    if (!events[eventKey]) return;
    delete events[eventKey];
    this.saveEntryEvents(events);
  },

  isNormalProcessed(robotId, signalId, status, gale, dest) {
    const destKey = dest?.channelId || '';
    const key = robotId + '|' + signalId + '|' + status + '|' + (gale || 0) + '|' + destKey;
    const entry = this._normalProcessed[key];
    if (!entry) return false;
    if (Date.now() - entry > 5000) {
      delete this._normalProcessed[key];
      return false;
    }
    return true;
  },

  markNormalProcessed(robotId, signalId, status, gale, dest) {
    const destKey = dest?.channelId || '';
    const key = robotId + '|' + signalId + '|' + status + '|' + (gale || 0) + '|' + destKey;
    this._normalProcessed[key] = Date.now();
  },

  async enqueueEntryMessage(robot, signal) {
    const destinations = this.getDestinations(robot);
    let anySent = false;
    for (const dest of destinations) {
      const key = 'entry:' + this.entryMessageKey(robot, dest);
      const task = () => this.withLock(key, async () => {
        if (!this.shouldProcessEntryEvent(robot, signal, dest)) return true;
        if (this.isNormalMode(robot)) {
          if (this.isNormalProcessed(robot.id, signal.id, signal.status, signal.gale, dest)) return true;
          const sent = await this.sendEntryNormal(robot, signal, dest);
          if (sent) this.markNormalProcessed(robot.id, signal.id, signal.status, signal.gale, dest);
          return sent;
        }
        return this.sendEntryMessage(robot, signal, dest);
      });
      if (this.isNormalMode(robot)) {
        const sent = await this.enqueue(key, task);
        if (sent) anySent = true;
      } else {
        const sent = await this.enqueue(key, task);
        if (sent) anySent = true;
      }
    }
    return anySent;
  },

  async enqueueLiveMessage(robot) {
    const destinations = this.getDestinations(robot);
    for (const dest of destinations) {
      const key = 'live:' + this.messageKey(robot, dest);
      const task = this.isNormalMode(robot)
        ? () => this.sendLiveNormal(robot, dest)
        : () => this.withLock(key, () => this.sendOrEditLiveMessage(robot, dest));
      this.enqueue(key, task);
    }
  },

  async enqueue(key, task) {
    const previous = this.queues[key] || Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    this.queues[key] = current;
    try {
      return await current;
    } finally {
      if (this.queues[key] === current) delete this.queues[key];
    }
  },

  async withLock(key, task) {
    const lockKey = this.lockPrefix + key;
    const now = Date.now();
    const lock = this.readLock(lockKey);
    if (lock && lock.expiresAt > now && lock.owner !== this.clientId) return false;

    localStorage.setItem(lockKey, JSON.stringify({ owner: this.clientId, expiresAt: now + 12000 }));
    const confirmed = this.readLock(lockKey);
    if (!confirmed || confirmed.owner !== this.clientId) return false;

    try {
      return await task();
    } finally {
      const current = this.readLock(lockKey);
      if (current?.owner === this.clientId) localStorage.removeItem(lockKey);
    }
  },

  readLock(lockKey) {
    try { return JSON.parse(localStorage.getItem(lockKey) || 'null'); }
    catch { return null; }
  },

  async sendOrEditLiveMessage(robot, dest) {
    const chatId = dest?.channelId || '';
    const token = this.getTokenForChat(chatId);
    const threadId = dest?.threadId ?? null;
    if (!token || !chatId) return false;

    const text = this.prepareTelegramText(this.buildLiveMessage(robot));
    const messages = this.getLiveMessages();
    const key = this.messageKey(robot, dest);
    if (this.migrateLegacyMessage(messages, robot, dest, key)) this.saveLiveMessages(messages);
    const current = messages[key];
    if (current?.sending && Date.now() - (current.updatedAt || 0) < this.liveSendingTimeoutMs) return false;
    if (current?.messageId && current?.text === text) return true;
    if (current?.updatedAt && Date.now() - current.updatedAt < 5000 && !current?.messageId) return false;

    if (current?.messageId) {
      const editPayload = {
        chat_id: chatId,
        message_id: current.messageId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      };
      if (threadId) editPayload.message_thread_id = threadId;
      const edited = await this.api(token, 'editMessageText', editPayload);
      if (edited.ok) {
        messages[key].text = text;
        messages[key].updatedAt = Date.now();
        this.saveLiveMessages(messages);
        return true;
      }
      if (this.isNotModified(edited)) {
        messages[key].text = text;
        messages[key].updatedAt = Date.now();
        this.saveLiveMessages(messages);
        return true;
      }
      if (this.isEditMessageNotFound(edited)) {
        delete messages[key];
        this.saveLiveMessages(messages);
      } else if (this.isMessageCantBeEdited(edited)) {
        const deleted = await this.api(token, 'deleteMessage', {
          chat_id: chatId,
          message_id: current.messageId
        });
        if (!deleted.ok && !this.isAlreadyDeleted(deleted)) {
          this.logApiError('editMessageText/live', edited);
          this.logApiError('deleteMessage/live', deleted);
          return false;
        }
        delete messages[key];
        this.saveLiveMessages(messages);
      } else {
        this.logApiError('editMessageText/live', edited);
        return false;
      }
    }

    const pending = this.getLiveMessages();
    pending[key] = {
      sending: true,
      text,
      robotId: robot.id,
      chatId,
      owner: this.clientId,
      updatedAt: Date.now()
    };
    this.saveLiveMessages(pending);

    const sendPayload = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    };
    if (threadId) sendPayload.message_thread_id = threadId;
    const sent = await this.api(token, 'sendMessage', sendPayload);
    if (sent.ok && sent.result?.message_id) {
      const latest = this.getLiveMessages();
      latest[key] = { messageId: sent.result.message_id, text, updatedAt: Date.now() };
      this.saveLiveMessages(latest);
      return true;
    } else {
      const latest = this.getLiveMessages();
      if (latest[key]?.sending && latest[key]?.owner === this.clientId) {
        delete latest[key];
        this.saveLiveMessages(latest);
      }
      this.logApiError('sendMessage/live', sent);
      return false;
    }
  },

  async sendLiveNormal(robot, dest) {
    const chatId = dest?.channelId || '';
    const token = this.getTokenForChat(chatId);
    const threadId = dest?.threadId ?? null;
    if (!token || !chatId) return false;

    const text = this.prepareTelegramText(this.buildLiveMessage(robot));

    const sendPayload = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    };
    if (threadId) sendPayload.message_thread_id = threadId;
    const sent = await this.api(token, 'sendMessage', sendPayload);
    if (sent.ok && sent.result?.message_id) {
      return true;
    } else {
      this.logApiError('sendMessage/live-normal', sent);
      return false;
    }
  },

  async sendEntryNormal(robot, signal, dest) {
    const chatId = dest?.channelId || '';
    const token = this.getTokenForChat(chatId);
    const threadId = dest?.threadId ?? null;
    if (!token || !chatId) return false;

    const key = this.entryMessageKey(robot, dest);
    const text = this.prepareTelegramText(this.buildEntryMessage(robot, signal));

    const sendPayload = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    };
    if (threadId) sendPayload.message_thread_id = threadId;
    const sent = await this.api(token, 'sendMessage', sendPayload);
    if (sent.ok && sent.result?.message_id) {
      const latest = this.getEntryMessages();
      latest[key] = {
        messageId: sent.result.message_id,
        text,
        robotId: robot.id,
        chatId,
        signalId: signal.id,
        status: signal.status || 'approved',
        gale: signal.gale || 0,
        result: signal.result ? { ...signal.result } : null,
        eventKey: signal.entryEventKey || '',
        historyResultKey: signal.historyResultKey || signal.lastCheckedResultKey || signal.waitingAfterResultKey || signal.sourceResultKey || '',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      this.saveEntryMessages(latest);
      return true;
    } else {
      this.logApiError('sendMessage/entry-normal', sent);
      return false;
    }
  },

  async sendEntryMessage(robot, signal, dest) {
    const chatId = dest?.channelId || '';
    const token = this.getTokenForChat(chatId);
    const threadId = dest?.threadId ?? null;
    if (!token || !chatId) return false;

    const key = this.entryMessageKey(robot, dest);
    const text = this.prepareTelegramText(this.buildEntryMessage(robot, signal));
    const messages = this.getEntryMessages();
    if (this.migrateLegacyMessage(messages, robot, dest, key)) this.saveEntryMessages(messages);
    const current = messages[key];
    const messageId = current?.messageId;
    if (messageId && current?.text === text) return true;
    if (current?.updatedAt && Date.now() - current.updatedAt < 3000 && !messageId) return false;

    if (messageId) {
      const editPayload = {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      };
      if (threadId) editPayload.message_thread_id = threadId;
      const edited = await this.api(token, 'editMessageText', editPayload);
      if (edited.ok) {
        const latest = this.getEntryMessages();
        latest[key] = {
          messageId,
          text,
          robotId: robot.id,
          chatId,
          signalId: signal.id,
          status: signal.status || 'approved',
          gale: signal.gale || 0,
          result: signal.result ? { ...signal.result } : null,
          eventKey: signal.entryEventKey || '',
          historyResultKey: signal.historyResultKey || signal.lastCheckedResultKey || signal.waitingAfterResultKey || signal.sourceResultKey || '',
          createdAt: current.createdAt || Date.now(),
          updatedAt: Date.now()
        };
        this.saveEntryMessages(latest);
        return true;
      }
      if (this.isNotModified(edited)) {
        const latest = this.getEntryMessages();
        latest[key] = {
          messageId,
          text,
          robotId: robot.id,
          chatId,
          signalId: signal.id,
          status: signal.status || 'approved',
          gale: signal.gale || 0,
          result: signal.result ? { ...signal.result } : null,
          eventKey: signal.entryEventKey || '',
          historyResultKey: signal.historyResultKey || signal.lastCheckedResultKey || signal.waitingAfterResultKey || signal.sourceResultKey || '',
          createdAt: current.createdAt || Date.now(),
          updatedAt: Date.now()
        };
        this.saveEntryMessages(latest);
        return true;
      }
      if (this.isEditMessageNotFound(edited)) {
        delete messages[key];
        this.saveEntryMessages(messages);
      } else if (this.isMessageCantBeEdited(edited)) {
        const deleted = await this.api(token, 'deleteMessage', {
          chat_id: chatId,
          message_id: messageId
        });
        if (!deleted.ok && !this.isAlreadyDeleted(deleted)) {
          this.logApiError('editMessageText/entry', edited);
          this.logApiError('deleteMessage/entry', deleted);
          return false;
        }
        delete messages[key];
        this.saveEntryMessages(messages);
      } else {
        this.logApiError('editMessageText/entry', edited);
        return false;
      }
    }

    const sendPayload = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    };
    if (threadId) sendPayload.message_thread_id = threadId;
    const sent = await this.api(token, 'sendMessage', sendPayload);
    if (sent.ok && sent.result?.message_id) {
      const latest = this.getEntryMessages();
      latest[key] = {
        messageId: sent.result.message_id,
        text,
        robotId: robot.id,
        chatId,
        signalId: signal.id,
        status: signal.status || 'approved',
        gale: signal.gale || 0,
        result: signal.result ? { ...signal.result } : null,
        eventKey: signal.entryEventKey || '',
        historyResultKey: signal.historyResultKey || signal.lastCheckedResultKey || signal.waitingAfterResultKey || signal.sourceResultKey || '',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      this.saveEntryMessages(latest);
      return true;
    } else {
      this.logApiError('sendMessage/entry', sent);
      return false;
    }
  },

  async deleteExistingEntryMessages(robot, exactKey) {
    if (!this.hasAnyToken() || !robot) return true;
    const messages = this.getEntryMessages();
    const matching = Object.entries(messages).filter(([key, msg]) => (
      key === exactKey ||
      this.isEntryMessageKeyForRobot(key, robot)
    ));
    if (!matching.length) return true;

    for (const [key, msg] of matching) {
      const messageId = msg?.messageId || msg?.message_id;
      const chatId = msg?.chatId || this.chatIdFromEntryKey(key, robot) || robot.telegram?.channelId || '';
      if (messageId && chatId) {
        const token = this.getTokenForChat(chatId);
        const deleted = await this.api(token, 'deleteMessage', {
          chat_id: chatId,
          message_id: messageId
        });
        if (!deleted.ok && !this.isAlreadyDeleted(deleted)) {
          this.logApiError('deleteMessage/entry', {
            ...deleted,
            description: (deleted.description || 'Erro desconhecido') + ' | chat_id=' + chatId + ' message_id=' + messageId
          });
        }
      }
      delete messages[key];
    }
    this.saveEntryMessages(messages);
    return true;
  },

  isEntryMessageKeyForRobot(key, robot) {
    return String(key || '').startsWith(robot.id + ':') && String(key || '').endsWith(':entry');
  },

  chatIdFromEntryKey(key, robot) {
    const value = String(key || '');
    const prefix = robot.id + ':';
    const suffix = ':entry';
    if (!value.startsWith(prefix) || !value.endsWith(suffix)) return '';
    const middle = value.slice(prefix.length, -suffix.length);
    const parts = middle.split(':');
    return parts[0] || '';
  },

  isNotModified(response) {
    return response?.description && response.description.toLowerCase().includes('message is not modified');
  },

  isEditMessageNotFound(response) {
    const description = String(response?.description || '').toLowerCase();
    return (
      description.includes('message to edit not found') ||
      description.includes('message identifier is not specified') ||
      description.includes('message_id_invalid')
    );
  },

  isMessageCantBeEdited(response) {
    const description = String(response?.description || '').toLowerCase();
    return description.includes('message can\'t be edited');
  },

  isRecoverableEditError(response) {
    const description = String(response?.description || '').toLowerCase();
    return (
      description.includes('message to edit not found') ||
      description.includes('message can\'t be edited') ||
      description.includes('message identifier is not specified') ||
      description.includes('message_id_invalid') ||
      description.includes('message is not modified') ||
      description.includes('bad request') ||
      description.includes('invalid')
    );
  },

  isAlreadyDeleted(response) {
    const description = String(response?.description || '').toLowerCase();
    return (
      description.includes('message to delete not found') ||
      description.includes('message to be deleted not found') ||
      description.includes('message not found') ||
      description.includes('message_id_invalid') ||
      description.includes('chat not found') ||
      description.includes('bot was blocked') ||
      description.includes('user is deactivated') ||
      description.includes('bad request')
    );
  },

  logApiError(context, response) {
    if (!response || response.ok) return;
    const error = {
      context,
      errorCode: response.error_code || response.status || '',
      description: response.description || 'Erro desconhecido',
      at: Date.now()
    };
    try { localStorage.setItem(this.errorStoreKey, JSON.stringify(error)); } catch {}
    console.warn('[Telegram]', context, error.description, error);
  },

  async api(token, method, payload) {
    try {
      const response = await fetch('https://api.telegram.org/bot' + token + '/' + method, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok && !data.description) {
        data.description = 'HTTP ' + response.status + ' ao chamar ' + method;
      }
      if (!data.status) data.status = response.status;
      return data;
    } catch (error) {
      return { ok: false, description: error.message };
    }
  },

  prepareTelegramText(text) {
    const value = String(text || '').trim();
    if (value.length <= 4096) return value || ' ';
    return value.slice(0, 4050) + '\n\n[Mensagem reduzida para limite do Telegram]';
  },

  buildEntryMessage(robot, signal) {
    const custom = robot?.telegram?.message?.entry;
    if (custom) {
      return this.applyEntryTemplate(robot, signal, custom);
    }
    const stats = robot.stats || {};
    const wins = stats.wins || 0;
    const losses = stats.losses || 0;
    const resolved = wins + losses;
    const rate = resolved > 0 ? Math.round((wins / resolved) * 100) : 0;

    if (signal.status === 'win') {
      const resultEmoji = this.colorEmoji(signal.result?.color);
      const resultLabel = this.colorLabel(signal.result?.color);
      return [
        '✅ <b>WIN! WIN! WIN!</b> ✅',
        '━━━━━━━━━━━━━━━━━━━',
        'Resultado: ' + resultEmoji + ' <b>' + resultLabel + '</b>',
        '━━━━━━━━━━━━━━━━━━━',
        '📊 PLACAR: ✅<b>' + wins + '</b>W / ❌<b>' + losses + '</b>L (<b>' + rate + '%</b>)',
      ].join('\n');
    }

    if (signal.status === 'loss') {
      const resultEmoji = this.colorEmoji(signal.result?.color);
      const resultLabel = this.colorLabel(signal.result?.color);
      return [
        '❌ <b>LOSS! LOSS!</b> ❌',
        '━━━━━━━━━━━━━━━━━━━',
        'Resultado: ' + resultEmoji + ' <b>' + resultLabel + '</b>',
        '━━━━━━━━━━━━━━━━━━━',
        '📊 PLACAR: ✅<b>' + wins + '</b>W / ❌<b>' + losses + '</b>L (<b>' + rate + '%</b>)',
      ].join('\n');
    }

    if (signal.status === 'gale_pending') {
      const resultEmoji = this.colorEmoji(signal.result?.color);
      const resultLabel = this.colorLabel(signal.result?.color);
      const target = this.getSignalTarget(robot, signal);
      const resultMult = this.getMultiplierLabel(signal.result?.color, robot.game);
      const greenProt = robot.greenProtection && robot.game === 'double' ? ' + 🟢' : '';
      const targetLabel = this.colorLabel(target.color);
      return [
        '⚠️ <b>G' + (signal.gale || 1) + ' - ENTRAR=</b> ' + target.emoji + greenProt + ' <b>' + targetLabel + '</b>',
      ].join('\n');
    }

    const target = this.getSignalTarget(robot, signal);
    const greenProt = robot.greenProtection && robot.game === 'double';
    const greenProtLabel = greenProt ? ' + 🟢' : '';
    let galeMax;
    if (robot.game === 'wheel') {
      const galeByColor = robot.galeByColor || {};
      const colorKey = { RED: 'red', BLACK: 'grey', GREY: 'grey', BLUE: 'blue', GREEN: 'green' };
      const key = colorKey[target.color] || 'grey';
      galeMax = galeByColor[key] ?? 1;
    } else {
      galeMax = robot.gale?.max || 0;
    }
    const galeLine = galeMax > 0 ? '⚡️ <b>GALE ATÉ: G' + galeMax + '</b>' : '⚡️ <b>ENTRADA SECA</b>';
    const targetLine = '🎯 <b>ENTRAR NA COR=</b> ' + target.emoji + greenProtLabel + '<b>' + this.colorLabel(target.color) + '</b>';
    return [
      targetLine,
      '',
      '━━━━━━━━━━━━━━━━━━━━',
      '🤖 <b>SINAL ENCONTRADO</b> 🤖',
      galeLine,
      '📈 <b>Aproveitamento:</b> <b>' + rate + '%</b>',
      this.formatRateBar(rate)
    ].join('\n');
  },

  applyEntryTemplate(robot, signal, template) {
    const stats = robot.stats || {};
    const wins = stats.wins || 0;
    const losses = stats.losses || 0;
    const resolved = wins + losses;
    const rate = resolved > 0 ? Math.round((wins / resolved) * 100) : 0;
    const target = this.getSignalTarget(robot, signal);
    const status = signal.status || 'approved';
    const greenProt = robot.greenProtection && robot.game === 'double';
    const greenProtLabel = greenProt ? ' + 🟢' : '';
    let galeMax;
    if (robot.game === 'wheel') {
      const galeByColor = robot.galeByColor || {};
      const colorKey = { RED: 'red', BLACK: 'grey', GREY: 'grey', BLUE: 'blue', GREEN: 'green' };
      const key = colorKey[target.color] || 'grey';
      galeMax = galeByColor[key] ?? 1;
    } else {
      galeMax = robot.gale?.max || 0;
    }
    const galeLine = galeMax > 0 ? '⚡️ <b>GALE ATÉ: G' + galeMax + '</b>' : '⚡️ <b>ENTRADA SECA</b>';
    const map = {
      '{wins}': '<b>' + wins + '</b>',
      '{losses}': '<b>' + losses + '</b>',
      '{rate}': '<b>' + rate + '%</b>',
      '{signals}': '<b>' + (stats.signals || 0) + '</b>',
      '{target}': target.emoji + greenProtLabel,
      '{targetEmoji}': target.emoji,
      '{targetColor}': '<b>' + target.color + '</b>',
      '{greenProtection}': greenProtLabel,
      '{greenProtectionLabel}': greenProt ? '<b>PROTEÇÃO VERDE ATIVA</b>' : '',
      '{galeLine}': galeLine,
      '{galeLevels}': this.formatGaleInstruction(robot),
      '{confidence}': '<b>' + (signal.confidence || 0) + '%</b>',
      '{gale}': '<b>G' + (signal.gale || 0) + '</b>',
      '{galeMax}': '<b>G' + galeMax + '</b>',
      '{robotName}': '<b>' + (robot.name || '') + '</b>',
      '{game}': robot.game === 'wheel' ? '<b>Wheel</b>' : '<b>Double</b>',
      '{strategy}': '<b>' + this.formatStrategy(robot.strategy) + '</b>',
      '{status}': '<b>' + status + '</b>',
      '{history}': '',
      '{historyEmojis}': '',
      '{lastResult}': robot.lastResult ? this.colorEmoji(robot.lastResult.color) + ' <b>' + this.colorLabel(robot.lastResult.color) + '</b>' : '--',
      '{diagnosticStatus}': '<b>' + (robot.diagnostic?.status || 'IDLE') + '</b>',
      '{confidenceDiag}': '<b>' + (robot.diagnostic?.confidence || 0) + '%</b>',
      '{pattern}': '<b>' + (robot.diagnostic?.mainPattern || '--') + '</b>',
      '{time}': '<b>' + this.getCachedTime() + '</b>'
    };
    return template.replace(/\{[^}]+\}/g, (key) => map[key] !== undefined ? map[key] : key);
  },

  buildLiveMessage(robot) {
    const custom = robot?.telegram?.message?.live;
    if (custom) {
      return this.applyLiveTemplate(robot, custom);
    }
    const gameName = robot.game === 'wheel' ? 'WHEEL' : 'DOUBLE';
    const stats = robot.stats || {};
    const wins = stats.wins || 0;
    const losses = stats.losses || 0;
    const sent = stats.signals || 0;
    const sg = stats.winSG || 0;
    const g1 = stats.winG1 || 0;
    const g2 = stats.winG2 || 0;
    const resolved = wins + losses;
    const rate = resolved > 0 ? Math.round((wins / resolved) * 100) : 0;
    const owner = localStorage.getItem(this.ownerKey) || '';
    const d = robot.diagnostic || {};
    const lastResultEmoji = robot.lastResult ? this.colorEmoji(robot.lastResult.color) : '--';
    const lastResultLabel = this.colorLabel(robot.lastResult?.color);
    const gameLabel = robot.game === 'wheel' ? 'Wheel' : 'Double';
    const effectiveStrategy = robot.strategy === 'multi'
      ? (robot.currentSignal?.strategy || robot.lastSignal?.strategy || robot.strategy)
      : robot.strategy;
    const strategyLabel = this.formatStrategy(effectiveStrategy);
    const modeLabel = robot.mode === 'monitoramento' ? 'Monitoramento' : robot.mode === 'telegram' ? 'Telegram' : robot.mode;
    const entryEmoji = d.suggestedEntry ? this.colorEmoji(d.suggestedEntry) : '';
    const entryLabel = this.colorLabel(d.suggestedEntry);
    const galeMax = robot.gale?.max || 0;
    const galeInstruction = this.formatGaleInstruction(robot);
    const sequence = this.getSequenceStats(robot);

    return [
      '━━ 🚨 <b>' + gameName + ' AO VIVO</b> 🚨',
      '🤖 <b>NOME DO ROBÔ:</b> ' + robot.name,
      '',
      '━━ 📊 <b>STATUS DO ROBÔ</b> ━━',
      '🟢 <b>Status:</b> ' + (robot.status === 'online' ? 'Online' : robot.status === 'offline' ? 'Offline' : robot.status) + ' 🎮 <b>Jogo:</b> ' + gameLabel,
      '♟️ <b>Estratégia:</b> ' + strategyLabel,
      '🔄 <b>Modo:</b> ' + modeLabel,
      '🎯 <b>Último Resultado:</b> ' + lastResultEmoji + ' ' + lastResultLabel,
      '',
      '━━ 🧠 <b>DIAGNÓSTICO DA IA</b> ━━',
      robot.iaInteligente ? '🧠 <b>IA Inteligente:</b> ' + ((robot.iaState||{}).activeStrategy||'--') + ' → ' + ((robot.iaState||{}).activeTarget||'--') + ' ' + ((robot.iaState||{}).activeMultiplier||'') + 'X' : '',
      '📡 <b>Status:</b> ' + (d.status || 'IDLE'),
      '📊 <b>' + Math.min(d.analyzedResults || 0, robot.resultsToAnalyze || 500) + '/' + (robot.resultsToAnalyze || 500) + ' Resultados Analisados</b>',
      '🔥 <b>Confiança:</b> ' + (d.confidence || 0) + '%',
      '🔍 <b>Padrão:</b> ' + (d.mainPattern || '--'),
      '🎯 <b>Entrada:</b>  ' + entryEmoji + ' ' + entryLabel,
      '⭐ <b>Score:</b> ' + (d.totalScore || 0) + '/100',
      '',
      '━━ 🎡 <b>HISTÓRICO RECENTE</b> 🎡 ━━',
      this.formatRecentHistory(robot),
      '━━ 🏆 <b>RESULTADO DA SESSÃO</b> 🏆 ━━',
      '✅ <b>WIN:</b> ' + wins + ' | ❌ <b>LOSS:</b> ' + losses,
      '━━━━━━━━━━━━━━━━━━━━',
      '📨 <b>Sinais Enviados:</b> ' + sent,
      '━━━━━━━━━━━━━━━━━━━━',
      '📊 <b>APROVEITAMENTO</b>',
      this.formatRateBar(rate) + '  <b>' + rate + '%</b>',
      '━━━━━━━━━━━━━━━━━━━━',
      '🌐 <b>Site:</b> ',
      '🕕 <b>Horário Atual:</b> ' + this.getCachedTime()
    ].filter(line => line !== null).join('\n');
  },

  applyLiveTemplate(robot, template) {
    const stats = robot.stats || {};
    const wins = stats.wins || 0;
    const losses = stats.losses || 0;
    const resolved = wins + losses;
    const rate = resolved > 0 ? Math.round((wins / resolved) * 100) : 0;
    const d = robot.diagnostic || {};
    const lastResultEmoji = robot.lastResult ? this.colorEmoji(robot.lastResult.color) : '--';
    const lastResultLabel = this.colorLabel(robot.lastResult?.color);
    const gameLabel = robot.game === 'wheel' ? 'Wheel' : 'Double';
    const strategyLabel = this.formatStrategy(robot.strategy);
    const modeLabel = robot.mode === 'monitoramento' ? 'Monitoramento' : robot.mode === 'telegram' ? 'Telegram' : robot.mode;
    const entryEmoji = d.suggestedEntry ? this.colorEmoji(d.suggestedEntry) : '';
    const entryLabel = this.colorLabel(d.suggestedEntry);
    const galeMax = robot.gale?.max || 0;
    const galeInstruction = this.formatGaleInstruction(robot);
    const map = {
      '{wins}': '<b>' + wins + '</b>',
      '{losses}': '<b>' + losses + '</b>',
      '{rate}': '<b>' + rate + '%</b>',
      '{signals}': '<b>' + (stats.signals || 0) + '</b>',
      '{winSG}': '<b>' + (stats.winSG || 0) + '</b>',
      '{winG1}': '<b>' + (stats.winG1 || 0) + '</b>',
      '{winG2}': '<b>' + (stats.winG2 || 0) + '</b>',
      '{galeMax}': '<b>G' + galeMax + '</b>',
      '{GALE_MAX}': '<b>G' + galeMax + '</b>',
      '{galeInstruction}': '<b>' + galeInstruction + '</b>',
      '{GALE_INSTRUCTION}': '<b>' + galeInstruction + '</b>',
      '{protection}': '<b>' + this.formatProtection(robot) + '</b>',
      '{PROTECTION}': '<b>' + this.formatProtection(robot) + '</b>',
      '{robotName}': '<b>' + (robot.name || '') + '</b>',
      '{game}': '<b>' + gameLabel + '</b>',
      '{gameName}': '<b>' + (robot.game === 'wheel' ? 'WHEEL' : 'DOUBLE') + '</b>',
      '{strategy}': '<b>' + strategyLabel + '</b>',
      '{mode}': '<b>' + modeLabel + '</b>',
      '{status}': '<b>' + (robot.status === 'online' ? 'Online' : robot.status === 'offline' ? 'Offline' : robot.status) + '</b>',
      '{lastResult}': lastResultEmoji + ' <b>' + lastResultLabel + '</b>',
      '{lastResultEmoji}': lastResultEmoji,
      '{lastResultLabel}': '<b>' + lastResultLabel + '</b>',
      '{diagnosticStatus}': '<b>' + (d.status || 'IDLE') + '</b>',
      '{iaStrategy}': '<b>' + ((robot.iaState||{}).activeStrategy||'--') + '</b>',
      '{iaTarget}': entryEmoji + ' <b>' + ((robot.iaState||{}).activeTarget||'--') + '</b>',
      '{iaMultiplier}': '<b>' + ((robot.iaState||{}).activeMultiplier||'') + 'X</b>',
      '{iaConfidence}': '<b>' + ((robot.iaState||{}).activeConfidence||0) + '%</b>',
      '{analyzedResults}': '<b>' + Math.min(d.analyzedResults || 0, robot.resultsToAnalyze || 500) + '/' + (robot.resultsToAnalyze || 500) + '</b>',
      '{confidenceDiag}': '<b>' + (d.confidence || 0) + '%</b>',
      '{pattern}': '<b>' + (d.mainPattern || '--') + '</b>',
      '{entry}': entryEmoji + ' <b>' + entryLabel + '</b>',
      '{entryEmoji}': entryEmoji,
      '{entryLabel}': '<b>' + entryLabel + '</b>',
      '{score}': '<b>' + (d.totalScore || 0) + '</b>',
      '{history}': this.formatRecentHistory(robot),
      '{historyEmojis}': this.formatRecentHistory(robot),
      '{time}': '<b>' + this.getCachedTime() + '</b>'
    };
    return template.replace(/\{[^}]+\}/g, (key) => map[key] !== undefined ? map[key] : key);
  },

  buildEntryHistoryLines(robot) {
    return [
      '━━━━━━━━━━━━━━━━━━━━',
      this.formatHistoryTitle(robot),
      this.formatRecentHistory(robot)
    ];
  },

  getSignalTarget(robot, signal) {
    const cfgColor = String(robot.target?.color || '').toUpperCase();
    let color;
    if (cfgColor && cfgColor !== 'ANY' && cfgColor !== 'ALL' && !cfgColor.includes('+')) {
      color = cfgColor;
    } else {
      color = String(signal.target || '').toUpperCase();
    }
    const multiplier = robot.target?.multiplier ? robot.target.multiplier + 'X' : '';
    const emoji = this.colorEmoji(color);
    const colorLabel = this.colorLabel(color);
    return {
      color,
      emoji,
      label: colorLabel + ' ' + emoji + multiplier,
      multLabel: multiplier
    };
  },

  colorLabel(color) {
    const c = String(color || '').toUpperCase();
    if (c === 'RED') return 'VERMELHO';
    if (c === 'BLACK' || c === 'GREY' || c === 'GRAY') return 'PRETO';
    if (c === 'GREEN') return 'VERDE';
    if (c === 'BLUE') return 'AZUL';
    if (c === 'WHITE') return 'BRANCO';
    return c || '--';
  },

  getMultiplierLabel(color, game) {
    const c = String(color || '').toUpperCase();
    if (game === 'wheel') {
      if (c === 'GREY' || c === 'BLACK' || c === 'GRAY') return ' 2X';
      if (c === 'RED') return ' 3X';
      if (c === 'BLUE') return ' 5X';
      if (c === 'GREEN') return ' 50X';
    }
    if (game === 'double') {
      if (c === 'RED' || c === 'BLACK') return ' 2X';
      if (c === 'GREEN') return ' 14X';
    }
    return '';
  },

  formatStrategy(strategy) {
    const map = {
      alternancia: 'Alternância',
      repeticao: 'Repetição',
      frequencia: 'Frequência',
      tendencia: 'Tendência',
      espelhamento: 'Espelhamento',
      diagonal: 'Diagonal',
      padroesCores: 'Padrões Cores',
      cicloVerde: 'Ciclo Verde',
      convergencia: 'Convergência',
      cicloZero: 'Ciclo Zero',
      padraoNumerico: 'Padrão Numérico',
      sequenciaNegra: 'Sequência Negra',
      momentumPreto: 'Momentum Preto',
      sequenciaVermelha: 'Sequência Vermelha',
      momentumVermelho: 'Momentum Vermelho',
      cicloPreto: 'Ciclo Preto',
      reacaoPreto: 'Reação Preto',
      cicloVermelho: 'Ciclo Vermelho',
      convergenciaVermelha: 'Convergência Vermelha',
      cicloAzul: 'Ciclo Azul',
      sequenciaAzul: 'Sequência Azul',
      divergenciaTemporal: 'Divergência Temporal',
      markovTransicao: 'Markov Transição',
      bayesiano: 'Bayesiano',
      regressaoReversao: 'Regressão Reversão',
      suavizacaoExponencial: 'Suavização Exp.',
      detectorAnomalias: 'Detector Anomalias',
      convergenciaMultiEscala: 'Convergência Multi',
      predicaoCondicional: 'Predição Condicional',
      entropiaAdaptativa: 'Entropia Adaptativa',
      volatilidadeAdaptativa: 'Volatilidade Adaptativa'
    };
    return map[strategy] || strategy || '--';
  },

  formatProtection(robot) {
    const galeByColor = robot.galeByColor || {};
    const parts = [];
    if (robot.game === 'double') {
      const max = robot.gale?.max || 0;
      if (max > 0) parts.push('🛡 PROTEÇÃO ATÉ G' + max);
      else parts.push('🎯 ENTRADA SECA');
    } else {
      const grey = galeByColor.grey || 0;
      const red = galeByColor.red || 0;
      const blue = galeByColor.blue || 0;
      const green = galeByColor.green || 0;
      const protections = [];
      if (grey > 0) protections.push('⚫ Preto G' + grey);
      if (red > 0) protections.push('🔴 Vermelho G' + red);
      if (blue > 0) protections.push('🔵 Azul G' + blue);
      if (green > 0) protections.push('🟢 Verde G' + green);
      if (protections.length) parts.push('🛡 PROTEÇÃO: ' + protections.join(' / '));
      else parts.push('🎯 ENTRADA SECA');
    }
    return parts.join(' | ');
  },

  formatGaleInstruction(robot) {
    const galeByColor = robot.galeByColor || {};
    if (robot.game === 'double') {
      const max = robot.gale?.max || 0;
      if (max > 0) return 'Gale até G' + max;
      return 'Entrada seca';
    }
    const grey = galeByColor.grey || 0;
    const red = galeByColor.red || 0;
    const blue = galeByColor.blue || 0;
    const green = galeByColor.green || 0;
    const protections = [];
      if (grey > 0) protections.push('⚫ Preto G' + grey);
      if (red > 0) protections.push('🔴 Vermelho G' + red);
      if (blue > 0) protections.push('🔵 Azul G' + blue);
      if (green > 0) protections.push('🟢 Verde G' + green);
      if (protections.length) return protections.join(' | ');
    return 'Entrada seca';
  },

  getSequenceStats(robot) {
    const stats = robot.stats || {};
    const lastSignal = robot.lastSignal || {};
    const currentSignal = robot.currentSignal;
    const sequenceWins = stats.sequenceWins || 0;
    const sequenceLosses = stats.sequenceLosses || 0;
    return '✅ WIN: ' + sequenceWins + ' | ❌ LOSS: ' + sequenceLosses;
  },

  formatHistoryTitle(robot) {
    return robot.game === 'wheel' ? '🎡 HISTÓRICO RECENTE' : '🎲 HISTÓRICO RECENTE';
  },

  formatRecentHistory(robot) {
    const history = this.getTelegramHistory(robot, 10);
    if (!history.length) return 'Aguardando resultados...';
    return history.map(item => this.colorEmoji(item.color)).join(' ');
  },

  getTelegramHistory(robot, limit) {
    const stored = this.loadTelegramHistoryFromStorage(robot);
    let history = stored.length ? stored : this.normalizeTelegramHistory(robot, robot.history || []);
    if (robot.game === 'wheel') history = this.removeImmediateWheelDuplicates(history);
    return history.slice(0, limit);
  },

  loadTelegramHistoryFromStorage(robot) {
    const key = robot.game === 'wheel' ? 'historico-wheel-v1' : 'historico-double-v1';
    try {
      const raw = JSON.parse(localStorage.getItem(key) || '[]');
      return this.normalizeTelegramHistory(robot, Array.isArray(raw) ? raw : []);
    } catch {
      return [];
    }
  },

  normalizeTelegramHistory(robot, history) {
    return history.map(r => {
      const number = robot.game === 'double' ? (r.number ?? r.cellIndex) : (r.cellIndex ?? r.number);
      let rawColor = robot.game === 'double' ? r.color : (r.cellColor ?? r.color);
      if (robot.game === 'double' && !rawColor) {
        if (number === 0) rawColor = 'green';
        else if (number >= 1 && number <= 7) rawColor = 'red';
        else if (number >= 8 && number <= 14) rawColor = 'black';
      }
      const roundId = r.roundId ?? r.roundID ?? r.roundUuid ?? r.roundUUID ?? r.gameId ?? r.gameID ?? r.id ?? r.uuid;
      const color = String(rawColor || '').toUpperCase();
      const item = {
        color: color === 'GRAY' ? 'GREY' : color,
        number,
        multiplier: r.multiplier || null,
        time: r.time || r.timestamp || 0
      };
      if (roundId !== undefined && roundId !== null) item.roundId = String(roundId);
      if (r.storageId) item.storageId = String(r.storageId);
      return item;
    }).filter(item => item.color);
  },

  removeImmediateWheelDuplicates(history) {
    const cleaned = [];
    history.forEach(item => {
      if (!this.isImmediateWheelDuplicate(cleaned[cleaned.length - 1], item)) {
        cleaned.push(item);
      }
    });
    return cleaned;
  },

  isImmediateWheelDuplicate(previous, item) {
    if (!previous || !item) return false;
    const previousRound = previous.roundId ? 'round:' + previous.roundId : '';
    const itemRound = item.roundId ? 'round:' + item.roundId : '';
    if (previousRound && itemRound) return previousRound === itemRound;
    const previousSig = [previous.color || '', previous.number ?? '', previous.multiplier || ''].join(':');
    const itemSig = [item.color || '', item.number ?? '', item.multiplier || ''].join(':');
    if (previousSig !== itemSig) return false;
    const previousTime = Number(previous.time || 0);
    const itemTime = Number(item.time || 0);
    if (!previousTime || !itemTime) return true;
    return Math.abs(itemTime - previousTime) <= 15000;
  },

  colorEmoji(color) {
    const c = String(color || '').toUpperCase();
    if (c === 'RED') return '🔴';
    if (c === 'BLACK' || c === 'GREY' || c === 'GRAY') return '⚫️';
    if (c === 'GREEN') return '🟢';
    if (c === 'BLUE') return '🔵';
    if (c === 'WHITE') return '⚪️';
    return '⚪️';
  },

  getMarketAnalysis(robot) {
    const history = (robot.history || []).slice(0, 20);
    if (!history.length) {
      return { trendEmoji: '⚪️', trendPercent: 0, volatilityEmoji: '⚪️', volatility: 'BAIXA' };
    }

    const counts = {};
    history.forEach(item => {
      const color = String(item.color || '').toUpperCase();
      counts[color] = (counts[color] || 0) + 1;
    });
    const trend = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || ['', 0];
    const trendPercent = Math.round((trend[1] / history.length) * 100);

    let changes = 0;
    for (let i = 0; i < history.length - 1; i++) {
      if (history[i].color !== history[i + 1].color) changes++;
    }
    const volatilityScore = history.length > 1 ? Math.round((changes / (history.length - 1)) * 100) : 0;
    const volatility = volatilityScore >= 65 ? 'ALTA' : volatilityScore >= 40 ? 'MÉDIA' : 'BAIXA';

    return {
      trendEmoji: this.colorEmoji(trend[0]),
      trendPercent,
      volatilityEmoji: this.colorEmoji(history[0].color),
      volatility
    };
  },

  formatAiStatus(robot) {
    const diagnostic = robot.diagnostic || {};
    if (diagnostic.decision?.approved) {
      return '✅ Padrão confirmado: ' + (diagnostic.decision.target || diagnostic.suggestedEntry || '--');
    }
    if (diagnostic.status === 'LOADING') return '⏳ ' + (diagnostic.mainPattern || 'Coletando dados...');
    if (diagnostic.status === 'REJECTED') return '🔎 Filtrando: ' + (diagnostic.blockReason || 'aguardando padrão');
    if (diagnostic.mainPattern) return '🔍 ' + diagnostic.mainPattern;
    return '🔍 Analisando padrões...';
  },

  formatRateBar(rate) {
    const filled = Math.round((rate / 100) * 8);
    const empty = 8 - filled;
    return '🟩 '.repeat(filled) + '⬛️ '.repeat(empty);
  },

  async sendFreshEntryMessage(robot, signal) {
    if (!this.hasAnyToken()) return false;
    const destinations = this.getDestinations(robot);
    if (destinations.length === 0) return false;
    const destResults = [];
    for (const dest of destinations) {
      const key = 'entry:' + this.entryMessageKey(robot, dest);
      const task = () => this.withLock(key, async () => {
        if (signal?.id && signal.id !== 'cleanup' && !this.shouldProcessEntryEvent(robot, signal, dest)) return true;
        return this._sendFreshEntryMessage(robot, signal, dest);
      });
      destResults.push(await this.enqueue(key, task));
    }
    return destResults.some(r => r);
  },

  async _sendFreshEntryMessage(robot, signal, dest) {
    const chatId = dest?.channelId || '';
    const token = this.getTokenForChat(chatId);
    const threadId = dest?.threadId ?? null;
    if (!token || !chatId) return false;
    const key = this.entryMessageKey(robot, dest);
    const text = signal && signal.id !== 'cleanup' ? this.prepareTelegramText(this.buildEntryMessage(robot, signal)) : '';
    const messages = this.getEntryMessages();
    if (this.migrateLegacyMessage(messages, robot, dest, key)) this.saveEntryMessages(messages);
    const current = messages[key];
    if (current?.messageId) {
      await this.api(token, 'deleteMessage', { chat_id: chatId, message_id: current.messageId }).catch(() => {});
    }
    delete messages[key];
    this.saveEntryMessages(messages);
    if (!text) return false;
    const sendPayload = { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true };
    if (threadId) sendPayload.message_thread_id = threadId;
    const sent = await this.api(token, 'sendMessage', sendPayload);
    if (sent.ok && sent.result?.message_id) {
      const latest = this.getEntryMessages();
      latest[key] = { messageId: sent.result.message_id, text, robotId: robot.id, chatId, signalId: signal.id, status: signal.status || 'approved', gale: signal.gale || 0, result: signal.result || null, eventKey: signal.entryEventKey || '', historyResultKey: signal.historyResultKey || signal.lastCheckedResultKey || signal.waitingAfterResultKey || signal.sourceResultKey || '', createdAt: Date.now(), updatedAt: Date.now() };
      this.saveEntryMessages(latest);
      return true;
    }
    return false;
  },

  formatRobotStatus(robot) {
    if (robot.currentSignal) {
      if (robot.currentSignal.status === 'gale_pending') {
        return 'Aguardando G' + robot.galeCount + '\npara ' + this.colorEmoji(robot.currentSignal.target) + ' ' + this.colorLabel(robot.currentSignal.target);
      }
      return 'Sinal confirmado\naguardando resultado...';
    }
    if (robot.status !== 'online') return 'Robô ' + (robot.status === 'offline' ? 'Offline' : robot.status);
    return 'Aguardando próximo\npadrão confirmado...';
  },

  async updateDynamicMessage(robot, dest) {
    if (!dest) {
      const destinations = this.getDestinations(robot);
      for (const d of destinations) {
        await this.updateDynamicMessage(robot, d);
      }
      return;
    }
    const chatId = dest?.channelId || '';
    const token = this.getTokenForChat(chatId);
    const threadId = dest?.threadId ?? null;
    if (!token || !chatId) return;
    const key = this.messageKey(robot, dest);
    const text = this.prepareTelegramText(this.buildDynamicMessage(robot));
    const messages = this.getLiveMessages();
    if (this.migrateLegacyMessage(messages, robot, dest, key)) this.saveLiveMessages(messages);
    const current = messages[key];

    if (current?.sending && Date.now() - (current.updatedAt || 0) < this.liveSendingTimeoutMs) return;

    if (robot.currentSignal) {
      if (current?.messageId && current?.text === text) return;
      if (current?.messageId) {
        const editPayload = { chat_id: chatId, message_id: current.messageId, text, parse_mode: 'HTML', disable_web_page_preview: true };
        if (threadId) editPayload.message_thread_id = threadId;
        const edited = await this.api(token, 'editMessageText', editPayload);
        if (edited.ok || this.isNotModified(edited)) {
          const latest = this.getLiveMessages();
          latest[key] = { messageId: current.messageId, text, updatedAt: Date.now() };
          this.saveLiveMessages(latest);
          return;
        }
        if (this.isEditMessageNotFound(edited) || this.isMessageCantBeEdited(edited)) {
          const latest = this.getLiveMessages();
          delete latest[key];
          this.saveLiveMessages(latest);
        }
      }
      const pending = this.getLiveMessages();
      pending[key] = { sending: true, text, robotId: robot.id, chatId, owner: this.clientId, updatedAt: Date.now() };
      this.saveLiveMessages(pending);
      const sendPayload = { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true };
      if (threadId) sendPayload.message_thread_id = threadId;
      const sent = await this.api(token, 'sendMessage', sendPayload);
      if (sent.ok && sent.result?.message_id) {
        const latest = this.getLiveMessages();
        latest[key] = { messageId: sent.result.message_id, text, updatedAt: Date.now() };
        this.saveLiveMessages(latest);
      } else {
        const latest = this.getLiveMessages();
        if (latest[key]?.sending && latest[key]?.owner === this.clientId) delete latest[key];
        this.saveLiveMessages(latest);
      }
    } else if (current?.messageId) {
      const deleted = await this.api(token, 'deleteMessage', { chat_id: chatId, message_id: current.messageId }).catch(() => ({}));
      if (deleted.ok || this.isAlreadyDeleted(deleted)) {
        const latest = this.getLiveMessages();
        delete latest[key];
        this.saveLiveMessages(latest);
      }
    }
  },

  buildDynamicMessage(robot) {
    const signal = robot.currentSignal;
    if (!signal) {
      return '━━ 🚨 <b>AGUARDANDO SINAL</b> 🚨\n🤖 ' + robot.name + '\n🕕 ' + this.getCachedTime();
    }
    const target = this.getSignalTarget(robot, signal);
    const targetEmoji = target.emoji;
    const targetLabel = this.colorLabel(target.color);
    const wins = robot.stats?.wins || 0;
    const losses = robot.stats?.losses || 0;
    const rate = (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;
    const greenProt = robot.greenProtection && robot.game === 'double';
    const greenProtLabel = greenProt ? ' + 🟢' : '';
    let galeMax;
    if (robot.game === 'wheel') {
      const galeByColor = robot.galeByColor || {};
      const colorKey = { RED: 'red', BLACK: 'grey', GREY: 'grey', BLUE: 'blue', GREEN: 'green' };
      const key = colorKey[target.color] || 'grey';
      galeMax = galeByColor[key] ?? 1;
    } else {
      galeMax = robot.gale?.max || 0;
    }
    const galeLine = galeMax > 0 ? '⚡️ <b>GALE ATÉ: G' + galeMax + '</b>' : '⚡️ <b>ENTRADA SECA</b>';
    const targetLine = '🎯 <b>ENTRAR NA COR=</b> ' + targetEmoji + greenProtLabel + '<b>' + targetLabel + '</b>';
    if (!['win', 'loss'].includes(String(signal.status || 'approved').toLowerCase())) {
      return this.buildEntryMessage(robot, signal);
    }
    if (signal.status === 'win') {
      return [
        '━━ ✅ <b>WIN!</b> ✅ ━━',
        '🎯 Resultado: ' + targetEmoji + ' ' + targetLabel,
        '📊 ' + wins + 'W / ' + losses + 'L (' + rate + '%)',
        '🕕 ' + this.getCachedTime()
      ].join('\n');
    }
    if (signal.status === 'loss') {
      return [
        '━━ ❌ <b>LOSS!</b> ❌ ━━',
        '🎯 Resultado: ' + targetEmoji + ' ' + targetLabel,
        '📊 ' + wins + 'W / ' + losses + 'L (' + rate + '%)',
        '🕕 ' + this.getCachedTime()
      ].join('\n');
    }
    if (signal.status === 'gale_pending') {
      return [
        '━━ ⚡️ <b>G' + (signal.gale || 1) + ' - TENTANDO NOVAMENTE</b> ⚡️',
        '🎯 <b>ENTRAR</b>',
        targetEmoji,
        '❌ <b>LOSS, VEIO:</b> ' + targetLabel + ' ' + targetEmoji,
        '📊 ' + wins + 'W / ' + losses + 'L (' + rate + '%)',
        '🕕 ' + this.getCachedTime()
      ].join('\n');
    }
    return [
      '━━ 🤖 <b>SINAL ENCONTRADO</b> 🤖 ━━',
      '🎯 <b>ENTRAR NA COR</b>',
      targetEmoji,
      '📈 <b>Aproveitamento:</b> <b>' + rate + '%</b>',
      '🕕 ' + this.getCachedTime()
    ].join('\n');
  },

  async sendMaintenanceMessage(robot, type, dest) {
    if (!dest) {
      const destinations = this.getDestinations(robot);
      for (const d of destinations) {
        await this.sendMaintenanceMessage(robot, type, d);
      }
      return;
    }
    const chatId = dest?.channelId || '';
    const token = this.getTokenForChat(chatId);
    const threadId = dest?.threadId ?? null;
    if (!token || !chatId) return;
    await this.clearAllMessages(robot);
    const name = robot?.name || 'Robô';
    const strategy = this.formatStrategy(robot?.strategy || '--');
    const now = new Date().toLocaleString('pt-BR');
    const messages = {
      maintenance: [
        '🔧 <b>MANUTENÇÃO DO ROBÔ</b> 🔧',
        '🤖 Robô: ' + name,
        '📅 Início: ' + now,
        '🔒 Status: Em manutenção',
        '⚙️ Atualização em andamento...'
      ].join('\n'),
      update: [
        '🔄 <b>ATUALIZAÇÃO PROGRAMADA</b> 🔄',
        '🤖 Robô: ' + name,
        '⏰ Início: ' + now,
        '✅ Retorno automático em breve',
        '📊 Estratégia: ' + strategy
      ].join('\n'),
      pause: [
        '⏸️ <b>PAUSA ESTRATÉGICA</b> ⏸️',
        '🤖 Robô: ' + name,
        '🎯 Ajustando configurações...',
        '📈 Em breve com análise renovada',
        '💡 Motivo: Atualização de padrões'
      ].join('\n'),
      recalibration: [
        '🛠️ <b>RECALIBRAÇÃO DO SISTEMA</b> 🛠️',
        '🤖 Robô: ' + name,
        '📡 Recalculando padrões...',
        '⚙️ Otimizando estratégias',
        '⏳ Volta automática após ajustes'
      ].join('\n'),
      full: [
        '🚀 <b>MANUTENÇÃO & ATUALIZAÇÃO</b> 🚀',
        '🤖 Robô: ' + name,
        '🔄 Versão: v1.0',
        '📅 ' + now,
        '⚙️ Atualizando base de dados',
        '🎯 Estratégia: ' + strategy,
        '✅ Em breve online novamente'
      ].join('\n')
    };
    const text = this.prepareTelegramText(messages[type] || messages.maintenance);
    const sendPayload = { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true };
    if (threadId) sendPayload.message_thread_id = threadId;
    const sent = await this.api(token, 'sendMessage', sendPayload);
    if (sent.ok && sent.result?.message_id) {
      const key = this.maintenanceKey(robot, dest);
      const latest = this.getMaintenanceMessages();
      this.migrateLegacyMessage(latest, robot, dest, key);
      latest[key] = { messageId: sent.result.message_id, chatId, robotId: robot.id, type, createdAt: Date.now() };
      this.saveMaintenanceMessages(latest);
    }
  },

  async clearAllMessages(robot) {
    if (!this.hasAnyToken() || !robot) return;
    const liveMessages = this.getLiveMessages();
    const entryMessages = this.getEntryMessages();
    const maintenanceMessages = this.getMaintenanceMessages();
    const robotId = robot.id || '';
    const prefix = robotId + ':';
    const liveToDelete = [];
    for (const [key, msg] of Object.entries(liveMessages)) {
      if (key.startsWith(prefix) && msg?.messageId) {
        const chatId = key.split(':')[1] || robot.telegram?.channelId || '';
        if (chatId) {
          liveToDelete.push({ chatId, messageId: msg.messageId });
        }
        delete liveMessages[key];
      }
    }
    this.saveLiveMessages(liveMessages);
    for (const { chatId, messageId } of liveToDelete) {
      const token = this.getTokenForChat(chatId);
      await this.api(token, 'deleteMessage', { chat_id: chatId, message_id: messageId }).catch(() => {});
    }
    const entryToDelete = [];
    for (const [key, msg] of Object.entries(entryMessages)) {
      if (key.startsWith(prefix) && msg?.messageId) {
        const chatId = msg.chatId || key.split(':')[1] || robot.telegram?.channelId || '';
        if (chatId) {
          entryToDelete.push({ chatId, messageId: msg.messageId });
        }
        delete entryMessages[key];
      }
    }
    this.saveEntryMessages(entryMessages);
    for (const { chatId, messageId } of entryToDelete) {
      const token = this.getTokenForChat(chatId);
      await this.api(token, 'deleteMessage', { chat_id: chatId, message_id: messageId }).catch(() => {});
    }
    const maintToDelete = [];
    for (const [key, msg] of Object.entries(maintenanceMessages)) {
      if (key.startsWith(prefix) && msg?.messageId) {
        const chatId = key.split(':')[1] || robot.telegram?.channelId || '';
        if (chatId) {
          maintToDelete.push({ chatId, messageId: msg.messageId });
        }
        delete maintenanceMessages[key];
      }
    }
    this.saveMaintenanceMessages(maintenanceMessages);
    for (const { chatId, messageId } of maintToDelete) {
      const token = this.getTokenForChat(chatId);
      await this.api(token, 'deleteMessage', { chat_id: chatId, message_id: messageId }).catch(() => {});
    }
    try {
      const events = JSON.parse(localStorage.getItem(this.entryEventStoreKey) || '{}');
      let changed = false;
      for (const key of Object.keys(events)) {
        if (key.startsWith(prefix)) { delete events[key]; changed = true; }
      }
      if (changed) localStorage.setItem(this.entryEventStoreKey, JSON.stringify(events));
    } catch {}
  },

  buildScheduleMessage(robot, schedule, action) {
    const gameLabel = robot.game === 'wheel' ? 'Wheel' : 'Double';
    const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
    const daysLabel = (schedule.days || []).sort().map(d => dayNames[d]).join(', ');
    const repeatLabel = schedule.repeatInterval > 0 ? 'A cada ' + schedule.repeatInterval + ' horas' : 'Horario fixo';
    const maxEntries = schedule.maxEntries > 0 ? schedule.maxEntries : 'Ilimitado';
    const actionEmoji = action === 'activate' ? '✅' : '⛔';
    const actionText = action === 'activate' ? 'ATIVADO' : 'DESATIVADO';
    const now = new Date();
    const timeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

    return [
      '━━ 🚨 <b>AGENDAMENTO ' + actionText + '</b> 🚨 ━━',
      '🤖 <b>ROBO:</b> ' + robot.name,
      '🔰 <b>Jogo:</b> ' + gameLabel,
      '',
      '⏰ <b>HORARIO CONFIGURADO</b>',
      '🔄 <b>Repetir:</b> ' + repeatLabel,
      '',
      '📅 <b>Dias:</b> ' + daysLabel,
      '📊 <b>Max Entradas:</b> ' + maxEntries,
      '',
      '━━━━━━━━━━━━━━━━━━━━',
      actionEmoji + ' <b>STATUS:</b> ' + actionText,
      '🕕 <b>Alterado em:</b> ' + timeStr,
      '━━━━━━━━━━━━━━━━━━━━'
    ].join('\n');
  },

  async sendScheduleNotification(robot, schedule, action) {
    if (!this.hasAnyToken()) return;
    let destinations = [];
    if (schedule.destinations && schedule.destinations.length > 0) {
      destinations = schedule.destinations.filter(d => d.channelId);
    } else {
      destinations = this.getDestinations(robot);
    }
    if (!destinations.length) return;
    const text = this.buildScheduleMessage(robot, schedule, action);
    for (const dest of destinations) {
      const chatId = dest.channelId;
      if (!chatId) continue;
      const token = this.getTokenForChat(chatId);
      const payload = {
        chat_id: chatId,
        text: this.prepareTelegramText(text),
        parse_mode: 'HTML',
        disable_web_page_preview: true
      };
      if (dest.threadId) payload.message_thread_id = dest.threadId;
      await this.api(token, 'sendMessage', payload).catch(() => {});
    }
  },

  checkPendingSignalLimitNotifications() {
    try {
      const raw = localStorage.getItem('signalLimitNotify');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || !data.time) return;
      const age = Date.now() - data.time;
      if (age > 60000) { localStorage.removeItem('signalLimitNotify'); return; }
      if (data.type === 'start') this.handleSignalLimitStart(data);
      else if (data.type === 'reached') this.handleSignalLimitReached(data);
      else if (data.type === 'update') this.handleSignalLimitUpdate(data);
      else if (data.type === 'warning') this.handleSignalLimitWarning(data);
      localStorage.removeItem('signalLimitNotify');
    } catch { localStorage.removeItem('signalLimitNotify'); }
  },

  async handleSignalLimitStart(d) {
    if (!this.hasAnyToken()) return;
    const robot = RobotEngine.getRobot(d?.id);
    if (!robot || !this.isTelegramEnabled(robot)) return;
    const sl = robot.signalLimit;
    if (!sl?.enabled) return;
    if (!this.shouldProcessSignalLimitNotification(d, 'start', robot.id)) {
      this.clearSignalLimitNotification(d, 'start', robot.id);
      return;
    }
    const dedupKey = 'slStart:' + (d?.id || robot.id);
    if (this._signalLimitSent.has(dedupKey)) return;
    this._signalLimitSent.add(dedupKey);
    setTimeout(() => this._signalLimitSent.delete(dedupKey), 5000);
    const intervalMs = (sl.intervalHours || 5) * 60 * 60 * 1000;
    const now = Date.now();
    const timestamps = (d?.timestamps || robot._signalTimestamps || []).filter(t => t > now - intervalMs);
    const remaining = Math.max(0, (sl.maxSignals || 10) - timestamps.length);
    const name = robot.name || 'Robô';
    const signalHistory = robot.signalHistory || [];
    const windowSignals = signalHistory.filter(h => h.time && h.time > now - intervalMs);
    const emojiMap = { RED: '🔴', BLACK: '⚫', GREY: '⚫', GREEN: '🟢', BLUE: '🔵', VERMELHO: '🔴', PRETO: '⚫', VERDE: '🟢', AZUL: '🔵' };
    const targetColor = (robot.target?.color || 'any').toUpperCase();
    const targetLabel = targetColor === 'ANY' ? 'QUALQUER' : (emojiMap[targetColor] || '') + ' ' + targetColor;
    const resultsLine = windowSignals.length > 0
      ? windowSignals.map(h => h.type === 'win' ? '✅' : '❌').join('')
      : 'Sem entradas ainda';
    const winsCount = windowSignals.filter(h => h.type === 'win').length;
    const lossesCount = windowSignals.filter(h => h.type === 'loss').length;
    const statusLine = remaining <= 2
      ? '⚠️ <i>Poucas entradas restantes!</i>'
      : '✅ Operando normalmente';
    const text = [
      '🚦 <b>LIMITE DE SINAIS ATIVO</b> 🚦',
      '🤖 Robô: ' + name,
      '📊 Entradas restantes: <b>' + remaining + '/' + (sl.maxSignals || 10) + '</b>',
      '-----------------------',
      '🔰 META == ENTRADAS 🔰',
      resultsLine,
      '-----------------------',
      '✅ ' + winsCount + 'W | ❌ ' + lossesCount + 'L',
      '-----------------------',
      '⏱️ Janela: ' + (sl.intervalHours || 5) + 'h',
      statusLine
    ].join('\n');
    const destinations = this.getDestinations(robot);
    for (const dest of destinations) {
      const chatId = dest.channelId;
      if (!chatId) continue;
      const token = this.getTokenForChat(chatId);
      const payload = {
        chat_id: chatId,
        text: this.prepareTelegramText(text),
        parse_mode: 'HTML',
        disable_web_page_preview: true
      };
      if (dest.threadId) payload.message_thread_id = dest.threadId;
      await this.api(token, 'sendMessage', payload).catch(() => {});
    }
    this.clearSignalLimitNotification(d, 'start', robot.id);
  },

  async handleSignalLimitReached(d) {
    if (!this.hasAnyToken()) return;
    const robot = RobotEngine.getRobot(d?.robotId);
    if (!robot || !this.isTelegramEnabled(robot)) return;
    const sl = robot.signalLimit;
    if (!sl?.enabled) return;
    if (!this.shouldProcessSignalLimitNotification(d, 'reached', robot.id)) {
      this.clearSignalLimitNotification(d, 'reached', robot.id);
      return;
    }
    const dedupKey = 'slReached:' + (d?.robotId || robot.id);
    if (this._signalLimitSent.has(dedupKey)) return;
    this._signalLimitSent.add(dedupKey);
    setTimeout(() => this._signalLimitSent.delete(dedupKey), 5000);
    const name = robot.name || 'Robô';
    const intervalMs = (sl.intervalHours || 5) * 60 * 60 * 1000;
    const now = Date.now();
    const timestamps = (robot._signalTimestamps || []).filter(t => t > now - intervalMs);
    const firstTimestamp = timestamps.length > 0 ? Math.min(...timestamps) : now;
    const nextWindowTime = new Date(firstTimestamp + intervalMs);
    const nextWindowStr = nextWindowTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const signalHistory = robot.signalHistory || [];
    const windowSignals = signalHistory.filter(h => h.time && h.time > now - intervalMs);
    const windowWins = windowSignals.filter(h => h.type === 'win').length;
    const windowLosses = windowSignals.filter(h => h.type === 'loss').length;
    const slTotal = robot.signalLimitTotal || { wins: 0, losses: 0 };
    const totalWins = slTotal.wins;
    const totalLosses = slTotal.losses;
    const text = [
      '🚫 <b>LIMITE DE SINAIS ATINGIDO</b>',
      '🤖 Robô: ' + name,
      '📊 ' + (d?.count || 0) + '/' + (d?.max || 10) + ' sinais utilizados',
      '-----------------------',
      '🧾 PLACAR= ✅ ' + windowWins + 'W | ❌ ' + windowLosses + 'L',
      '-----------------------',
      '🌐 TOTAL GERAL= ✅ ' + totalWins + 'W | ❌ ' + totalLosses + 'L',
      '-----------------------',
      '⏱️ Próxima janela às: ' + nextWindowStr,
      '🔒 Sinais bloqueados até liberação'
    ].join('\n');
    const destinations = this.getDestinations(robot);
    for (const dest of destinations) {
      const chatId = dest.channelId;
      if (!chatId) continue;
      const token = this.getTokenForChat(chatId);
      const payload = {
        chat_id: chatId,
        text: this.prepareTelegramText(text),
        parse_mode: 'HTML',
        disable_web_page_preview: true
      };
      if (dest.threadId) payload.message_thread_id = dest.threadId;
      await this.api(token, 'sendMessage', payload).catch(() => {});
    }
    this.clearSignalLimitNotification(d, 'reached', robot.id);
  },

  async handleSignalLimitUpdate(d) {
    if (!this.hasAnyToken()) return;
    const robot = RobotEngine.getRobot(d?.robotId);
    if (!robot || !this.isTelegramEnabled(robot)) return;
    const sl = robot.signalLimit;
    if (!sl?.enabled) return;
    if (!this.shouldProcessSignalLimitNotification(d, 'update', robot.id)) {
      this.clearSignalLimitNotification(d, 'update', robot.id);
      return;
    }
    const intervalMs = (sl.intervalHours || 5) * 60 * 60 * 1000;
    const now = Date.now();
    const timestamps = (robot._signalTimestamps || []).filter(t => t > now - intervalMs);
    const remaining = Math.max(0, (sl.maxSignals || 10) - timestamps.length);
    const name = robot.name || 'Robô';
    const signalHistory = robot.signalHistory || [];
    const windowSignals = signalHistory.filter(h => h.time && h.time > now - intervalMs);
    const resultsLine = windowSignals.length > 0
      ? windowSignals.map(h => h.type === 'win' ? '✅' : '❌').join('')
      : 'Sem entradas ainda';
    const winsCount = windowSignals.filter(h => h.type === 'win').length;
    const lossesCount = windowSignals.filter(h => h.type === 'loss').length;
    const statusLine = remaining <= 2
      ? '⚠️ <i>Poucas entradas restantes!</i>'
      : '✅ Operando normalmente';
    const text = [
      '🚦 <b>LIMITE DE SINAIS ATIVO</b> 🚦',
      '🤖 Robô: ' + name,
      '📊 Entradas restantes: <b>' + remaining + '/' + (sl.maxSignals || 10) + '</b>',
      '-----------------------',
      '🔰 META == ENTRADAS 🔰',
      resultsLine,
      '-----------------------',
      '✅ ' + winsCount + 'W | ❌ ' + lossesCount + 'L',
      '-----------------------',
      '⏱️ Janela: ' + (sl.intervalHours || 5) + 'h',
      statusLine
    ].join('\n');
    const destinations = this.getDestinations(robot);
    for (const dest of destinations) {
      const chatId = dest.channelId;
      if (!chatId) continue;
      const token = this.getTokenForChat(chatId);
      const payload = {
        chat_id: chatId,
        text: this.prepareTelegramText(text),
        parse_mode: 'HTML',
        disable_web_page_preview: true
      };
      if (dest.threadId) payload.message_thread_id = dest.threadId;
      await this.api(token, 'sendMessage', payload).catch(() => {});
    }
    this.clearSignalLimitNotification(d, 'update', robot.id);
  },

  async handleSignalLimitWarning(d) {
    if (!this.hasAnyToken()) return;
    const robot = RobotEngine.getRobot(d?.robotId);
    if (!robot || !this.isTelegramEnabled(robot)) return;
    const sl = robot.signalLimit;
    if (!sl?.enabled) return;
    if (!this.shouldProcessSignalLimitNotification(d, 'warning', robot.id)) {
      this.clearSignalLimitNotification(d, 'warning', robot.id);
      return;
    }
    const name = robot.name || 'Robô';
    const nextTime = d?.nextWindowAt ? new Date(d.nextWindowAt) : new Date(Date.now() + 5 * 60 * 1000);
    const nextStr = nextTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const text = [
      '⚡ <b>ALERTA - NOVA JANELA EM BREVE</b>',
      '🤖 Robô: ' + name,
      '-----------------------',
      '⏰ Nova janela às: <b>' + nextStr + '</b>',
      '📊 ' + (sl.maxSignals || 10) + ' novas entradas disponíveis',
      '-----------------------',
      '✅ Operando normalmente em breve'
    ].join('\n');
    const destinations = this.getDestinations(robot);
    for (const dest of destinations) {
      const chatId = dest.channelId;
      if (!chatId) continue;
      const token = this.getTokenForChat(chatId);
      const payload = {
        chat_id: chatId,
        text: this.prepareTelegramText(text),
        parse_mode: 'HTML',
        disable_web_page_preview: true
      };
      if (dest.threadId) payload.message_thread_id = dest.threadId;
      await this.api(token, 'sendMessage', payload).catch(() => {});
    }
    this.clearSignalLimitNotification(d, 'warning', robot.id);
  }
};
