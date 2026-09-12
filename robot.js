function formatSignalLimitInterval(sl) {
  const h = sl.intervalHours || 0;
  const m = sl.intervalMinutes || 0;
  if (h > 0 && m > 0) return h + 'h' + m + 'min';
  if (h > 0) return h + 'h';
  if (m > 0) return m + 'min';
  return '5h';
}

class Robot {
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.game = config.game;
    this.strategy = config.strategy;
    this.strategies = Array.isArray(config.strategies) ? config.strategies : [config.strategy || 'alternancia'];
    this.status = 'offline';
    this.mode = config.mode || 'monitoramento';
    this.resultsToAnalyze = config.resultsToAnalyze || 500;
    const configuredMinimumConfidence = Number(config.minimumConfidence ?? 80);
    this.minimumConfidence = Number.isFinite(configuredMinimumConfidence) ? Math.max(0, Math.min(100, configuredMinimumConfidence)) : 80;
    this.minScore = config.minScore || 52;
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
    this.patternSize = config.patternSize || 3;
    this.lastPatternAnalysisTime = config.lastPatternAnalysisTime || 0;
    this.history = Array.isArray(config.history) ? config.history : [];
    if (this.game === 'wheel') this.history = this.removeImmediateDuplicateResults(this.history);
    this.stats = {
      signals: 0, wins: 0, losses: 0, winSG: 0, winG1: 0, winG2: 0,
      currentStreak: 0, maxWinStreak: 0, maxLossStreak: 0,
      patternsFound: 0, signalsApproved: 0, signalsRejected: 0,
      ...(config.stats || {})
    };
    this.lastHeartbeat = config.lastHeartbeat || Date.now();
    this.lastResult = config.lastResult || null;
    this.lastSignal = config.lastSignal ? { ...config.lastSignal } : null;
    this.strategyConfig = config.strategyConfig || {};
    this.currentSignal = config.currentSignal ? { ...config.currentSignal } : null;
    this.galeCount = config.galeCount || 0;
    this.lastSignalTime = config.lastSignalTime || 0;
    this.startedAt = config.startedAt || null;
    this.startDelayUntil = config.startDelayUntil || null;
    this._startDelayTimer = null;
    this.normalizeSavedSignalTargets();
    this.logs = Array.isArray(config.logs) ? config.logs : [];
    this.signalHistory = Array.isArray(config.signalHistory) ? config.signalHistory : [];
    this.diagnostic = config.diagnostic || { status: 'IDLE', analyzedResults: 0, mainPattern: null, confidence: 0, suggestedEntry: null, patternScores: {}, totalScore: 0, filterResults: {}, decision: null, risk: 'BAIXO', signalScore: 0, confluences: 0, signalBlocked: false, blockReason: '' };
    this.signalFlow = config.signalFlow || { step1: 'Aguardando padrao...', step2: 'Nenhuma entrada pendente', step3: 'Aguardando entrada...', step4: 'Placar sera atualizado apos resultado' };
    this.strategyIndex = config.strategyIndex || 0;
    this.usedPatterns = config.usedPatterns || { RED: [], BLACK: [], GREY: [], GREEN: [], BLUE: [] };
    this._lastResolvedTime = 0;
    this.greenProtection = config.greenProtection || false;
    this.filters = config.filters || [];
    const savedGaleByColor = config.galeByColor || {};
    const galeValue = (value, fallback) => {
      const number = Number(value);
      return Number.isFinite(number) && number >= 0 ? number : fallback;
    };
    this.galeByColor = {
      grey: galeValue(savedGaleByColor.grey, 1),
      red: galeValue(savedGaleByColor.red, 3),
      blue: galeValue(savedGaleByColor.blue, 5),
      green: galeValue(savedGaleByColor.green, 10),
      black: galeValue(savedGaleByColor.black, 1)
    };
    const confidenceValue = (value) => {
      const number = Number(value);
      return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 80;
    };
    const savedConfidenceByColor = config.confidenceByColor || {};
    this.confidenceByColor = {
      grey: confidenceValue(savedConfidenceByColor.grey),
      red: confidenceValue(savedConfidenceByColor.red),
      blue: confidenceValue(savedConfidenceByColor.blue),
      green: confidenceValue(savedConfidenceByColor.green),
      black: confidenceValue(savedConfidenceByColor.black)
    };
    this.autoPause = config.autoPause || 0;
    this.iaInteligente = config.iaInteligente || false;
    this.signalLimit = config.signalLimit || { enabled: false, intervalHours: 5, intervalMinutes: 0, maxSignals: 10 };
    this.iaState = config.iaState || { activeStrategy: null, activeTarget: null, evaluations: [], colorAnalyses: {}, scoreboard: null, lastAnalysisTime: 0 };
    this._signalTimestamps = Array.isArray(config._signalTimestamps) ? config._signalTimestamps : [];
    this.signalLimitTotal = config.signalLimitTotal || { wins: 0, losses: 0 };
    this._signalLimitNotified = config._signalLimitNotified || false;
    this._signalLimitWarningNotified = config._signalLimitWarningNotified || false;
    this._signalLimitWarningCycleKey = config._signalLimitWarningCycleKey || '';
    this._signalLimitReachedCycleKey = config._signalLimitReachedCycleKey || '';
  }

  getSignalLimitCycleKey(nextWindowAt, maxSignals) {
    const cycleAt = Math.floor(Number(nextWindowAt || 0) / 60000) * 60000;
    return this.id + ':' + cycleAt + ':' + (maxSignals || 0);
  }

  resetSignalLimitCycleIfOpen(nextWindowAt) {
    if (Number(nextWindowAt || 0) > Date.now()) return;
    this._signalLimitWarningNotified = false;
    this._signalLimitWarningCycleKey = '';
    this._signalLimitReachedCycleKey = '';
    if (this._signalLimitStartNotifyTimer) { clearTimeout(this._signalLimitStartNotifyTimer); this._signalLimitStartNotifyTimer = null; }
  }

  notifySignalLimitOnce(count, maxSignals, nextWindowAt) {
    const cycleKey = this.getSignalLimitCycleKey(nextWindowAt, maxSignals);
    if (this._signalLimitReachedCycleKey !== cycleKey) {
      this._signalLimitReachedCycleKey = cycleKey;
      const reachedData = {
        robotId: this.id,
        type: 'reached',
        time: Date.now(),
        count,
        max: maxSignals,
        intervalHours: this.signalLimit.intervalHours ?? 5,
        intervalMinutes: this.signalLimit.intervalMinutes ?? 0,
        nextWindowAt
      };
      localStorage.setItem('signalLimitNotify', JSON.stringify(reachedData));
      EventBus.emit('robot:signalLimitReached', reachedData);
    }
  }

  pauseSignalLimitUntil(count, maxSignals, nextWindowAt, notify = true) {
    const msUntilNext = Number(nextWindowAt || 0) - Date.now();
    if (msUntilNext <= 0) {
      this._signalLimitPaused = false;
      this.resetSignalLimitCycleIfOpen(nextWindowAt);
      return false;
    }
    this._signalLimitPaused = true;
    if (this._signalLimitPauseTimer) clearTimeout(this._signalLimitPauseTimer);
    if (this._signalLimitWarningTimer) clearTimeout(this._signalLimitWarningTimer);
    if (notify) this.notifySignalLimitOnce(count, maxSignals, nextWindowAt);
    const warningLeadMs = 5 * 60 * 1000;
    const warningMs = Math.max(0, msUntilNext - warningLeadMs);
    if (warningMs > 0 && !this._signalLimitWarningNotified) {
      this._signalLimitWarningTimer = setTimeout(() => {
        this._signalLimitWarningNotified = true;
        const warningData = { robotId: this.id, type: 'warning', time: Date.now(), nextWindowAt, maxSignals };
        localStorage.setItem('signalLimitNotify', JSON.stringify(warningData));
        EventBus.emit('robot:signalLimitWarning', warningData);
        this._signalLimitWarningTimer = null;
      }, warningMs);
    }
    this._signalLimitPauseTimer = setTimeout(() => {
      this._signalLimitPaused = false;
      this._signalLimitWarningNotified = false;
      this._signalTimestamps = [];
      this.signalHistory = [];
      this.signalLimitTotal = { wins: 0, losses: 0 };
      this.resetSignalLimitCycleIfOpen(nextWindowAt);
      this._signalLimitPauseTimer = null;
      this._signalLimitWarningTimer = null;
      if (this.signalLimit?.enabled) {
        const startData = { id: this.id, type: 'start', time: Date.now(), signalLimit: this.signalLimit, timestamps: [] };
        localStorage.setItem('signalLimitNotify', JSON.stringify(startData));
        EventBus.emit('robot:signalLimitStart', startData);
      }
      setTimeout(() => this.analyze(), 15000);
    }, msUntilNext);
    return true;
  }

  notifySignalLimitResolvedIfComplete() {
    if (!this.signalLimit?.enabled) return false;
    if (this.currentSignal) return false;
    const intervalMs = ((this.signalLimit.intervalHours ?? 5) * 60 + (this.signalLimit.intervalMinutes ?? 0)) * 60 * 1000;
    const maxSignals = this.signalLimit.maxSignals || 10;
    const windowStart = Date.now() - intervalMs;
    this._signalTimestamps = (this._signalTimestamps || []).filter(t => t > windowStart);
    if (this._signalTimestamps.length < maxSignals) return false;
    const firstTs = Math.min(...this._signalTimestamps);
    const nextWindowAt = firstTs + intervalMs;
    localStorage.setItem('signalLimitNotify', JSON.stringify({ robotId: this.id, type: 'update', time: Date.now() }));
    EventBus.emit('robot:signalLimitUpdate', { robotId: this.id });
    return this.pauseSignalLimitUntil(this._signalTimestamps.length, maxSignals, nextWindowAt, true);
  }

  getGaleMaxForTarget(targetColor) {
    if (this.target?.color === 'any' && this.game === 'wheel') {
      const normalizedTarget = this.normalizeColor(targetColor);
      const galeMap = {
        GREY: this.galeByColor.grey,
        RED: this.galeByColor.red,
        BLUE: this.galeByColor.blue,
        GREEN: this.galeByColor.green
      };
      return galeMap[normalizedTarget] ?? this.gale.max;
    }
    return this.gale.max;
  }

  getConfidenceForTarget(targetColor) {
    if (this.target?.color !== 'any') {
      return this.minimumConfidence;
    }
    const normalizedTarget = this.normalizeColor(targetColor);
    const confMap = this.game === 'wheel'
      ? {
          GREY: this.confidenceByColor.grey,
          RED: this.confidenceByColor.red,
          BLUE: this.confidenceByColor.blue,
          GREEN: this.confidenceByColor.green
        }
      : {
          BLACK: this.confidenceByColor.black,
          RED: this.confidenceByColor.red,
          GREEN: this.confidenceByColor.green
        };
    return confMap[normalizedTarget] ?? this.minimumConfidence;
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
    if (result?.storageId) normalized.storageId = String(result.storageId);
    if (result?.time) normalized.time = result.time;
    return normalized;
  }

  getResultKey(result) {
    const normalized = result?.color !== undefined && result?.number !== undefined ? result : this.normalizeResult(result);
    if (normalized.roundId) return 'round:' + normalized.roundId;
    if (normalized.storageId) return 'stored:' + normalized.storageId;
    return (normalized.color || '') + ':' + (normalized.number ?? '');
  }

  getResultSignature(result) {
    const normalized = result?.color !== undefined && result?.number !== undefined ? result : this.normalizeResult(result);
    return [
      normalized.color || '',
      normalized.number ?? '',
      normalized.multiplier || ''
    ].join(':');
  }

  getResultTime(result) {
    return Number(result?.time || result?.timestamp || 0);
  }

  isImmediateDuplicateResult(previous, result) {
    if (!previous || !result) return false;
    const prevKey = this.getResultKey(previous);
    const nextKey = this.getResultKey(result);
    if ((previous.roundId || result.roundId) && prevKey === nextKey) return true;
    if (this.getResultSignature(previous) !== this.getResultSignature(result)) return false;
    const prevTime = this.getResultTime(previous);
    const nextTime = this.getResultTime(result) || Date.now();
    if (!prevTime) return true;
    return Math.abs(nextTime - prevTime) <= 15000;
  }

  removeImmediateDuplicateResults(history) {
    if (!Array.isArray(history) || !history.length) return [];
    const cleaned = [];
    history.forEach(item => {
      if (!this.isImmediateDuplicateResult(cleaned[cleaned.length - 1], item)) {
        cleaned.push(item);
      }
    });
    return cleaned;
  }

  getFixedTargetColor() {
    const targetColor = this.normalizeColor(this.target?.color || 'any');
    if (targetColor === 'ANY' || targetColor === 'ALL' || targetColor.includes('+')) return null;
    return targetColor;
  }

  getAllowedTargets() {
    const raw = String(this.target?.color || 'any').toLowerCase();
    if (raw.includes('+')) {
      return raw.split('+').map(c => this.normalizeColor(c));
    }
    return null;
  }

  normalizeSignalTarget(signal) {
    if (!signal) return;
    const fixedTarget = this.getFixedTargetColor();
    if (fixedTarget) {
      signal.target = fixedTarget;
    } else {
      signal.target = this.normalizeColor(signal.target);
      const allowed = this.getAllowedTargets();
      if (allowed && !allowed.includes(signal.target)) {
        signal.target = allowed[0];
      }
    }
  }

  normalizeSavedSignalTargets() {
    this.normalizeSignalTarget(this.lastSignal);
    this.normalizeSignalTarget(this.currentSignal);
  }

  receiveResult(result) {
    const normalized = this.normalizeResult(result);
    const color = normalized.color;
    const key = this.getResultKey(normalized);
    const isDuplicate = this.game === 'wheel' && this.isImmediateDuplicateResult(this.history[0], normalized);
    if (isDuplicate && !this.currentSignal) return false;
    this.lastResult = { ...result, ...normalized, resultKey: key };
    this.lastHeartbeat = Date.now();
    if (!isDuplicate) {
      this.history.unshift({ color, number: normalized.number, multiplier: normalized.multiplier, roundId: normalized.roundId, storageId: normalized.storageId, resultKey: key, timestamp: normalized.time || Date.now() });
      if (this.history.length > 1000) this.history.pop();
      this.addLog('Resultado: ' + (color || normalized.number));
      const hadSignal = !!this.currentSignal;
      if (this.currentSignal) {
        this.checkResult(result);
      }
      if (hadSignal && !this.currentSignal) {
        setTimeout(() => {
          this.analyze();
          if (this.signalLimit?.enabled) {
            const finalLimitSent = this.notifySignalLimitResolvedIfComplete();
            if (!finalLimitSent) {
              const maxSig = this.signalLimit.maxSignals || 10;
              const usedCount = (this._signalTimestamps || []).length;
              if (usedCount < maxSig) {
                localStorage.setItem('signalLimitNotify', JSON.stringify({ robotId: this.id, type: 'update', time: Date.now() }));
                EventBus.emit('robot:signalLimitUpdate', { robotId: this.id });
              }
            }
          }
        }, 2000);
      } else {
        this.analyze();
      }
    }
    return true;
  }

  analyze() {
    const isOffline = this.status !== 'online';
    if (isOffline) {
      this.diagnostic.status = 'IDLE';
      this.diagnostic.mainPattern = 'Robo offline';
      this.diagnostic.confidence = 0;
      this.diagnostic.suggestedEntry = null;
      this.diagnostic.signalBlocked = true;
      this.diagnostic.blockReason = 'Robo offline';
      this.signalFlow = {
        step1: 'Verificando status',
        step2: 'Robot offline',
        step3: 'Aguardando online',
        step4: 'IDLE'
      };
      EventBus.emit('robot:state', this.getState());
      if (this._analyzeTimer) { clearTimeout(this._analyzeTimer); this._analyzeTimer = null; }
      return;
    }
    if (this._signalLimitPaused) {
      this.diagnostic.status = 'LIMIT_PAUSED';
      this.diagnostic.mainPattern = 'Limite atingido - aguardando proxima janela';
      this.diagnostic.confidence = 0;
      this.diagnostic.suggestedEntry = null;
      this.diagnostic.signalBlocked = true;
      this.diagnostic.blockReason = 'Pausado por limite de sinais';
      this.signalFlow = {
        step1: 'Limite de sinais',
        step2: 'Pausado automaticamente',
        step3: 'Aguardando proxima janela',
        step4: 'LIMIT_PAUSED'
      };
      EventBus.emit('robot:state', this.getState());
      if (this._analyzeTimer) { clearTimeout(this._analyzeTimer); this._analyzeTimer = null; }
      return;
    }
    if (!isOffline && this.startDelayUntil && Date.now() < this.startDelayUntil) {
      this.diagnostic.status = 'LOADING';
      this.diagnostic.mainPattern = 'Aguardando delay inicial...';
      this.diagnostic.confidence = 0;
      this.diagnostic.suggestedEntry = null;
      this.diagnostic.signalBlocked = true;
      this.diagnostic.blockReason = 'Delay inicial de 30s';
      this.signalFlow = {
        step1: 'Robo iniciando...',
        step2: 'Enviando live...',
        step3: 'Aguardando 30s...',
        step4: 'Depois inicia analises'
      };
      EventBus.emit('robot:state', this.getState());
      return;
    }
    if (this._signalLimitPaused) {
      this.diagnostic.status = 'WAITING_RESULT';
      this.diagnostic.mainPattern = 'Limite de sinais - aguardando nova janela';
      this.diagnostic.confidence = 0;
      this.diagnostic.suggestedEntry = null;
      this.diagnostic.signalBlocked = true;
      this.diagnostic.blockReason = 'Limite de sinais pausado até nova janela';
      this.signalFlow = {
        step1: 'Limite atingido',
        step2: 'Pausado até nova janela',
        step3: 'Aguardando liberação...',
        step4: '---'
      };
      EventBus.emit('robot:state', this.getState());
      return;
    }
    if (this._lastResolvedTime && Date.now() - this._lastResolvedTime < 2000) {
      this.diagnostic.status = 'WAITING_RESULT';
      EventBus.emit('robot:state', this.getState());
      return;
    }

    this.effectiveResults = Math.min(this.history.length, this.resultsToAnalyze);
    if (this.effectiveResults < 10) {
      this.diagnostic.status = 'LOADING';
      this.diagnostic.mainPattern = `Aguardando dados (${this.history.length}/${this.resultsToAnalyze})`;
      this.diagnostic.confidence = 0;
      this.diagnostic.suggestedEntry = this.getFixedTargetColor() || (this.getAllowedTargets() || [])[0] || null;
      this.diagnostic.patternScores = {};
      this.diagnostic.totalScore = 0;
      this.diagnostic.filterResults = {};
      this.diagnostic.decision = null;
      EventBus.emit('robot:state', this.getState());
      return;
    }

    const now = Date.now();
    if (this.strategy === 'padroesCores' && (now - this.lastPatternAnalysisTime) < 5000) {
      if (this.currentSignal) {
        this.diagnostic.status = 'WAITING_RESULT';
      }
      EventBus.emit('robot:state', this.getState());
      return;
    }
    if (this.strategy === 'padroesCores') {
      this.lastPatternAnalysisTime = now;
    }

    this.diagnostic.status = 'ANALYZING';

    if (this.iaInteligente) {
      this.analyzeIntelligentStrategy();
    }

    const fixedTarget = this.getFixedTargetColor();
    if (this.iaInteligente && this.iaState.activeTarget) {
      this.diagnostic.suggestedEntry = this.iaState.activeTarget;
    } else if (fixedTarget) {
      this.diagnostic.suggestedEntry = fixedTarget;
    } else {
      const allowed = this.getAllowedTargets();
      if (allowed) this.diagnostic.suggestedEntry = allowed.join(' / ');
    }

    const strategies = RobotEngine.strategies;
    const strategyNames = Object.keys(strategies);
    const defaultMinConf = this.minimumConfidence ?? 65;

    const scores = {};
    let total = 0;
    let activeCount = 0;
    const strategyDetails = {};
    for (const [name, fn] of Object.entries(strategies)) {
      const sc = (this.strategyConfig || {})[name] || {};
      const defaultPS = { alternancia: 5, repeticao: 5, frequencia: 1, tendencia: 5, espelhamento: 5, diagonal: 6, padroesCores: 3 };
      const ps = sc.patternSize || defaultPS[name] || 3;
      const r = fn(this.history.slice(0, this.effectiveResults), this.target, ps);
      scores[name] = r.confidence || 0;
      if (sc.enabled !== false) { total += r.confidence || 0; activeCount++; }
      strategyDetails[name] = {
        confidence: r.confidence || 0,
        matched: r.matched || false,
        target: r.target || null,
        reason: r.reason || '',
        pattern: r.pattern || null,
        analyses: r.analyses || null,
        confluences: r.confluences || 0,
        enabled: sc.enabled !== false
      };
    }
    this.diagnostic.patternScores = scores;
    this.diagnostic.totalScore = activeCount > 0 ? Math.round(total / activeCount) : 0;
    this.diagnostic.strategyDetails = strategyDetails;
    this.diagnostic.analyzedResults = this.history.length;
    this.diagnostic.numberAnalysis = this.analyzeNumbers(this.history);

    if (this.currentSignal) {
      const stratFn = strategies[this.strategy] || strategies[Object.keys(strategies)[0]];
      let stratResult = null;
      if (stratFn) {
        const sc2 = (this.strategyConfig || {})[this.strategy] || {};
        const defaultPS2 = { alternancia: 5, repeticao: 5, frequencia: 1, tendencia: 5, espelhamento: 5, diagonal: 6, padroesCores: 3 };
        const ps2 = sc2.patternSize || defaultPS2[this.strategy] || 3;
        stratResult = stratFn(this.history.slice(0, this.effectiveResults), this.target, ps2);
      }
      this.diagnostic.status = 'WAITING_RESULT';
      this.diagnostic.mainPattern = 'Gale ' + (this.galeCount || 0) + '/' + (this.gale?.max || 0) + ' - ' + (stratResult?.reason || 'aguardando');
      this.diagnostic.confidence = this.currentSignal.confidence || 0;
      this.diagnostic.suggestedEntry = this.currentSignal.target || null;
      if (stratResult?.analyses) this.diagnostic.analyses = stratResult.analyses;
      if (stratResult?.confluences !== undefined) this.diagnostic.confluences = stratResult.confluences;
      this.signalFlow = {
        step1: 'SINAL ATIVO: ' + (this.currentSignal.target || '--'),
        step2: 'Gale ' + (this.galeCount || 0) + '/' + (this.gale?.max || 0),
        step3: 'Estrategia: ' + (stratResult?.reason || this.strategy || '--'),
        step4: 'Aguardando proximo resultado...'
      };
      EventBus.emit('robot:state', this.getState());
      return;
    }

    let signal = null;
    const robotStrategies = this.strategies || (this.strategy ? [this.strategy] : []);
    let namesToTry = robotStrategies.length ? robotStrategies.slice() : Object.keys(strategies).filter(s => s !== 'iaInteligente');

    if (this.iaInteligente && this.iaState.activeStrategy && strategies[this.iaState.activeStrategy]) {
      namesToTry = [this.iaState.activeStrategy];
    }

    let bestConfidence = 0;
    let bestPattern = null;
    let bestStrategy = null;

    for (const name of namesToTry) {
      if (!strategies[name]) continue;
      const sc = (this.strategyConfig || {})[name] || {};
      if (sc.enabled === false) continue;
      const fn = strategies[name];
      const result = fn(this.history.slice(0, this.effectiveResults), this.target, this.patternSize);

      if (sc.target && sc.target !== 'any' && result.target) {
        result.target = sc.target.toUpperCase();
      }

      if ((result.confidence || 0) > bestConfidence) {
        bestConfidence = result.confidence || 0;
        bestPattern = result.pattern || null;
        bestStrategy = name;
      }

      this.diagnostic.mainPattern = bestPattern ? bestPattern.join(',') : name;
      this.diagnostic.confidence = bestConfidence;
      if (result.analyses) this.diagnostic.analyses = result.analyses;
      if (result.confluences !== undefined) this.diagnostic.confluences = result.confluences;

      const confidenceTarget = this.iaInteligente && this.iaState.activeTarget
        ? this.iaState.activeTarget
        : result.target;
      const targetMinConf = this.getConfidenceForTarget(confidenceTarget) ?? defaultMinConf;
      const effectiveMinConf = Math.max(targetMinConf, sc.minConfidence || 0);

      if (!result.matched || result.confidence < effectiveMinConf) {
        const multiStrat = namesToTry.length > 1;
        this.signalFlow = {
          step1: (multiStrat ? 'Analisando: ' : 'Ciclo: ') + name,
          step2: 'Confianca: ' + (result.confidence || 0) + '% (min: ' + effectiveMinConf + '%)',
          step3: result.matched ? 'Confianca baixa - ' + (multiStrat ? 'proxima estrategia' : 'aguardando') : (result.reason || 'Nao detectado'),
          step4: 'Aguardando proximo resultado...'
        };
        EventBus.emit('robot:state', this.getState());
        continue;
      }

      const targetColor = this.normalizeColor(result.target);
      if (this.isPatternUsed(name, targetColor)) {
        this.signalFlow = {
          step1: 'Analisando: ' + name,
          step2: 'Padrao JA USADO para ' + this.colorLabel(targetColor),
          step3: 'Ignorando - proxima estrategia',
          step4: 'Aguardando proximo resultado...'
        };
        EventBus.emit('robot:state', this.getState());
        continue;
      }

      const fixedTarget = this.getFixedTargetColor();
      if (this.iaInteligente && this.iaState.activeTarget) {
        result.target = this.iaState.activeTarget;
      } else if (fixedTarget) {
        result.target = fixedTarget;
      } else {
        const allowed = this.getAllowedTargets();
        if (allowed && result.target && !allowed.includes(this.normalizeColor(result.target))) {
          result.target = allowed[0];
        }
      }
      this.diagnostic.suggestedEntry = result.target || null;

signal = RobotEngine.evaluate(this, result);
       if (signal) {
         if (this.signalLimit?.enabled) {
           const intervalMs = ((this.signalLimit.intervalHours ?? 5) * 60 + (this.signalLimit.intervalMinutes ?? 0)) * 60 * 1000;
           const maxSignals = this.signalLimit.maxSignals || 10;
           const windowStart = Date.now() - intervalMs;
           this._signalTimestamps = this._signalTimestamps.filter(t => t > windowStart);
             if (this._signalTimestamps.length >= maxSignals) {
               const firstTs = Math.min(...this._signalTimestamps);
               const nextWindowAt = firstTs + intervalMs;
                this.pauseSignalLimitUntil(this._signalTimestamps.length, maxSignals, nextWindowAt, false);
               this.diagnostic.status = 'WAITING_RESULT';
              this.diagnostic.mainPattern = 'Limite de sinais atingido (' + this._signalTimestamps.length + '/' + maxSignals + ')';
              this.diagnostic.confidence = 0;
              this.diagnostic.suggestedEntry = null;
              this.diagnostic.signalBlocked = true;
              this.diagnostic.blockReason = 'Limite de sinais: ' + this._signalTimestamps.length + '/' + maxSignals + ' em ' + formatSignalLimitInterval(this.signalLimit);
              this.signalFlow = { step1: 'Limite de sinais', step2: this._signalTimestamps.length + '/' + maxSignals + ' em ' + formatSignalLimitInterval(this.signalLimit), step3: 'Aguardando proximo ciclo', step4: 'Sinal bloqueado' };
               EventBus.emit('robot:state', this.getState());
               continue;
            }
            this._signalTimestamps.push(Date.now());
            if (this._signalTimestamps.length >= maxSignals) {
              const firstTs = Math.min(...this._signalTimestamps);
              this.pauseSignalLimitUntil(this._signalTimestamps.length, maxSignals, firstTs + intervalMs, false);
            }
          }
          this.markPatternUsed(name, signal.target);
          this.addLog('SINAL APROVADO: ' + signal.target + ' (' + signal.confidence + '%) via ' + name + (this.iaInteligente ? ' [IA]' : ''));
          signal.strategy = name;
          if (this.iaInteligente) {
            signal.iaDriven = true;
            signal.iaTarget = this.iaState.activeTarget;
            signal.iaMultiplier = this.iaState.activeMultiplier;
          }
          const lastResult = this.history[0];
          if (lastResult && lastResult.resultKey) {
            signal.lastCheckedResultKey = lastResult.resultKey;
          }
          this.currentSignal = signal;
          EventBus.emit('signal:created', { ...signal, robotId: this.id });
        break;
      }
    }

    if (!signal) {
      this.diagnostic.status = 'IDLE';
      this.diagnostic.signalBlocked = true;
      this.diagnostic.blockReason = 'Nenhuma estrategia aprovada neste ciclo';
      this.signalFlow = {
        step1: 'Ciclo completo: ' + namesToTry.length + ' estrategia' + (namesToTry.length > 1 ? 's' : ''),
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
    this.usedPatterns = { RED: [], BLACK: [], GREY: [], GREEN: [], BLUE: [] };
    this.strategyIndex = 0;
  }

  analyzeNumbers(history) {
    if (!history || history.length < 10) return null;
    const sample = history.slice(0, Math.min(history.length, 500));
    const maxNumber = this.game === 'double' ? 14 : 13;
    const freq = new Array(maxNumber + 1).fill(0);
    const recent = sample.slice(0, 50);
    const recentFreq = new Array(maxNumber + 1).fill(0);
    const colorNumbers = {};
    for (let i = 0; i < sample.length; i++) {
      const num = sample[i].number;
      if (num !== undefined && num !== null && num >= 0 && num <= maxNumber) {
        freq[num]++;
      }
      if (i < recent.length && num !== undefined && num !== null && num >= 0 && num <= maxNumber) {
        recentFreq[num]++;
      }
      const color = String(sample[i].color || '').toUpperCase();
      if (!colorNumbers[color]) colorNumbers[color] = [];
      if (num !== undefined && num !== null) colorNumbers[color].push(num);
    }
    const total = sample.length;
    const expected = total / (maxNumber + 1);
    let chiSquare = 0;
    for (let i = 0; i <= maxNumber; i++) {
      const diff = freq[i] - expected;
      chiSquare += (diff * diff) / expected;
    }
    const chiThreshold = maxNumber * 1.5;
    const isChaotic = chiSquare > chiThreshold;
    const lowHalf = this.game === 'double' ? [1, 2, 3, 4, 5, 6, 7] : [0, 1, 2, 3, 4, 5, 6];
    const highHalf = this.game === 'double' ? [8, 9, 10, 11, 12, 13, 14] : [7, 8, 9, 10, 11, 12, 13];
    let lowCount = 0, highCount = 0;
    for (const n of lowHalf) lowCount += freq[n];
    for (const n of highHalf) highCount += freq[n];
    const lowPct = total > 0 ? Math.round(lowCount / total * 100) : 50;
    const highPct = total > 0 ? Math.round(highCount / total * 100) : 50;
    const zeros = freq[0] || 0;
    const greenNums = this.game === 'double' ? [0] : [0];
    const greenCount = greenNums.reduce((s, n) => s + freq[n], 0);
    const greenPct = total > 0 ? Math.round(greenCount / total * 100) : 0;
    let hotNumbers = [];
    for (let i = 0; i <= maxNumber; i++) {
      const deviation = expected > 0 ? ((recentFreq[i] / 50) - (freq[i] / total)) / (freq[i] / total || 1) : 0;
      if (deviation > 0.3 && recentFreq[i] >= 3) hotNumbers.push({ number: i, recent: recentFreq[i], overall: freq[i], trend: 'hot' });
    }
    hotNumbers.sort((a, b) => b.recent - a.recent);
    hotNumbers = hotNumbers.slice(0, 5);
    const colorAvgNumbers = {};
    for (const [color, nums] of Object.entries(colorNumbers)) {
      if (nums.length < 5) continue;
      const avg = nums.reduce((s, n) => s + n, 0) / nums.length;
      colorAvgNumbers[color] = Math.round(avg * 10) / 10;
    }
    const recentColors = sample.slice(0, 10).map(h => String(h.color || '').toUpperCase());
    const lastColor = recentColors[0] || '';
    const sameColorCount = recentColors.filter(c => c === lastColor).length;
    const streakDetected = sameColorCount >= 4;
    const consecutiveNumbers = [];
    for (let i = 0; i < Math.min(recent.length - 2, 10); i++) {
      const n1 = recent[i]?.number;
      const n2 = recent[i + 1]?.number;
      const n3 = recent[i + 2]?.number;
      if (n1 !== undefined && n2 !== undefined && n3 !== undefined) {
        if (n2 - n1 === n3 - n2 && Math.abs(n2 - n1) <= 3) {
          consecutiveNumbers.push({ start: n1, step: n2 - n1, length: 3 });
        }
      }
    }
    const score = Math.round(
      (100 - Math.min(chiSquare / chiThreshold * 100, 50)) * 0.3 +
      (streakDetected ? 20 : 0) * 0.2 +
      (hotNumbers.length > 0 ? 30 : 0) * 0.2 +
      (greenPct > 5 ? 25 : 10) * 0.15 +
      (Math.abs(lowPct - highPct) > 15 ? 20 : 10) * 0.15
    );
    return {
      totalNumbers: total,
      distribution: freq.map((count, num) => ({ num, count, pct: total > 0 ? Math.round(count / total * 100) : 0 })),
      lowHigh: { low: lowPct, high: highPct },
      greenFrequency: greenPct,
      chiSquare: Math.round(chiSquare),
      isChaotic,
      hotNumbers,
      colorAvgNumbers,
      streakDetected,
      streakInfo: streakDetected ? { color: lastColor, count: sameColorCount } : null,
      consecutiveNumbers: consecutiveNumbers.slice(0, 3),
      score
    };
  }

  analyzeTargetColor(targetColor) {
    const color = String(targetColor || '').toUpperCase();
    const history = this.history;
    if (!history || history.length < 10) return null;
    const sample = history.slice(0, Math.min(history.length, 500));
    const maxNumber = this.game === 'double' ? 14 : 13;

    const colorMap = this.game === 'double'
      ? { RED: [1,2,3,4,5,6,7], BLACK: [8,9,10,11,12,13,14], GREEN: [0] }
      : { RED: [1,3,5,7,9,11,13], BLACK: [2,4,6,8,10,12], GREY: [0], BLUE: [10,11,12,13], GREEN: [0] };
    const numbersOnColor = colorMap[color] || [];

    let totalCount = sample.length;
    let colorCount = 0;
    let lastColorIndex = -1;
    const colorIndices = [];
    const numberFreq = {};
    numbersOnColor.forEach(n => numberFreq[n] = 0);

    for (let i = 0; i < sample.length; i++) {
      const c = String(sample[i].color || '').toUpperCase();
      if (c === color || (color === 'BLACK' && c === 'GREY')) {
        colorCount++;
        colorIndices.push(i);
        if (lastColorIndex === -1) lastColorIndex = i;
        const num = sample[i].number;
        if (num !== undefined && num !== null && numberFreq[num] !== undefined) {
          numberFreq[num]++;
        }
      }
    }

    const frequency = totalCount > 0 ? Math.round(colorCount / totalCount * 100) : 0;
    const expectedFreq = numbersOnColor.length / (maxNumber + 1) * 100;
    const lastOccurrence = lastColorIndex >= 0 ? lastColorIndex : totalCount;

    let avgGap = 0;
    if (colorIndices.length >= 2) {
      let gapSum = 0;
      for (let i = 1; i < colorIndices.length; i++) {
        gapSum += colorIndices[i] - colorIndices[i - 1];
      }
      avgGap = Math.round((gapSum / (colorIndices.length - 1)) * 10) / 10;
    }

    const recentWindow = sample.slice(0, 30);
    let recentColorCount = 0;
    for (const r of recentWindow) {
      const c = String(r.color || '').toUpperCase();
      if (c === color || (color === 'BLACK' && c === 'GREY')) recentColorCount++;
    }
    const recentFreq = Math.round(recentColorCount / recentWindow.length * 100);
    const trendDiff = recentFreq - frequency;
    let trend = 'stable';
    if (trendDiff > 8) trend = 'hot';
    else if (trendDiff < -8) trend = 'cold';

    const hotNumbers = [];
    const totalOnColor = Object.values(numberFreq).reduce((s, v) => s + v, 0);
    for (const [num, count] of Object.entries(numberFreq)) {
      if (count > 0) {
        const numPct = totalOnColor > 0 ? Math.round(count / totalOnColor * 100) : 0;
        const expectedPct = numbersOnColor.length > 0 ? Math.round(100 / numbersOnColor.length) : 0;
        if (numPct > expectedPct + 5) {
          hotNumbers.push({ number: parseInt(num), count, pct: numPct, trend: 'hot' });
        }
      }
    }
    hotNumbers.sort((a, b) => b.count - a.count);

    let streakCount = 0;
    let streakColor = '';
    for (let i = 0; i < Math.min(sample.length, 20); i++) {
      const c = String(sample[i].color || '').toUpperCase();
      if (i === 0) { streakColor = c; streakCount = 1; }
      else if (c === streakColor) streakCount++;
      else break;
    }
    const streakDetected = streakCount >= 3 && streakColor === color;

    let reverseScore = 0;
    if (lastOccurrence <= 2 && recentFreq > frequency + 5) {
      reverseScore = Math.min(30, 10 + (lastOccurrence * 5) + Math.round(trendDiff));
    } else if (lastOccurrence >= avgGap * 2 && avgGap > 0) {
      reverseScore = Math.min(25, Math.round((lastOccurrence / avgGap) * 8));
    }

    let patternScore = Math.round(
      (frequency > expectedFreq ? 15 : 0) +
      (trend === 'hot' ? 20 : trend === 'cold' ? -10 : 0) +
      (hotNumbers.length > 0 ? 15 : 0) +
      (streakDetected ? 10 : 0) +
      reverseScore +
      (lastOccurrence <= avgGap ? 10 : 0)
    );
    patternScore = Math.max(0, Math.min(100, 50 + patternScore));

    let suggestedEntry = null;
    let entryConfidence = 0;
    if (trend === 'hot' && recentFreq > expectedFreq + 10) {
      suggestedEntry = color;
      entryConfidence = Math.min(85, 60 + Math.round(trendDiff));
    } else if (streakDetected) {
      const others = Object.keys(colorMap).filter(c => c !== color);
      suggestedEntry = others.length ? others[0] : 'RED';
      entryConfidence = Math.min(80, 55 + streakCount * 3);
    } else if (reverseScore > 15) {
      suggestedEntry = color;
      entryConfidence = Math.min(75, 50 + Math.round(reverseScore));
    } else if (trend === 'cold' && lastOccurrence > avgGap * 1.5) {
      suggestedEntry = color;
      entryConfidence = Math.min(70, 45 + Math.round(lastOccurrence - avgGap) * 3);
    }

    const sortedNumberFreq = Object.entries(numberFreq)
      .map(([num, count]) => ({ num: parseInt(num), count, pct: totalOnColor > 0 ? Math.round(count / totalOnColor * 100) : 0 }))
      .sort((a, b) => b.count - a.count);

    return {
      color,
      frequency,
      expectedFrequency: Math.round(expectedFreq),
      colorCount,
      totalCount,
      lastOccurrence,
      currentGap: lastOccurrence,
      avgGap,
      recentFrequency: recentFreq,
      trend,
      trendDiff: Math.round(trendDiff),
      numbersOnColor,
      numberFreq: sortedNumberFreq,
      hotNumbers: hotNumbers.slice(0, 5),
      totalNumbersOnColor: totalOnColor,
      streakDetected,
      streakInfo: streakDetected ? { color: streakColor, count: streakCount } : null,
      reverseScore,
      patternScore,
      suggestedEntry,
      entryConfidence
    };
  }

  analyzeScoreboard() {
    const stats = this.stats || {};
    const signalHistory = this.signalHistory || [];
    const history = this.history || [];
    const totalSignals = stats.signals || 0;
    const wins = stats.wins || 0;
    const losses = stats.losses || 0;
    const totalDecided = wins + losses;
    const overallWinRate = totalDecided > 0 ? Math.round((wins / totalDecided) * 100) : 0;
    const currentStreak = stats.currentStreak || 0;
    const maxWinStreak = stats.maxWinStreak || 0;
    const maxLossStreak = stats.maxLossStreak || 0;
    const winSG = stats.winSG || 0;
    const winG1 = stats.winG1 || 0;
    const winG2 = stats.winG2 || 0;
    const galeEfficiency = totalDecided > 0 ? Math.round((winSG / totalDecided) * 100) : 0;

    const sb = (typeof IAConfig !== 'undefined' && IAConfig.scoreboard) ? IAConfig.scoreboard : {};

    const recentWindow = 20;
    const recentSignals = signalHistory.slice(-recentWindow);
    const recentWins = recentSignals.filter(s => s.type === 'win').length;
    const recentTotal = recentSignals.length;
    const recentWinRate = recentTotal > 0 ? Math.round((recentWins / recentTotal) * 100) : 0;

    const last30 = signalHistory.slice(-30);
    const last30Wins = last30.filter(s => s.type === 'win').length;
    const last30Rate = last30.length > 0 ? Math.round((last30Wins / last30.length) * 100) : 0;

    const last10 = signalHistory.slice(-10);
    const last10Wins = last10.filter(s => s.type === 'win').length;
    const last10Rate = last10.length > 0 ? Math.round((last10Wins / last10.length) * 100) : 0;

    const trend = recentWinRate > overallWinRate + 5 ? 'improving'
      : recentWinRate < overallWinRate - 5 ? 'declining'
      : 'stable';

    const losingStreakThreshold = sb.losingStreakPause || 3;
    const winningStreakThreshold = sb.winningStreakThreshold || 3;
    const isLosingStreak = currentStreak <= -losingStreakThreshold;
    const isWinningStreak = currentStreak >= winningStreakThreshold;
    const recentLossStreak = recentSignals.reduce((max, s) => {
      if (s.type === 'loss') return max + 1;
      return 0;
    }, 0);
    const worstRecentLossStreak = recentSignals.reduce((acc, s) => {
      if (s.type === 'loss') { acc.current++; acc.worst = Math.max(acc.worst, acc.current); }
      else acc.current = 0;
      return acc;
    }, { current: 0, worst: 0 }).worst;

    const perColor = {};
    for (const sh of signalHistory) {
      const c = sh.target;
      if (!perColor[c]) perColor[c] = { wins: 0, losses: 0 };
      if (sh.type === 'win') perColor[c].wins++;
      else perColor[c].losses++;
    }
    for (const c of Object.keys(perColor)) {
      const p = perColor[c];
      p.winRate = (p.wins + p.losses) > 0 ? Math.round((p.wins / (p.wins + p.losses)) * 100) : 0;
    }

    let decision = 'act';
    let decisionReason = 'Placar saudavel';
    let galeAdjustment = 0;
    let confidenceAdjustment = 0;
    let pauseMinutes = 0;

    if (isLosingStreak && Math.abs(currentStreak) >= losingStreakThreshold) {
      decision = 'pause';
      decisionReason = 'Sequencia de ' + Math.abs(currentStreak) + ' losses - pausa recomendada';
      pauseMinutes = sb.losingStreakPauseMinutes || 15;
    } else if (worstRecentLossStreak >= (sb.recentLossStreakPause || 4)) {
      decision = 'pause';
      decisionReason = 'Loss streak de ' + worstRecentLossStreak + ' nos ultimos sinais';
      pauseMinutes = sb.recentLossStreakPauseMinutes || 10;
    } else if (recentWinRate < (sb.lowWinRateThreshold || 30) && recentTotal >= (sb.lowWinRateMinSignals || 5)) {
      decision = 'caution';
      decisionReason = 'Win rate recente baixo (' + recentWinRate + '%) - reduzir gale';
      galeAdjustment = sb.lowWinRateGaleAdj || -1;
      confidenceAdjustment = sb.lowWinRateConfidenceAdj || 10;
    } else if (isWinningStreak && currentStreak >= winningStreakThreshold) {
      decision = 'act';
      decisionReason = 'Sequencia de ' + currentStreak + ' wins - momento favoravel';
      galeAdjustment = sb.winningStreakGaleAdj || 1;
      confidenceAdjustment = sb.winningStreakConfidenceAdj || -5;
    } else if (trend === 'declining' && last10Rate < (sb.decliningTrendWinRateThreshold || 40)) {
      decision = 'caution';
      decisionReason = 'Tendencia descendente - WIN rate ' + last10Rate + '% nos ultimos 10';
      confidenceAdjustment = sb.decliningTrendConfidenceAdj || 8;
    } else if (galeEfficiency < (sb.lowGaleEfficiencyThreshold || 30) && totalDecided >= (sb.lowGaleEfficiencyMinSignals || 10)) {
      decision = 'caution';
      decisionReason = 'Eficiencia gale baixa (' + galeEfficiency + '%) - apostar sem gale';
      galeAdjustment = sb.lowGaleEfficiencyGaleAdj || -1;
    } else if (recentWinRate >= (sb.improvingTrendWinRateThreshold || 60) && trend === 'improving') {
      decision = 'act';
      decisionReason = 'Performance melhorando (' + recentWinRate + '%) - aumentar exposicao';
      galeAdjustment = sb.improvingTrendGaleAdj || 1;
    }

    return {
      overallWinRate,
      recentWinRate,
      last30Rate,
      last10Rate,
      totalSignals,
      wins,
      losses,
      currentStreak,
      maxWinStreak,
      maxLossStreak,
      winSG,
      winG1,
      winG2,
      galeEfficiency,
      trend,
      worstRecentLossStreak,
      isLosingStreak,
      isWinningStreak,
      perColor,
      decision,
      decisionReason,
      galeAdjustment,
      confidenceAdjustment,
      pauseMinutes
    };
  }

  analyzeIntelligentStrategy() {
    if (!this.iaInteligente) return;
    const strategies = RobotEngine.strategies;
    if (!strategies || Object.keys(strategies).length === 0) return;
    const history = this.history;
    const minHistory = (typeof IAConfig !== 'undefined') ? IAConfig.settings.minHistoryRequired : 50;
    if (history.length < minHistory) return;

    const scoreboard = this.analyzeScoreboard();
    this.iaState.scoreboard = scoreboard;

    const game = this.game;
    const colorTargets = game === 'wheel'
      ? [{ color: 'GREY', mult: 2 }, { color: 'RED', mult: 3 }, { color: 'BLUE', mult: 5 }, { color: 'GREEN', mult: 50 }]
      : [{ color: 'RED', mult: 2 }, { color: 'BLACK', mult: 2 }, { color: 'GREEN', mult: 14 }];
    const windowSize = (typeof IAConfig !== 'undefined') ? IAConfig.settings.windowSize : 30;
    const evals = [];
    for (const [name, fn] of Object.entries(strategies)) {
      if (name === 'iaInteligente') continue;
      const sc = (this.strategyConfig || {})[name] || {};
      if (sc.enabled === false) continue;
      const defaultPS = { alternancia: 5, repeticao: 5, frequencia: 1, tendencia: 5, espelhamento: 5, diagonal: 6, padroesCores: 3 };
      const ps = sc.patternSize || defaultPS[name] || 3;
      for (const t of colorTargets) {
        try {
          const result = fn(history.slice(0, this.effectiveResults), { color: t.color, multiplier: t.mult }, ps);
          if (!result || !result.matched) continue;
          const confidence = result.confidence || 0;
          const confluences = result.confluences || 0;
          let winsInWindow = 0;
          let totalInWindow = 0;
          const wSize = Math.min(this.signalHistory.length, windowSize);
          for (let i = 0; i < wSize; i++) {
            const sh = this.signalHistory[this.signalHistory.length - 1 - i];
            if (!sh) continue;
            if (sh.target === t.color || (sh.target || '').includes(t.color)) {
              totalInWindow++;
              if (sh.type === 'win') winsInWindow++;
            }
          }
          const winRate = totalInWindow > 0 ? winsInWindow / totalInWindow : 0.5;
          let score;
          if (typeof IAConfig !== 'undefined') {
            score = IAConfig.evaluateScore({
              confidence,
              confluences,
              winRate: Math.round(winRate * 100),
              matched: result.matched,
              multiplier: t.mult,
              penalty: 0,
              winStreak: this.stats?.currentStreak || 0
            });
          } else {
            const recentWeight = Math.max(0.3, 1 - (this.signalHistory.length > 0 ? Math.min(20, this.signalHistory.length) * 0.03 : 0));
            score = Math.round(
              confidence * 0.35 +
              confluences * 8 * 0.20 +
              winRate * 100 * 0.30 +
              (result.matched ? 15 : 0) * recentWeight * 0.15
            );
          }
          let evaluation = {
            strategy: name,
            targetColor: t.color,
            multiplier: t.mult,
            confidence,
            confluences,
            winRate: Math.round(winRate * 100),
            totalSignals: totalInWindow,
            score,
            multiplierScore: Math.round(score * (t.mult / 50)),
            reason: result.reason || '',
            matched: result.matched,
            penalty: 0,
            boost: 0,
            ignored: false,
            appliedRules: [],
            colorAnalysis: null
          };
          const colorAnalysis = this.analyzeTargetColor(t.color);
          if (colorAnalysis) {
            evaluation.colorAnalysis = colorAnalysis;
            const colorBoost = Math.round(
              (colorAnalysis.trend === 'hot' ? 8 : colorAnalysis.trend === 'cold' ? -5 : 0) +
              (colorAnalysis.hotNumbers.length > 0 ? 5 : 0) +
              (colorAnalysis.streakDetected ? 5 : 0) +
              (colorAnalysis.reverseScore > 15 ? 8 : 0) +
              (colorAnalysis.patternScore - 50) * 0.3
            );
            evaluation.score = Math.max(0, Math.min(100, evaluation.score + colorBoost));
            evaluation.multiplierScore = Math.round(evaluation.score * (t.mult / 50));
            if (colorAnalysis.suggestedEntry === t.color && colorAnalysis.entryConfidence > 60) {
              evaluation.boost += Math.round(colorAnalysis.entryConfidence * 0.1);
              evaluation.score = Math.min(100, evaluation.score + evaluation.boost);
              evaluation.multiplierScore = Math.round(evaluation.score * (t.mult / 50));
            }
          }
          if (typeof IAConfig !== 'undefined') {
            evaluation = IAConfig.applyRules(evaluation, this.getState());
            evaluation.multiplierScore = Math.round(evaluation.score * (t.mult / 50));
          }
          if (scoreboard) {
            let sbBoost = 0;
            if (scoreboard.decision === 'pause') {
              sbBoost -= (sb.pauseScorePenalty || 20);
            } else if (scoreboard.decision === 'caution') {
              sbBoost -= (sb.cautionScorePenalty || 10);
              sbBoost += scoreboard.confidenceAdjustment || 0;
            } else if (scoreboard.decision === 'act' && scoreboard.isWinningStreak) {
              sbBoost += (sb.actWinStreakBoost || 5);
            }
            if (scoreboard.perColor[t.color]) {
              const colorWR = scoreboard.perColor[t.color].winRate;
              if (colorWR >= (sb.goodColorWinRate || 60)) sbBoost += (sb.goodColorBoost || 5);
              else if (colorWR < (sb.badColorWinRate || 35)) sbBoost -= (sb.badColorPenalty || 5);
            }
            if (scoreboard.trend === 'improving') sbBoost += (sb.improvingTrendBoost || 3);
            else if (scoreboard.trend === 'declining') sbBoost -= (sb.decliningTrendPenalty || 3);
            evaluation.scoreboardBoost = sbBoost;
            evaluation.score = Math.max(0, Math.min(100, evaluation.score + sbBoost));
            evaluation.multiplierScore = Math.round(evaluation.score * (t.mult / 50));
          }
          if (!evaluation.ignored) {
            evals.push(evaluation);
          }
        } catch (e) { /* skip strategy error */ }
      }
    }
    if (typeof IAConfig !== 'undefined') {
      evals.sort((a, b) => b.multiplierScore - a.multiplierScore || b.score - a.score);
      const prioritized = IAConfig.runCustomPrioritize(evals);
      evals.length = 0;
      evals.push(...prioritized);
    } else {
      evals.sort((a, b) => b.multiplierScore - a.multiplierScore || b.score - a.score);
    }
    this.iaState.evaluations = evals.slice(0, (typeof IAConfig !== 'undefined' ? IAConfig.settings.maxEvaluations : 20));
    this.iaState.lastAnalysisTime = Date.now();
    const colorAnalyses = {};
    for (const ev of evals) {
      if (ev.colorAnalysis && !colorAnalyses[ev.targetColor]) {
        colorAnalyses[ev.targetColor] = ev.colorAnalysis;
      }
    }
    this.iaState.colorAnalyses = colorAnalyses;
    if (evals.length > 0) {
      const best = evals[0];
      this.iaState.activeStrategy = best.strategy;
      this.iaState.activeTarget = best.targetColor;
      this.iaState.activeConfidence = best.confidence;
      this.iaState.activeWinRate = best.winRate;
      this.iaState.activeMultiplier = best.multiplier;
      this.iaState.activeReason = best.reason;
      const logMsg = 'IA: Estrategia alterada para ' + best.strategy + ' -> ' + this.colorLabel(best.targetColor) + ' (' + best.multiplier + 'X) score:' + best.multiplierScore;
      this.addLog(logMsg);
      if (typeof IAConfig !== 'undefined') {
        IAConfig.addDecisionLog({
          robotId: this.id,
          robotName: this.name,
          strategy: best.strategy,
          target: this.colorLabel(best.targetColor),
          multiplier: best.multiplier,
          score: best.multiplierScore,
          confidence: best.confidence,
          winRate: best.winRate,
          appliedRules: best.appliedRules || [],
          reason: best.reason
        });
      }
    } else {
      this.iaState.activeStrategy = this.strategies?.[0] || this.strategy || '--';
      this.iaState.activeTarget = this.target?.color || 'any';
      this.iaState.activeMultiplier = this.target?.multiplier || '--';
      this.iaState.activeConfidence = 0;
      this.iaState.activeWinRate = 0;
      this.iaState.activeReason = 'Nenhum padrao detectado para esta combinacao';
      this.iaState.evaluations = [];
    }
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
    const isGreenProtection = this.greenProtection && this.game === 'double' && rColor === 'GREEN';
    const won = rColor === targetColor || isGreenProtection;
    if (won) {
      const resolvedGale = this.galeCount;
      signal.status = 'win';
      signal.gale = resolvedGale;
      signal.result = { color: rColor, number: normalized.number, multiplier: normalized.multiplier, time: Date.now() };
      this.stats.wins++;
      if (this.signalLimit?.enabled) this.signalLimitTotal.wins++;
      this.stats.currentStreak = Math.max(1, (this.stats.currentStreak || 0) + 1);
      this.stats.sequenceWins = Math.max(this.stats.sequenceWins || 0, this.stats.currentStreak - 1);
      if (resolvedGale === 0) this.stats.winSG = (this.stats.winSG || 0) + 1;
      if (resolvedGale === 1) this.stats.winG1 = (this.stats.winG1 || 0) + 1;
      if (resolvedGale === 2) this.stats.winG2 = (this.stats.winG2 || 0) + 1;
      this.stats.maxWinStreak = Math.max(this.stats.maxWinStreak || 0, this.stats.currentStreak);
      if (this.currentSignal === signal) this.currentSignal = null;
      this._lastResolvedTime = Date.now();
      this.galeCount = 0;
      this.resetUsedPatterns();
      this.diagnostic.status = 'RESOLVED';
      this.diagnostic.mainPattern = isGreenProtection ? 'WIN por Proteção Verde' : 'WIN confirmado no resultado seguinte';
      this.diagnostic.suggestedEntry = null;
      this.signalFlow = {
        step1: 'WIN: ' + this.colorLabel(targetColor),
        step2: 'Resultado: ' + this.colorLabel(rColor) + (isGreenProtection ? ' (Proteção Verde)' : ''),
        step3: 'Resolvido no G' + resolvedGale,
        step4: 'Placar atualizado'
      };
      this.addLog(isGreenProtection ? 'WIN por Proteção Verde! GREEN = ' + targetColor : 'WIN! ' + rColor + ' === ' + targetColor);
      EventBus.emit('signal:win', { ...signal, robotId: this.id });
      EventBus.emit('signal:resolved', { ...signal, robotId: this.id, type: 'win' });
      this.signalHistory.push({ type: 'win', target: targetColor, result: rColor, gale: resolvedGale, time: Date.now(), greenProtection: isGreenProtection });
      if (this.signalHistory.length > 100) this.signalHistory.shift();
      if (this.signalLimit?.enabled) this.signalLimitTotal.wins++;
      this.stats.currentStreak = Math.max(1, (this.stats.currentStreak || 0) + 1);
      this.stats.sequenceWins = Math.max(this.stats.sequenceWins || 0, this.stats.currentStreak - 1);
      if (resolvedGale === 0) this.stats.winSG = (this.stats.winSG || 0) + 1;
      if (resolvedGale === 1) this.stats.winG1 = (this.stats.winG1 || 0) + 1;
      if (resolvedGale === 2) this.stats.winG2 = (this.stats.winG2 || 0) + 1;
      this.stats.maxWinStreak = Math.max(this.stats.maxWinStreak || 0, this.stats.currentStreak);
      if (typeof IAConfig !== 'undefined') {
        IAConfig.runOnWin({ strategy: this.strategy, target: targetColor, gale: resolvedGale, confidence: signal.confidence || 0 });
      }
      if (this.iaInteligente) this.analyzeIntelligentStrategy();
    } else {
      this.galeCount++;
      const maxGale = this.getGaleMaxForTarget(targetColor);
      if (this.galeCount <= maxGale) {
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
          step4: 'Gale: ' + this.galeCount + '/' + maxGale
        };
        this.addLog('LOSS - Gale ' + this.galeCount + '/' + maxGale);
        EventBus.emit('signal:gale', { ...signal, robotId: this.id });
      } else {
        signal.status = 'loss';
        signal.gale = maxGale;
        signal.result = { color: rColor, number: normalized.number, multiplier: normalized.multiplier, time: Date.now() };
        this.stats.losses++;
        if (this.signalLimit?.enabled) this.signalLimitTotal.losses++;
        this.stats.currentStreak = Math.min(-1, (this.stats.currentStreak || 0) - 1);
        this.stats.sequenceLosses = Math.max(this.stats.sequenceLosses || 0, Math.abs(this.stats.currentStreak) - 1);
        this.stats.maxLossStreak = Math.max(this.stats.maxLossStreak || 0, Math.abs(this.stats.currentStreak));
        if (this.currentSignal === signal) this.currentSignal = null;
        this._lastResolvedTime = Date.now();
        this.galeCount = 0;
        this.resetUsedPatterns();
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
        EventBus.emit('signal:resolved', { ...signal, robotId: this.id, type: 'loss' });
        this.signalHistory.push({ type: 'loss', target: targetColor, result: rColor, gale: maxGale, time: Date.now() });
        if (this.signalHistory.length > 100) this.signalHistory.shift();
        if (typeof IAConfig !== 'undefined') {
          IAConfig.runOnLoss({ strategy: this.strategy, target: targetColor, gale: maxGale, confidence: signal.confidence || 0 });
        }
        if (this.iaInteligente) this.analyzeIntelligentStrategy();
        if (this.autoPause > 0 && Math.abs(this.stats.currentStreak) >= this.autoPause) {
          this.status = 'offline';
          this.addLog('AUTO-PAUSE: ' + Math.abs(this.stats.currentStreak) + ' losses seguidos');
          EventBus.emit('robot:state', this.getState());
        }
      }
    }
  }

  analyzeLossPatterns() {
    const losses = this.signalHistory.filter(h => h.type === 'loss');
    if (losses.length < 2) return [];
    const CONTEXT_SIZE = 10;
    const lossSignatures = [];
    for (const loss of losses) {
      const lossTime = loss.time;
      const contextColors = [];
      for (let i = this.history.length - 1; i >= 0 && contextColors.length < CONTEXT_SIZE; i--) {
        const entry = this.history[i];
        const entryTime = entry.timestamp || entry.time || 0;
        if (entryTime >= lossTime) continue;
        const color = this.normalizeColor(entry.color || entry.cellColor || entry.result || '');
        if (color) contextColors.unshift(color);
      }
      if (contextColors.length < 3) continue;
      const targetNorm = this.normalizeColor(loss.target);
      const resultNorm = this.normalizeColor(loss.result);
      const consecutiveTarget = this.countConsecutive(contextColors, targetNorm, 'end');
      const consecutiveOpposite = this.countConsecutive(contextColors, resultNorm, 'end');
      const targetFreq = contextColors.filter(c => c === targetNorm).length;
      const oppositeFreq = contextColors.filter(c => c === resultNorm).length;
      const streakBefore = this.computeStreakBefore(contextColors, targetNorm);
      lossSignatures.push({
        target: targetNorm,
        result: resultNorm,
        context: contextColors,
        consecutiveTarget,
        consecutiveOpposite,
        targetFreq,
        oppositeFreq,
        streakBefore,
        galeUsed: loss.gale || 0,
        time: lossTime
      });
    }
    const grouped = {};
    for (const sig of lossSignatures) {
      const key = sig.target + ':' + sig.result;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(sig);
    }
    const patterns = [];
    for (const key of Object.keys(grouped)) {
      const sigs = grouped[key];
      if (sigs.length < 2) continue;
      const [target, result] = key.split(':');
      const avgConsecutiveTarget = sigs.reduce((s, x) => s + x.consecutiveTarget, 0) / sigs.length;
      const avgConsecutiveOpposite = sigs.reduce((s, x) => s + x.consecutiveOpposite, 0) / sigs.length;
      const avgTargetFreq = sigs.reduce((s, x) => s + x.targetFreq, 0) / sigs.length;
      const avgOppositeFreq = sigs.reduce((s, x) => s + x.oppositeFreq, 0) / sigs.length;
      const commonSeq = this.findCommonSequence(sigs.map(s => s.context));
      patterns.push({
        target,
        result,
        count: sigs.length,
        avgConsecutiveTarget: Math.round(avgConsecutiveTarget * 10) / 10,
        avgConsecutiveOpposite: Math.round(avgConsecutiveOpposite * 10) / 10,
        avgTargetFreq: Math.round(avgTargetFreq * 10) / 10,
        avgOppositeFreq: Math.round(avgOppositeFreq * 10) / 10,
        commonSequence: commonSeq,
        dangerScore: Math.min(95, 40 + sigs.length * 8)
      });
    }
    patterns.sort((a, b) => b.dangerScore - a.dangerScore);
    return patterns;
  }

  countConsecutive(arr, color, direction) {
    let count = 0;
    if (direction === 'end') {
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i] === color) count++;
        else break;
      }
    } else {
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] === color) count++;
        else break;
      }
    }
    return count;
  }

  computeStreakBefore(context, target) {
    let streak = 0;
    for (let i = context.length - 1; i >= 0; i--) {
      if (context[i] === target) streak++;
      else break;
    }
    return streak > 0 ? streak : -(this.countConsecutive(context, context[context.length - 1] === target ? this.getOppositeColor(target) : context[context.length - 1], 'end'));
  }

  getOppositeColor(color) {
    if (color === 'RED') return 'BLACK';
    if (color === 'BLACK') return 'RED';
    return color;
  }

  findCommonSequence(contexts) {
    if (contexts.length === 0) return '';
    const shortest = contexts.reduce((a, b) => a.length < b.length ? a : b);
    const maxSize = Math.min(6, shortest.length);
    for (let size = maxSize; size >= 3; size--) {
      const ngrams = {};
      for (const ctx of contexts) {
        for (let i = 0; i <= ctx.length - size; i++) {
          const ngram = ctx.slice(i, i + size).join('-');
          ngrams[ngram] = (ngrams[ngram] || 0) + 1;
        }
      }
      const best = Object.entries(ngrams).sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] >= Math.ceil(contexts.length * 0.6)) return best[0];
    }
    return shortest.slice(-4).join('-');
  }

  matchesLossPattern(target) {
    const patterns = this.analyzeLossPatterns();
    if (patterns.length === 0) return { match: false, score: 0, details: null };
    const targetNorm = this.normalizeColor(target);
    const currentContext = this.history.slice(0, 10).map(h => this.normalizeColor(h.color || h.cellColor || h.result || '')).filter(Boolean);
    if (currentContext.length < 3) return { match: false, score: 0, details: null };
    let bestMatch = null;
    let bestScore = 0;
    for (const pattern of patterns) {
      if (pattern.target !== targetNorm) continue;
      let score = 0;
      const seqSim = this.sequenceSimilarity(currentContext, pattern.commonSequence.split('-'));
      score += seqSim * 0.4;
      score += (pattern.count >= 3 ? 0.25 : pattern.count >= 2 ? 0.15 : 0.05);
      const currentStreak = this.countConsecutive(currentContext, targetNorm, 'end');
      const streakSim = 1 - Math.min(1, Math.abs(currentStreak - pattern.avgConsecutiveTarget) / 5);
      score += streakSim * 0.2;
      const currentTargetFreq = currentContext.filter(c => c === targetNorm).length / currentContext.length;
      const avgFreqRatio = pattern.avgTargetFreq / 10;
      const freqSim = 1 - Math.min(1, Math.abs(currentTargetFreq - avgFreqRatio) / 0.5);
      score += freqSim * 0.15;
      score += (pattern.dangerScore / 100) * 0.05;
      score = Math.round(Math.min(99, Math.max(0, score * 100)));
      if (score > bestScore) {
        bestScore = score;
        bestMatch = pattern;
      }
    }
    return { match: bestScore >= 60, score: bestScore, details: bestMatch };
  }

  sequenceSimilarity(current, pattern) {
    if (!pattern || pattern.length === 0) return 0;
    const currSlice = current.slice(-pattern.length);
    if (currSlice.length === 0) return 0;
    let matches = 0;
    const len = Math.min(currSlice.length, pattern.length);
    for (let i = 0; i < len; i++) {
      const currIdx = currSlice.length - len + i;
      if (currSlice[currIdx] === pattern[i]) matches++;
    }
    return matches / len;
  }

  addLog(message) {
    const entry = { time: Date.now(), message, id: this.id };
    this.logs.unshift(entry);
    if (this.logs.length > 500) this.logs.pop();
    EventBus.emit('robot:log', entry);
  }

  getState() {
    return { id: this.id, name: this.name, game: this.game, strategy: this.strategy, strategies: this.strategies, status: this.status, mode: this.mode, target: this.target, filterMode: this.filterMode, patternSize: this.patternSize, lastPatternAnalysisTime: this.lastPatternAnalysisTime, telegram: { ...this.telegram, message: { ...(this.telegram.message || {}) } }, lastHeartbeat: this.lastHeartbeat, stats: { ...this.stats }, lastResult: this.lastResult, lastSignal: this.lastSignal, currentSignal: this.currentSignal, diagnostic: { ...this.diagnostic }, signalFlow: { ...this.signalFlow }, logs: [...this.logs], history: [...this.history], signalHistory: [...this.signalHistory], minimumConfidence: this.minimumConfidence, minScore: this.minScore, intervalMin: this.intervalMin, gale: { ...this.gale }, resultsToAnalyze: this.resultsToAnalyze, confirmations: this.confirmations, strategyIndex: this.strategyIndex, usedPatterns: JSON.parse(JSON.stringify(this.usedPatterns)), startedAt: this.startedAt, strategyConfig: JSON.parse(JSON.stringify(this.strategyConfig || {})), greenProtection: this.greenProtection, filters: this.filters, galeByColor: { ...this.galeByColor }, confidenceByColor: { ...this.confidenceByColor }, autoPause: this.autoPause, startDelayUntil: this.startDelayUntil, iaInteligente: this.iaInteligente, iaState: { ...this.iaState, evaluations: (this.iaState.evaluations || []).slice(0, 10) } };
  }

  toJSON() {
    return { id: this.id, name: this.name, game: this.game, strategy: this.strategy, strategies: this.strategies, status: this.status, mode: this.mode, target: this.target, filterMode: this.filterMode, patternSize: this.patternSize, lastPatternAnalysisTime: this.lastPatternAnalysisTime, history: this.history.slice(0, 1000), resultsToAnalyze: this.resultsToAnalyze, minimumConfidence: this.minimumConfidence, minScore: this.minScore, confirmations: this.confirmations, intervalMin: this.intervalMin, galeMax: this.gale.max, telegram: { ...this.telegram, message: { ...(this.telegram.message || {}) } }, stats: this.stats, lastHeartbeat: this.lastHeartbeat, lastResult: this.lastResult, lastSignal: this.lastSignal, currentSignal: this.currentSignal, galeCount: this.galeCount, lastSignalTime: this.lastSignalTime, diagnostic: this.diagnostic, signalFlow: this.signalFlow, logs: this.logs, signalHistory: this.signalHistory, strategyIndex: this.strategyIndex, usedPatterns: this.usedPatterns, startedAt: this.startedAt, strategyConfig: this.strategyConfig || {}, greenProtection: this.greenProtection, filters: this.filters, galeByColor: this.galeByColor, confidenceByColor: this.confidenceByColor, autoPause: this.autoPause, startDelayUntil: this.startDelayUntil, iaInteligente: this.iaInteligente, iaState: this.iaState, signalLimit: this.signalLimit, signalLimitTotal: this.signalLimitTotal, _signalTimestamps: this._signalTimestamps, _signalLimitNotified: this._signalLimitNotified, _signalLimitWarningNotified: this._signalLimitWarningNotified, _signalLimitWarningCycleKey: this._signalLimitWarningCycleKey, _signalLimitReachedCycleKey: this._signalLimitReachedCycleKey };
  }
}
