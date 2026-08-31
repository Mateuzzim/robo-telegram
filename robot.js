class Robot {
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.game = config.game;
    this.strategy = config.strategy;
    this.status = 'offline';
    this.mode = config.mode || 'monitoramento';
    this.resultsToAnalyze = config.resultsToAnalyze || 10;
    this.minimumConfidence = config.minimumConfidence || 80;
    this.confirmations = config.confirmations || 2;
    this.intervalMin = config.intervalMin || 60;
    this.gale = { enabled: config.galeMax > 0, max: config.galeMax || 0 };
    this.telegram = config.telegram || { enabled: false, channelId: '', msgType: 'both' };
    this.telegram.msgType = this.telegram.msgType || 'both';
    this.telegram.message = this.telegram.message || {};
    this.telegram.message.entry = this.telegram.message.entry || '';
    this.telegram.message.live = this.telegram.message.live || '';
    this.target = config.target || { color: 'any', multiplier: null };
    this.filterMode = config.filterMode || 'moderado';
    this.history = Array.isArray(config.history) ? config.history : [];
    this.stats = {
      signals: 0, wins: 0, losses: 0, winSG: 0, winG1: 0, winG2: 0,
      currentStreak: 0, maxWinStreak: 0, maxLossStreak: 0,
      patternsFound: 0, signalsApproved: 0, signalsRejected: 0,
      ...(config.stats || {})
    };
    this.lastHeartbeat = config.lastHeartbeat || Date.now();
    this.lastResult = config.lastResult || null;
    this.lastSignal = config.lastSignal ? { ...config.lastSignal } : null;
    this.currentSignal = config.currentSignal ? { ...config.currentSignal } : null;
    this.galeCount = config.galeCount || 0;
    this.lastSignalTime = config.lastSignalTime || 0;
    this.normalizeSavedSignalTargets();
    this.logs = Array.isArray(config.logs) ? config.logs : [];
    this.diagnostic = config.diagnostic || { status: 'IDLE', analyzedResults: 0, mainPattern: null, confidence: 0, suggestedEntry: null, patternScores: {}, totalScore: 0, filterResults: {}, decision: null, risk: 'BAIXO', signalScore: 0, confluences: 0, signalBlocked: false, blockReason: '' };
    this.signalFlow = config.signalFlow || { step1: 'Aguardando padrao...', step2: 'Nenhuma entrada pendente', step3: 'Aguardando entrada...', step4: 'Placar sera atualizado apos resultado' };
    this.strategyIndex = config.strategyIndex || 0;
    this.usedPatterns = config.usedPatterns || { RED: [], BLACK: [], GREY: [] };
  }

  normalizeColor(color) {
    const c = String(color || '').toUpperCase();
    if (this.game === 'wheel') {
      if (c === 'BLACK' || c === 'GRAY') return 'GREY';
    }
    if (this.game === 'double') {
      if (c === 'GREY' || c === 'GRAY') return 'BLACK';
    }
    return c;
  }

  normalizeResult(result) {
    const normalized = {
      color: this.normalizeColor(result?.color ?? result?.cellColor),
      number: result?.number ?? result?.cellIndex,
      multiplier: result?.multiplier ?? null
    };
    const roundId = result?.roundId ?? result?.roundID ?? result?.roundUuid ?? result?.roundUUID ?? result?.gameId ?? result?.gameID ?? result?.id ?? result?.uuid;
    if (roundId !== undefined && roundId !== null) normalized.roundId = String(roundId);
    return normalized;
  }

  getResultKey(result) {
    const normalized = result?.color !== undefined && result?.number !== undefined ? result : this.normalizeResult(result);
    if (normalized.roundId) return 'round:' + normalized.roundId;
    return (normalized.color || '') + ':' + (normalized.number ?? '');
  }

  getFixedTargetColor() {
    const targetColor = this.normalizeColor(this.target?.color || 'any');
    return targetColor !== 'ANY' && targetColor !== 'ALL' ? targetColor : null;
  }

  normalizeSignalTarget(signal) {
    if (!signal) return;
    const fixedTarget = this.getFixedTargetColor();
    if (fixedTarget) signal.target = fixedTarget;
    else if (signal.target) signal.target = this.normalizeColor(signal.target);
  }

  normalizeSavedSignalTargets() {
    this.normalizeSignalTarget(this.lastSignal);
    this.normalizeSignalTarget(this.currentSignal);
  }

  receiveResult(result) {
    const normalized = this.normalizeResult(result);
    const color = normalized.color;
    const key = this.getResultKey(normalized);
    const duplicate = this.history.slice(0, 5).some(h => this.getResultKey(h) === key);
    if (duplicate) return false;
    this.lastResult = { ...result, ...normalized, resultKey: key };
    this.lastHeartbeat = Date.now();
    this.history.unshift({ color, number: normalized.number, multiplier: normalized.multiplier, roundId: normalized.roundId, resultKey: key, timestamp: Date.now() });
    if (this.history.length > 200) this.history.pop();
    this.addLog('Resultado: ' + (color || normalized.number));
    this.analyze();
    return true;
  }

  analyze() {
    this.diagnostic.analyzedResults = this.history.length;

    if (this.history.length < this.resultsToAnalyze) {
      this.diagnostic.status = 'LOADING';
      this.diagnostic.mainPattern = `Aguardando dados (${this.history.length}/${this.resultsToAnalyze})`;
      this.diagnostic.confidence = 0;
      this.diagnostic.suggestedEntry = this.getFixedTargetColor() || null;
      this.diagnostic.patternScores = {};
      this.diagnostic.totalScore = 0;
      this.diagnostic.filterResults = {};
      this.diagnostic.decision = null;
      EventBus.emit('robot:state', this.getState());
      return;
    }

    this.diagnostic.status = 'ANALYZING';

    const fixedTarget = this.getFixedTargetColor();
    if (fixedTarget) {
      this.diagnostic.suggestedEntry = fixedTarget;
    }

    const strategies = RobotEngine.strategies;
    const strategyNames = Object.keys(strategies);
    const minConf = this.minimumConfidence || 65;

    const scores = {};
    let total = 0;
    for (const [name, fn] of Object.entries(strategies)) {
      const r = fn(this.history, this.target);
      scores[name] = r.confidence || 0;
      total += r.confidence || 0;
    }
    this.diagnostic.patternScores = scores;
    this.diagnostic.totalScore = Math.round(total / Object.keys(scores).length);

    if (this.currentSignal) {
      this.diagnostic.status = 'WAITING_RESULT';
      this.diagnostic.mainPattern = 'Sinal pendente - aguardando proximo resultado';
      this.diagnostic.confidence = this.currentSignal.confidence || 0;
      this.diagnostic.suggestedEntry = this.currentSignal.target || null;
      this.signalFlow = {
        step1: 'SINAL ATIVO: ' + (this.currentSignal.target || '--'),
        step2: 'Aguardando proximo resultado...',
        step3: 'Estrategia: ' + (this.currentSignal.reason || this.strategy),
        step4: 'Gale: ' + (this.galeCount || 0) + '/' + (this.gale?.max || 0)
      };
      EventBus.emit('robot:state', this.getState());
      return;
    }

    let signal = null;
    const startIndex = this.strategyIndex % strategyNames.length;

    for (let i = 0; i < strategyNames.length; i++) {
      const idx = (startIndex + i) % strategyNames.length;
      const name = strategyNames[idx];
      const fn = strategies[name];
      const result = fn(this.history, this.target);

      this.diagnostic.mainPattern = name;
      this.diagnostic.confidence = result.confidence || 0;

      if (!result.matched || result.confidence < minConf) {
        this.signalFlow = {
          step1: 'Ciclo: ' + name,
          step2: 'Confianca: ' + (result.confidence || 0) + '% (min: ' + minConf + '%)',
          step3: result.matched ? 'Confianca baixa - proxima estrategia' : (result.reason || 'Nao detectado'),
          step4: 'Aguardando proximo resultado...'
        };
        EventBus.emit('robot:state', this.getState());
        continue;
      }

      const targetColor = this.normalizeColor(result.target);
      if (this.isPatternUsed(name, targetColor)) {
        this.signalFlow = {
          step1: 'Ciclo: ' + name,
          step2: 'Padrao JA USADO para ' + this.colorLabel(targetColor),
          step3: 'Ignorando - proxima estrategia',
          step4: 'Aguardando proximo resultado...'
        };
        EventBus.emit('robot:state', this.getState());
        continue;
      }

      const fixedTarget = this.getFixedTargetColor();
      if (fixedTarget) result.target = fixedTarget;
      this.diagnostic.suggestedEntry = result.target || null;

      signal = RobotEngine.evaluate(this, result);
      if (signal) {
        this.markPatternUsed(name, signal.target);
        this.strategyIndex = (idx + 1) % strategyNames.length;
        this.addLog('SINAL APROVADO: ' + signal.target + ' (' + signal.confidence + '%) via ' + name);
        EventBus.emit('signal:created', signal);
        break;
      }
    }

    if (!signal) {
      this.diagnostic.status = 'IDLE';
      this.diagnostic.signalBlocked = true;
      this.diagnostic.blockReason = 'Nenhuma estrategia aprovada neste ciclo';
      this.signalFlow = {
        step1: 'Ciclo completo: ' + strategyNames.length + ' estrategias',
        step2: 'Nenhuma aprovada',
        step3: 'Aguardando proximo resultado...',
        step4: 'Proximo: ' + strategyNames[this.strategyIndex % strategyNames.length]
      };
    }

    this.diagnostic.status = signal ? 'SIGNAL_READY' : 'ACTIVE';
    EventBus.emit('robot:state', this.getState());
  }

  isPatternUsed(strategy, targetColor) {
    const colorKey = String(targetColor || '').toUpperCase();
    const used = this.usedPatterns[colorKey] || [];
    return used.some(p => p.strategy === strategy);
  }

  markPatternUsed(strategy, targetColor) {
    const colorKey = String(targetColor || '').toUpperCase();
    if (!this.usedPatterns[colorKey]) this.usedPatterns[colorKey] = [];
    this.usedPatterns[colorKey].push({ strategy, time: Date.now() });
    if (this.usedPatterns[colorKey].length > 20) this.usedPatterns[colorKey].shift();
  }

  resetUsedPatterns() {
    this.usedPatterns = { RED: [], BLACK: [], GREY: [] };
    this.strategyIndex = 0;
    this.addLog('Padroes resetados');
  }

  colorLabel(color) {
    const c = String(color || '').toUpperCase();
    if (c === 'RED') return 'VERMELHO';
    if (c === 'BLACK' || c === 'GREY' || c === 'GRAY') return 'PRETO';
    if (c === 'GREEN') return 'VERDE';
    return c || '--';
  }

  checkResult(result, pendingSignal) {
    const signal = pendingSignal || this.currentSignal;
    if (!signal) return;
    const normalized = this.normalizeResult(result);
    const resultKey = this.getResultKey(normalized);
    if (signal.waitingAfterResultKey && signal.waitingAfterResultKey === resultKey) return;
    if (signal.sourceResultKey && signal.sourceResultKey === resultKey) return;
    if (signal.lastCheckedResultKey && signal.lastCheckedResultKey === resultKey) return;
    signal.lastCheckedResultKey = resultKey;
    const rColor = normalized.color;
    const targetColor = this.normalizeColor(signal.target);
    const won = rColor === targetColor;
    if (won) {
      const resolvedGale = this.galeCount;
      signal.status = 'win';
      signal.gale = resolvedGale;
      signal.result = { color: rColor, number: normalized.number, multiplier: normalized.multiplier, time: Date.now() };
      this.stats.wins++;
      if (resolvedGale === 0) this.stats.winSG = (this.stats.winSG || 0) + 1;
      if (resolvedGale === 1) this.stats.winG1 = (this.stats.winG1 || 0) + 1;
      if (resolvedGale === 2) this.stats.winG2 = (this.stats.winG2 || 0) + 1;
      this.stats.currentStreak = Math.max(1, (this.stats.currentStreak || 0) + 1);
      this.stats.maxWinStreak = Math.max(this.stats.maxWinStreak || 0, this.stats.currentStreak);
      if (this.currentSignal === signal) this.currentSignal = null;
      this.galeCount = 0;
      this.diagnostic.status = 'RESOLVED';
      this.diagnostic.mainPattern = 'WIN confirmado no resultado seguinte';
      this.diagnostic.suggestedEntry = null;
      this.signalFlow = {
        step1: 'WIN: ' + this.colorLabel(targetColor),
        step2: 'Resultado: ' + this.colorLabel(rColor),
        step3: 'Resolvido no G' + resolvedGale,
        step4: 'Placar atualizado'
      };
      this.addLog('WIN! ' + rColor + ' === ' + targetColor);
      EventBus.emit('signal:win', { ...signal, robotId: this.id });
    } else {
      this.galeCount++;
      if (this.galeCount <= this.gale.max) {
        signal.status = 'gale_pending';
        signal.gale = this.galeCount;
        signal.waitingAfterResultKey = resultKey;
        signal.sourceResultKey = resultKey;
        signal.result = { color: rColor, number: normalized.number, multiplier: normalized.multiplier, time: Date.now() };
        this.diagnostic.status = 'WAITING_RESULT';
        this.diagnostic.mainPattern = 'Gale ' + this.galeCount + ' ativo - aguardando proximo resultado';
        this.diagnostic.suggestedEntry = targetColor;
        this.diagnostic.decision = { approved: true, target: targetColor, confidence: signal.confidence, reason: 'Gale ' + this.galeCount + ' aguardando proxima cor' };
        this.signalFlow = {
          step1: 'LOSS parcial: ' + this.colorLabel(rColor),
          step2: 'Entrar Gale ' + this.galeCount + ' em ' + this.colorLabel(targetColor),
          step3: 'Aguardando proxima cor...',
          step4: 'Gale: ' + this.galeCount + '/' + this.gale.max
        };
        this.addLog('LOSS - Gale ' + this.galeCount + '/' + this.gale.max);
        EventBus.emit('signal:gale', { ...signal, robotId: this.id });
      } else {
        signal.status = 'loss';
        signal.gale = this.gale.max;
        signal.result = { color: rColor, number: normalized.number, multiplier: normalized.multiplier, time: Date.now() };
        this.stats.losses++;
        this.stats.currentStreak = Math.min(-1, (this.stats.currentStreak || 0) - 1);
        this.stats.maxLossStreak = Math.max(this.stats.maxLossStreak || 0, Math.abs(this.stats.currentStreak));
        if (this.currentSignal === signal) this.currentSignal = null;
        this.galeCount = 0;
        this.diagnostic.status = 'RESOLVED';
        this.diagnostic.mainPattern = 'LOSS final confirmado no resultado seguinte';
        this.diagnostic.suggestedEntry = null;
        this.signalFlow = {
          step1: 'LOSS FINAL',
          step2: 'Resultado: ' + this.colorLabel(rColor),
          step3: 'Limite de gale atingido',
          step4: 'Placar atualizado'
        };
        this.addLog('LOSS FINAL');
        EventBus.emit('signal:loss', { ...signal, robotId: this.id });
      }
    }
  }

  addLog(message) {
    const entry = { time: Date.now(), message, id: this.id };
    this.logs.unshift(entry);
    if (this.logs.length > 500) this.logs.pop();
    EventBus.emit('robot:log', entry);
  }

  getState() {
    return { id: this.id, name: this.name, game: this.game, strategy: this.strategy, status: this.status, mode: this.mode, target: this.target, filterMode: this.filterMode, telegram: { ...this.telegram, message: { ...(this.telegram.message || {}) } }, lastHeartbeat: this.lastHeartbeat, stats: { ...this.stats }, lastResult: this.lastResult, lastSignal: this.lastSignal, currentSignal: this.currentSignal, diagnostic: { ...this.diagnostic }, signalFlow: { ...this.signalFlow }, logs: [...this.logs], minimumConfidence: this.minimumConfidence, intervalMin: this.intervalMin, gale: { ...this.gale }, resultsToAnalyze: this.resultsToAnalyze, confirmations: this.confirmations, strategyIndex: this.strategyIndex, usedPatterns: JSON.parse(JSON.stringify(this.usedPatterns)) };
  }

  toJSON() {
    return { id: this.id, name: this.name, game: this.game, strategy: this.strategy, status: this.status, mode: this.mode, target: this.target, filterMode: this.filterMode, history: this.history.slice(0, 200), resultsToAnalyze: this.resultsToAnalyze, minimumConfidence: this.minimumConfidence, confirmations: this.confirmations, intervalMin: this.intervalMin, galeMax: this.gale.max, telegram: { ...this.telegram, message: { ...(this.telegram.message || {}) } }, stats: this.stats, lastHeartbeat: this.lastHeartbeat, lastResult: this.lastResult, lastSignal: this.lastSignal, currentSignal: this.currentSignal, galeCount: this.galeCount, lastSignalTime: this.lastSignalTime, diagnostic: this.diagnostic, signalFlow: this.signalFlow, logs: this.logs, strategyIndex: this.strategyIndex, usedPatterns: this.usedPatterns };
  }
}
