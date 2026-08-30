const TelegramService = {
  tokenKey: 'telegram-bot-token',
  liveStoreKey: 'telegram-live-messages-v1',
  entryStoreKey: 'telegram-entry-messages-v1',
  entryEventStoreKey: 'telegram-entry-events-v1',
  lockPrefix: 'telegram-live-lock:',
  ownerKey: 'telegram-owner-name',
  clientId: uid(),
  initialized: false,
  queues: {},
  _cachedTime: '',
  _cachedTimeAt: 0,

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
    EventBus.on('signal:gale', (signal) => this.handleSignalChange(signal));
    EventBus.on('signal:win', (signal) => this.handleSignalChange(signal));
    EventBus.on('signal:loss', (signal) => this.handleSignalChange(signal));
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
    return msgType === 'live' || msgType === 'both';
  },

  shouldSendSignal(robot) {
    if (!this.isTelegramEnabled(robot)) return false;
    const msgType = robot.telegram?.msgType || 'both';
    return msgType === 'signal' || msgType === 'both';
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
      const key = 'live:' + this.messageKey(robot);
      await this.enqueue(key, () => this.sendOrEditLiveMessage(robot));
    }
  },

  async handleResultChange(result) {
    await this.updateLiveMessages(result);
    await this.sendPendingEntryMessages(result);
    await this.refreshResolvedEntryMessages(result);
  },

  async sendPendingEntryMessages(result) {
    const game = result?.label || result?.game;
    if (!game) return;
    const robots = RobotEngine.getAllRobots().filter(robot => (
      robot.status === 'online' &&
      robot.game === game &&
      this.shouldSendSignal(robot) &&
      robot.currentSignal &&
      !robot.currentSignal.entrySent
    ));
    for (const robot of robots) {
      const snapshot = { ...robot.currentSignal };
      if (!this.shouldProcessEntryEvent(robot, snapshot)) {
        robot.currentSignal.entrySent = true;
        continue;
      }
      robot.currentSignal.entrySent = true;
      await this.enqueueEntryMessage(robot, snapshot);
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

  shouldProcessEntryEvent(robot, signal) {
    const eventKey = this.entryEventKey(robot, signal);
    if (!eventKey) return true;
    const events = this.getEntryEvents();
    if (events[eventKey]) return false;
    events[eventKey] = Date.now();
    const entries = Object.entries(events).sort((a, b) => b[1] - a[1]).slice(0, 300);
    this.saveEntryEvents(Object.fromEntries(entries));
    signal.entryEventKey = eventKey;
    return true;
  },

  async enqueueEntryMessage(robot, signal) {
    const key = 'entry:' + this.entryMessageKey(robot);
    return this.enqueue(key, () => this.withLock(key, () => this.sendEntryMessage(robot, signal)));
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
    if (lock && lock.expiresAt > now && lock.owner !== this.clientId) return;

    localStorage.setItem(lockKey, JSON.stringify({ owner: this.clientId, expiresAt: now + 12000 }));
    const confirmed = this.readLock(lockKey);
    if (!confirmed || confirmed.owner !== this.clientId) return;

    try {
      await task();
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
    if (!token || !chatId) return;

    const text = this.buildLiveMessage(robot);
    const messages = this.getLiveMessages();
    const key = this.messageKey(robot);
    const current = messages[key];
    if (current?.text === text) return;

    if (current?.messageId) {
      const edited = await this.api(token, 'editMessageText', {
        chat_id: chatId,
        message_id: current.messageId,
        text,
        disable_web_page_preview: true
      });
      if (edited.ok) {
        messages[key].text = text;
        messages[key].updatedAt = Date.now();
        this.saveLiveMessages(messages);
        return;
      }
      if (!this.isRecoverableEditError(edited) && !this.isNotModified(edited)) {
        this.logApiError('editMessageText/live', edited);
        return;
      }
      delete messages[key];
      this.saveLiveMessages(messages);
    }

    const sent = await this.api(token, 'sendMessage', {
      chat_id: chatId,
      text,
      disable_web_page_preview: true
    });
    if (sent.ok && sent.result?.message_id) {
      messages[key] = { messageId: sent.result.message_id, text, updatedAt: Date.now() };
      this.saveLiveMessages(messages);
    } else {
      this.logApiError('sendMessage/live', sent);
    }
  },

  async sendEntryMessage(robot, signal) {
    const token = this.getToken();
    const chatId = robot.telegram?.channelId || '';
    if (!token || !chatId) return false;

    const messages = this.getEntryMessages();
    const key = this.entryMessageKey(robot);
    const text = this.buildEntryMessage(robot, signal);
    const current = messages[key];

    if (current?.messageId) {
      const deleted = await this.api(token, 'deleteMessage', {
        chat_id: chatId,
        message_id: current.messageId
      });
      if (deleted.ok || this.isAlreadyDeleted(deleted)) {
        const latest = this.getEntryMessages();
        delete latest[key];
        this.saveEntryMessages(latest);
      } else {
        this.logApiError('deleteMessage/entry', deleted);
        return false;
      }
    }

    const sent = await this.api(token, 'sendMessage', {
      chat_id: chatId,
      text,
      disable_web_page_preview: true
    });
    if (sent.ok && sent.result?.message_id) {
      const latest = this.getEntryMessages();
      latest[key] = {
        messageId: sent.result.message_id,
        text,
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

  isNotModified(response) {
    return response?.description && response.description.toLowerCase().includes('message is not modified');
  },

  isRecoverableEditError(response) {
    const description = String(response?.description || '').toLowerCase();
    return (
      description.includes('message to edit not found') ||
      description.includes('message can\'t be edited') ||
      description.includes('message identifier is not specified') ||
      description.includes('message_id_invalid')
    );
  },

  isAlreadyDeleted(response) {
    const description = String(response?.description || '').toLowerCase();
    return (
      description.includes('message to delete not found') ||
      description.includes('message to be deleted not found') ||
      description.includes('message not found') ||
      description.includes('message_id_invalid')
    );
  },

  logApiError(context, response) {
    if (!response || response.ok) return;
    console.warn('[Telegram]', context, response.description || 'Erro desconhecido');
  },

  async api(token, method, payload) {
    try {
      const response = await fetch('https://api.telegram.org/bot' + token + '/' + method, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return await response.json();
    } catch (error) {
      return { ok: false, description: error.message };
    }
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
        '✅WIN!✅',
        '━━━━━━━━━━━━━━━━━━━',
        'Resultado: ' + resultEmoji + ' ' + resultLabel,
        '━━━━━━━━━━━━━━━━━━━',
        '📊 PLACAR: ✅' + wins + 'W / ❌' + losses + 'L (' + rate + '%)',
        ...this.buildEntryHistoryLines(robot)
      ].join('\n');
    }

    if (signal.status === 'loss') {
      const resultEmoji = this.colorEmoji(signal.result?.color);
      const resultLabel = this.colorLabel(signal.result?.color);
      return [
        '❌LOSS❌',
        '━━━━━━━━━━━━━━━━━━━',
        'Resultado: ' + resultEmoji + ' ' + resultLabel,
        '━━━━━━━━━━━━━━━━━━━',
        '📊 PLACAR: ✅' + wins + 'W / ❌' + losses + 'L (' + rate + '%)',
        ...this.buildEntryHistoryLines(robot)
      ].join('\n');
    }

    if (signal.status === 'gale_pending') {
      const resultEmoji = this.colorEmoji(signal.result?.color);
      const resultLabel = this.colorLabel(signal.result?.color);
      return [
        '⚡️ G' + (signal.gale || 1) + ' - TENTANDO NOVAMENTE',
        '━━━━━━━━━━━━━━━━━━━',
        'Resultado: ' + resultEmoji + ' ' + resultLabel,
        ...this.buildEntryHistoryLines(robot)
      ].join('\n');
    }

    const target = this.getSignalTarget(robot, signal);
    return [
      '🤖 SINAL ENCONTRADO',
      '🎯 ENTRAR NA COR',
      target.emoji + ' ' + target.label,
      '━━━━━━━━━━━━━━━━━━━━',
      '📈 Aproveitamento: ' + rate + '%',
      this.formatRateBar(rate),
      ...this.buildEntryHistoryLines(robot)
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
    const map = {
      '{wins}': wins,
      '{losses}': losses,
      '{rate}': rate,
      '{signals}': stats.signals || 0,
      '{target}': target.label,
      '{targetEmoji}': target.emoji,
      '{targetColor}': target.color,
      '{confidence}': signal.confidence || 0,
      '{gale}': signal.gale || 0,
      '{galeMax}': robot.gale?.max || 0,
      '{robotName}': robot.name || '',
      '{game}': robot.game === 'wheel' ? 'Wheel' : 'Double',
      '{strategy}': this.formatStrategy(robot.strategy),
      '{status}': status,
      '{history}': this.buildEntryHistoryLines(robot).join('\n'),
      '{historyEmojis}': this.formatRecentHistory(robot),
      '{lastResult}': robot.lastResult ? this.colorEmoji(robot.lastResult.color) + ' ' + this.colorLabel(robot.lastResult.color) : '--',
      '{diagnosticStatus}': (robot.diagnostic?.status || 'IDLE'),
      '{confidenceDiag}': (robot.diagnostic?.confidence || 0) + '%',
      '{pattern}': robot.diagnostic?.mainPattern || '--',
      '{time}': this.getCachedTime()
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
    const strategyLabel = this.formatStrategy(robot.strategy);
    const modeLabel = robot.mode === 'monitoramento' ? 'Monitoramento' : robot.mode === 'telegram' ? 'Telegram' : robot.mode;
    const entryEmoji = d.suggestedEntry ? this.colorEmoji(d.suggestedEntry) : '';
    const entryLabel = this.colorLabel(d.suggestedEntry);

    return [
      '🚨 ' + gameName + ' AO VIVO 🚨',
      '━━━━━━━━━━━━━━━━━━━━',
      'NOME DO ROBÔ:',
      robot.name,
      '',
      '📊 STATUS DO ROBÔ',
      '━━━━━━━━━━━━━━━━━━━━',
      '🟢 Status: ' + (robot.status === 'online' ? 'Online' : robot.status === 'offline' ? 'Offline' : robot.status),
      '🎮 Jogo: ' + gameLabel,
      '♟️ Estratégia: ' + strategyLabel,
      '🔄 Modo: ' + modeLabel,
      '🎯 Ultimo Resultado: ' + lastResultEmoji + ' ' + lastResultLabel,
      '',
      '🧠 DIAGNOSTICO DA IA',
      '━━━━━━━━━━━━━━━━━━━━',
      '📡 Status: ' + (d.status || 'IDLE'),
      '📊 ' + (d.analyzedResults || 0) + ' Resultados Analisados',
      '🔥 Confiança: ' + (d.confidence || 0) + '%',
      '🔍 Padrão: ' + (d.mainPattern || '--'),
      '🎯 Entrada: ' + entryEmoji + ' ' + entryLabel,
      '⭐ Score: ' + (d.totalScore || 0) + '/100',
      '━━━━━━━━━━━━━━━━━━━━',
      '🎡 HISTÓRICO RECENTE',
      this.formatRecentHistory(robot),
      '━━━━━━━━━━━━━━━━━━━━',
      '🏆 RESULTADO DA SESSÃO',
      '✅ WIN: ' + wins + ' | ❌ LOSS: ' + losses,
      '━━━━━━━━━━━━━━━━━━━━',
      '📨 Sinais Enviados: ' + sent,
      '🎯 SG: ' + sg + (g1 > 0 || robot.gale?.max >= 1 ? ' | 🛡️ G1: ' + g1 : ''),
      '━━━━━━━━━━━━━━━━━━━━',
      '📊 APROVEITAMENTO',
      this.formatRateBar(rate) + ' ' + rate + '%',
      '━━━━━━━━━━━━━━━━━━━━',
      '⏳ STATUS DO ROBÔ',
      '━━━━━━━━━━━━━━━━━━━━',
      this.formatRobotStatus(robot),
      '━━━━━━━━━━━━━━━━━━━━',
      '🌐 Site: ',
      '🕕 Horário Atual: ' + this.getCachedTime()
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
    const map = {
      '{wins}': wins,
      '{losses}': losses,
      '{rate}': rate,
      '{signals}': stats.signals || 0,
      '{winSG}': stats.winSG || 0,
      '{winG1}': stats.winG1 || 0,
      '{winG2}': stats.winG2 || 0,
      '{robotName}': robot.name || '',
      '{game}': gameLabel,
      '{gameName}': robot.game === 'wheel' ? 'WHEEL' : 'DOUBLE',
      '{strategy}': strategyLabel,
      '{mode}': modeLabel,
      '{status}': robot.status === 'online' ? 'Online' : robot.status === 'offline' ? 'Offline' : robot.status,
      '{lastResult}': lastResultEmoji + ' ' + lastResultLabel,
      '{lastResultEmoji}': lastResultEmoji,
      '{lastResultLabel}': lastResultLabel,
      '{diagnosticStatus}': d.status || 'IDLE',
      '{analyzedResults}': d.analyzedResults || 0,
      '{confidenceDiag}': d.confidence || 0,
      '{pattern}': d.mainPattern || '--',
      '{entry}': entryEmoji + ' ' + entryLabel,
      '{entryEmoji}': entryEmoji,
      '{entryLabel}': entryLabel,
      '{score}': d.totalScore || 0,
      '{history}': this.formatRecentHistory(robot),
      '{historyEmojis}': this.formatRecentHistory(robot),
      '{time}': this.getCachedTime()
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
    const color = cfgColor && cfgColor !== 'ANY' && cfgColor !== 'ALL' ? cfgColor : String(signal.target || '').toUpperCase();
    const multiplier = robot.target?.multiplier ? ' ' + robot.target.multiplier + 'X' : '';
    return {
      color,
      emoji: this.colorEmoji(color),
      label: this.colorLabel(color) + multiplier
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

  formatStrategy(strategy) {
    const map = {
      alternancia: 'Alternância',
      repeticao: 'Repetição',
      frequencia: 'Frequência',
      tendencia: 'Tendência',
      espelhamento: 'Espelhamento',
      diagonal: 'Diagonal'
    };
    return map[strategy] || strategy || '--';
  },

  formatProtection(robot) {
    const max = robot.gale?.max || 0;
    if (max <= 0) return '🎯 ENTRADA SECA';
    return '🛡 PROTEÇÃO ATÉ G' + max;
  },

  formatHistoryTitle(robot) {
    return robot.game === 'wheel' ? '🎡 HISTÓRICO RECENTE' : '🎲 HISTÓRICO RECENTE';
  },

  formatRecentHistory(robot) {
    const key = robot.game === 'wheel' ? 'historico-wheel-v1' : 'historico-double-v1';
    let history = [];
    try {
      const raw = JSON.parse(localStorage.getItem(key) || '[]');
      if (Array.isArray(raw)) {
        history = raw.slice(0, 10).map(r => ({
          color: robot.game === 'double' ? (r.color || '').toUpperCase() : (r.cellColor || r.color || '').toUpperCase()
        }));
      }
    } catch {}
    if (!history.length && robot.history && robot.history.length) {
      history = robot.history.slice(0, 10);
    }
    if (!history.length) return 'Aguardando resultados...';
    return history.map(item => this.colorEmoji(item.color)).join(' ');
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
