const TelegramService = {
  tokenKey: 'telegram-bot-token',
  liveStoreKey: 'telegram-live-messages-v1',
  entryStoreKey: 'telegram-entry-messages-v1',
  entryEventStoreKey: 'telegram-entry-events-v1',
  errorStoreKey: 'telegram-last-error-v1',
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

  init() {
    if (this.initialized) return;
    this.initialized = true;
    EventBus.on('result:new', (result) => this.handleResultChange(result));
    EventBus.on('signal:created', (signal) => this.handleSignalCreated(signal));
    EventBus.on('signal:gale', (signal) => this.handleSignalChange(signal));
    EventBus.on('signal:win', (signal) => this.handleSignalChange(signal));
    EventBus.on('signal:loss', (signal) => this.handleSignalChange(signal));
    EventBus.on('robot:started', (d) => this.handleRobotStarted(d));
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
      await this.enqueueLiveMessage(robot);
    }
  },

  startRecalibration() {
    setInterval(() => this.recalibrateAll(), 5 * 60 * 1000);
  },

  async recalibrateAll() {
    const token = this.getToken();
    if (!token) return;
    await this.cleanupStaleMessages();
    const robots = RobotEngine.getAllRobots().filter(r => (
      r.status === 'online' && this.shouldSendLive(r)
    ));
    for (const robot of robots) {
      await this.recalibrateRobot(robot);
    }
  },

  async recalibrateRobot(robot) {
    const token = this.getToken();
    const chatId = robot.telegram?.channelId;
    if (!token || !chatId) return;
    const prefix = robot.id + ':' + chatId + ':entry';
    const allEntries = this.getEntryMessages();
    const robotEntries = Object.entries(allEntries)
      .filter(([k]) => k.startsWith(prefix) || k === prefix)
      .sort((a, b) => (b[1].updatedAt || b[1].createdAt || 0) - (a[1].updatedAt || a[1].createdAt || 0));

    if (robotEntries.length <= 1) {
      await this.enqueueLiveMessage(robot);
      return;
    }

    const keep = robotEntries[0];
    const toDelete = robotEntries.slice(1);
    for (const [key, msg] of toDelete) {
      if (msg.messageId) {
        await this.api(token, 'deleteMessage', { chat_id: chatId, message_id: msg.messageId }).catch(() => {});
      }
      delete allEntries[key];
    }
    this.saveEntryMessages(allEntries);
    await this.enqueueLiveMessage(robot);
  },

  async cleanupStaleMessages() {
    const token = this.getToken();
    if (!token) return;
    const allRobots = RobotEngine.getAllStates();
    const robotIds = new Set(allRobots.map(r => r.id));
    const liveMessages = this.getLiveMessages();
    let changed = false;
    for (const [key, msg] of Object.entries(liveMessages)) {
      const robotId = key.split(':')[0];
      if (!robotIds.has(robotId) && msg.messageId) {
        const chatId = key.split(':')[1] || '';
        if (chatId) {
          await this.api(token, 'deleteMessage', { chat_id: chatId, message_id: msg.messageId }).catch(() => {});
        }
        delete liveMessages[key];
        changed = true;
      }
    }
    if (changed) this.saveLiveMessages(liveMessages);
  },

  getToken() {
    return localStorage.getItem(this.tokenKey) || '';
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

  messageKey(robot) {
    return [robot.id, robot.telegram?.channelId || ''].join(':');
  },

  entryMessageKey(robot) {
    return [robot.id, robot.telegram?.channelId || '', 'entry'].join(':');
  },

  isTelegramEnabled(robot) {
    return !!(robot?.telegram?.enabled && robot.telegram.channelId);
  },

  shouldSendLive(robot) {
    if (!this.isTelegramEnabled(robot)) return false;
    const msgType = robot.telegram?.msgType || 'both';
    if (msgType !== 'live' && msgType !== 'both') {
      return false;
    }
    return true;
  },

  shouldSendSignal(robot) {
    if (!this.isTelegramEnabled(robot)) return false;
    const msgType = robot.telegram?.msgType || 'both';
    if (msgType !== 'signal' && msgType !== 'both' && msgType !== 'normal') return false;
    return true;
  },

  isNormalMode(robot) {
    return robot?.telegram?.msgType === 'normal';
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
      await this.enqueueLiveMessage(robot);
    }
  },

  async handleResultChange(result) {
    await this.updateLiveMessages(result);
    await this.sendPendingEntryMessages(result);
  },

  async handleRobotStarted(d) {
    const robot = RobotEngine.getRobot(d?.id);
    if (!robot || !this.shouldSendLive(robot)) return;
    if (robot.status !== 'online') return;
    await this.enqueueLiveMessage(robot);
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
      robot.currentSignal &&
      !robot.currentSignal.entrySending &&
      (!robot.currentSignal.entrySent || !this.hasEntryMessageForSignal(robot, robot.currentSignal))
    ));
    for (const robot of robots) {
      const snapshot = { ...robot.currentSignal };
      if (!this.shouldProcessEntryEvent(robot, snapshot)) {
        robot.currentSignal.entrySent = true;
        continue;
      }
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
    if (!this.shouldProcessEntryEvent(robot, snapshot)) {
      if (robot.currentSignal?.id === signal.id) robot.currentSignal.entrySent = true;
      return;
    }
    if (robot.currentSignal?.id === signal.id) robot.currentSignal.entrySending = true;
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
      const messages = this.getEntryMessages();
      const key = this.entryMessageKey(robot);
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

    if (!this.shouldProcessEntryEvent(robot, snapshot)) return;

    await this.enqueueEntryMessage(robot, snapshot);
  },

  entryEventKey(robot, signal) {
    if (!robot || !signal?.id) return '';
    const result = signal.result || {};
    const resultKey = signal.lastCheckedResultKey || signal.waitingAfterResultKey || signal.sourceResultKey ||
      [result.color || '', result.number ?? '', result.multiplier || ''].join(':');
    return [
      robot.id,
      robot.telegram?.channelId || '',
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

  hasEntryMessageForSignal(robot, signal) {
    if (!robot || !signal?.id) return false;
    const messages = this.getEntryMessages();
    const current = messages[this.entryMessageKey(robot)];
    return current?.signalId === signal.id && !!current.messageId;
  },

  shouldProcessEntryEvent(robot, signal) {
    const eventKey = this.entryEventKey(robot, signal);
    if (!eventKey) return true;
    const events = this.getEntryEvents();
    if (events[eventKey]) {
      const current = this.getEntryMessages()[this.entryMessageKey(robot)];
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

  isNormalProcessed(robotId, signalId, status, gale) {
    const key = robotId + '|' + signalId + '|' + status + '|' + (gale || 0);
    const entry = this._normalProcessed[key];
    if (!entry) return false;
    if (Date.now() - entry > 5000) {
      delete this._normalProcessed[key];
      return false;
    }
    return true;
  },

  markNormalProcessed(robotId, signalId, status, gale) {
    const key = robotId + '|' + signalId + '|' + status + '|' + (gale || 0);
    this._normalProcessed[key] = Date.now();
  },

  async enqueueEntryMessage(robot, signal) {
    const key = 'entry:' + this.entryMessageKey(robot);
    if (this.isNormalMode(robot)) {
      if (this.isNormalProcessed(robot.id, signal.id, signal.status, signal.gale)) {
        return false;
      }
      this.markNormalProcessed(robot.id, signal.id, signal.status, signal.gale);
      return this.enqueue(key, () => this.sendEntryNormal(robot, signal));
    }
    return this.enqueue(key, () => this.withLock(key, () => this.sendEntryMessage(robot, signal)));
  },

  async enqueueLiveMessage(robot) {
    const key = 'live:' + this.messageKey(robot);
    const task = this.isNormalMode(robot)
      ? () => this.sendLiveNormal(robot)
      : () => this.withLock(key, () => this.sendOrEditLiveMessage(robot));
    return this.enqueue(key, task);
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

  async sendOrEditLiveMessage(robot) {
    const token = this.getToken();
    const chatId = robot.telegram?.channelId || '';
    if (!token || !chatId) return false;

    const text = this.prepareTelegramText(this.buildLiveMessage(robot));
    const messages = this.getLiveMessages();
    const key = this.messageKey(robot);
    const current = messages[key];
    if (current?.sending && Date.now() - (current.updatedAt || 0) < this.liveSendingTimeoutMs) return false;
    if (current?.messageId && current?.text === text) return true;
    if (current?.updatedAt && Date.now() - current.updatedAt < 5000 && !current?.messageId) return false;

    if (current?.messageId) {
      const edited = await this.api(token, 'editMessageText', {
        chat_id: chatId,
        message_id: current.messageId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
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

    const sent = await this.api(token, 'sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
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

  async sendLiveNormal(robot) {
    const token = this.getToken();
    const chatId = robot.telegram?.channelId || '';
    if (!token || !chatId) return false;

    const text = this.prepareTelegramText(this.buildLiveMessage(robot));

    const sent = await this.api(token, 'sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
    if (sent.ok && sent.result?.message_id) {
      return true;
    } else {
      this.logApiError('sendMessage/live-normal', sent);
      return false;
    }
  },

  async sendEntryNormal(robot, signal) {
    const token = this.getToken();
    const chatId = robot.telegram?.channelId || '';
    if (!token || !chatId) return false;

    const text = this.prepareTelegramText(this.buildEntryMessage(robot, signal));

    const sent = await this.api(token, 'sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
    if (sent.ok && sent.result?.message_id) {
      return true;
    } else {
      this.logApiError('sendMessage/entry-normal', sent);
      return false;
    }
  },

  async sendEntryMessage(robot, signal) {
    const token = this.getToken();
    const chatId = robot.telegram?.channelId || '';
    if (!token || !chatId) return false;

    const key = this.entryMessageKey(robot);
    const text = this.prepareTelegramText(this.buildEntryMessage(robot, signal));
    const messages = this.getEntryMessages();
    const current = messages[key];
    const messageId = current?.messageId;
    if (messageId && current?.text === text) return true;
    if (current?.updatedAt && Date.now() - current.updatedAt < 3000 && !messageId) return false;

    if (messageId) {
      const edited = await this.api(token, 'editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
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
      delete messages[key];
      this.saveEntryMessages(messages);
    }

    const sent = await this.api(token, 'sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
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
    const token = this.getToken();
    if (!token || !robot) return true;
    const messages = this.getEntryMessages();
    const matching = Object.entries(messages).filter(([key, msg]) => (
      key === exactKey ||
      this.isEntryMessageKeyForRobot(key, robot) ||
      msg?.robotId === robot.id
    ));
    if (!matching.length) return true;

    for (const [key, msg] of matching) {
      const messageId = msg?.messageId || msg?.message_id;
      const chatId = msg?.chatId || this.chatIdFromEntryKey(key, robot) || robot.telegram?.channelId || '';
      if (messageId && chatId) {
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
    return value.slice(prefix.length, -suffix.length);
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
      return [
        '⚡️ <b>G' + (signal.gale || 1) + ' - TENTANDO NOVAMENTE</b>',
        '🎯 <b>ENTRAR</b>',
        target.emoji + greenProt,
        '━━━━━━━━━━━━━━━━━━━',
        '❌ <b>LOSS, VEIO:</b> ' + resultLabel + ' ' + resultEmoji + resultMult,
      ].join('\n');
    }

    const target = this.getSignalTarget(robot, signal);
    const greenProt = robot.greenProtection && robot.game === 'double';
    const greenProtLabel = greenProt ? ' + 🟢' : '';
    let galeMax;
    if (robot.game === 'wheel') {
      const galeByColor = robot.galeByColor || {};
      const colorKey = { RED: 'red', BLACK: 'grey', GREY: 'grey', BLUE: 'blue' };
      const key = colorKey[target.color] || 'grey';
      galeMax = galeByColor[key] ?? 1;
    } else {
      galeMax = robot.gale?.max || 0;
    }
    const galeLine = galeMax > 0 ? '⚡️ <b>GALE ATÉ: G' + galeMax + '</b>' : '⚡️ <b>ENTRADA SECA</b>';
    return [
      '🤖 <b>SINAL ENCONTRADO</b> 🤖',
      '🎯 <b>ENTRAR NA COR</b>',
      target.emoji + greenProtLabel,
      '━━━━━━━━━━━━━━━━━━━━',
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
      const colorKey = { RED: 'red', BLACK: 'grey', GREY: 'grey', BLUE: 'blue' };
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
      '{galeLevels}': galeLevels.join(', '),
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
      '🔰 <b>Proteção/Gales:</b> ' + galeInstruction,
      robot.greenProtection && robot.game === 'double' ? '🛡️ <b>ATENÇÃO PROTEGER= VERDE</b> 🟢' : '',
      '',
      '━━ 📊 <b>STATUS DO ROBÔ</b> ━━',
      '🟢 <b>Status:</b> ' + (robot.status === 'online' ? 'Online' : robot.status === 'offline' ? 'Offline' : robot.status) + ' 🎮 <b>Jogo:</b> ' + gameLabel,
      '♟️ <b>Estratégia:</b> ' + strategyLabel,
      '🔄 <b>Modo:</b> ' + modeLabel,
      '🎯 <b>Último Resultado:</b> ' + lastResultEmoji + ' ' + lastResultLabel,
      '',
      '━━ 🧠 <b>DIAGNÓSTICO DA IA</b> ━━',
      '📡 <b>Status:</b> ' + (d.status || 'IDLE'),
      '📊 <b>' + (d.analyzedResults || 0) + ' Resultados Analisados</b>',
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
      '{analyzedResults}': '<b>' + (d.analyzedResults || 0) + '</b>',
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
      if (grey > 0) protections.push('⚫ G' + grey);
      if (red > 0) protections.push('🔴 G' + red);
      if (blue > 0) protections.push('🔵 G' + blue);
      if (green > 0) protections.push('🟢 G' + green);
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
    if (grey > 0) protections.push('⚫G' + grey);
    if (red > 0) protections.push('🔴G' + red);
    if (blue > 0) protections.push('🔵G' + blue);
    if (green > 0) protections.push('🟢G' + green);
    if (protections.length) return protections.join('/');
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
      const rawColor = robot.game === 'double' ? r.color : (r.cellColor ?? r.color);
      const number = robot.game === 'double' ? (r.number ?? r.cellIndex) : (r.cellIndex ?? r.number);
      const roundId = r.roundId ?? r.roundID ?? r.roundUuid ?? r.roundUUID ?? r.gameId ?? r.gameID ?? r.id ?? r.uuid;
      const item = {
        color: String(rawColor || '').toUpperCase(),
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

  formatRobotStatus(robot) {
    if (robot.currentSignal) {
      if (robot.currentSignal.status === 'gale_pending') {
        return 'Aguardando G' + robot.galeCount + '\npara ' + this.colorEmoji(robot.currentSignal.target) + ' ' + this.colorLabel(robot.currentSignal.target);
      }
      return 'Sinal confirmado\naguardando resultado...';
    }
    if (robot.status !== 'online') return 'Robô ' + (robot.status === 'offline' ? 'Offline' : robot.status);
    return 'Aguardando próximo\npadrão confirmado...';
  }
};
