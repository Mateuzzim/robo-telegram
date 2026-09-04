class Robot {
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.game = config.game;
    this.strategy = config.strategy;
    this.strategies = Array.isArray(config.strategies) ? config.strategies : [config.strategy || 'alternancia'];
    this.status = 'offline';
    this.mode = config.mode || 'monitoramento';
    this.resultsToAnalyze = config.resultsToAnalyze || 10;
    this.minimumConfidence = config.minimumConfidence || 80;
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
    this.usedPatterns = config.usedPatterns || { RED: [], BLACK: [], GREY: [] };
    this._lastResolvedTime = 0;
    this.greenProtection = config.greenProtection || false;
    this.filters = config.filters || [];
    this.galeByColor = config.galeByColor || { grey: 1, red: 3, blue: 5, green: 10 };
    this.autoPause = config.autoPause || 0;
  }

  getGaleMaxForTarget(targetColor) {
    if (this.target?.color === 'any' && this.game === 'wheel') {
      const normalizedTarget = String(targetColor || '').toLowerCase();
      const galeMap = { grey: this.galeByColor.grey, red: this.galeByColor.red, blue: this.galeByColor.blue, green: this.galeByColor.green };
      return galeMap[normalizedTarget] ?? this.gale.max;
    }
    return this.gale.max;
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
      if (this.history.length > 400) this.history.pop();
      this.addLog('Resultado: ' + (color || normalized.number));
      this.analyze();
    }
    return true;
  }

  analyze() {
    if (this.status !== 'online') {
      this.diagnostic.status = 'IDLE';
      this.diagnostic.mainPattern = 'Robo offline';
      this.diagnostic.confidence = 0;
      this.diagnostic.suggestedEntry = null;
      this.diagnostic.signalBlocked = true;
      this.diagnostic.blockReason = 'Robo offline';
      this.signalFlow = {
        step1: 'Robo offline',
        step2: 'Aguardando PLAY para iniciar',
        step3: '---',
        step4: '---'
      };
      EventBus.emit('robot:state', this.getState());
      return;
    }
    if (this.startDelayUntil && Date.now() < this.startDelayUntil) {
      this.diagnostic.status = 'LOADING';
      this.diagnostic.mainPattern = 'Aguardando delay inicial...';
      this.diagnostic.confidence = 0;
      this.diagnostic.suggestedEntry = null;
      this.diagnostic.signalBlocked = true;
      this.diagnostic.blockReason = 'Delay inicial de 10s';
      this.signalFlow = {
        step1: 'Robo iniciando...',
        step2: 'Enviando live...',
        step3: 'Aguardando 10s...',
        step4: 'Depois inicia analises'
      };
      EventBus.emit('robot:state', this.getState());
      return;
    }
    if (this._lastResolvedTime && Date.now() - this._lastResolvedTime < 2000) {
      this.diagnostic.status = 'WAITING_RESULT';
      EventBus.emit('robot:state', this.getState());
      return;
    }

    if (this.history.length < this.resultsToAnalyze) {
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

    const fixedTarget = this.getFixedTargetColor();
    if (fixedTarget) {
      this.diagnostic.suggestedEntry = fixedTarget;
    } else {
      const allowed = this.getAllowedTargets();
      if (allowed) this.diagnostic.suggestedEntry = allowed.join(' / ');
    }

    const strategies = RobotEngine.strategies;
    const strategyNames = Object.keys(strategies);
    const minConf = this.minimumConfidence || 65;

    const scores = {};
    let total = 0;
    let activeCount = 0;
    const strategyDetails = {};
    for (const [name, fn] of Object.entries(strategies)) {
      const sc = (this.strategyConfig || {})[name] || {};
      const defaultPS = { alternancia: 5, repeticao: 5, frequencia: 1, tendencia: 5, espelhamento: 5, diagonal: 6, padroesCores: 3 };
      const ps = sc.patternSize || defaultPS[name] || 3;
      const r = name === 'padroesCores' ? fn(this.history.slice(0, this.resultsToAnalyze), this.target, ps) : fn(this.history, this.target, ps);
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

    if (this.currentSignal) {
      const stratFn = strategies[this.strategy || 'todas'] || strategies[Object.keys(strategies)[0]];
      let stratResult = null;
      if (stratFn) {
        const sc2 = (this.strategyConfig || {})[this.strategy] || {};
        const defaultPS2 = { alternancia: 5, repeticao: 5, frequencia: 1, tendencia: 5, espelhamento: 5, diagonal: 6, padroesCores: 3 };
        const ps2 = sc2.patternSize || defaultPS2[this.strategy] || 3;
        stratResult = this.strategy === 'padroesCores'
          ? stratFn(this.history.slice(0, this.resultsToAnalyze), this.target, ps2)
          : stratFn(this.history, this.target, ps2);
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
    const isAll = this.strategy === 'todas';
    const robotStrategies = this.strategies || [this.strategy || 'todas'];
    const namesToTry = isAll ? strategyNames : robotStrategies.filter(s => s !== 'todas');

    let bestConfidence = 0;
    let bestPattern = null;
    let bestStrategy = null;

    for (const name of namesToTry) {
      if (!strategies[name]) continue;
      const sc = (this.strategyConfig || {})[name] || {};
      if (sc.enabled === false) continue;
      const fn = strategies[name];
      const result = name === 'padroesCores' ? fn(this.history.slice(0, this.resultsToAnalyze), this.target, this.patternSize) : fn(this.history, this.target);

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

      const effectiveMinConf = Math.max(minConf, sc.minConfidence || 0);

      if (!result.matched || result.confidence < effectiveMinConf) {
        this.signalFlow = {
          step1: (isAll ? 'Analisando: ' : 'Ciclo: ') + name,
          step2: 'Confianca: ' + (result.confidence || 0) + '% (min: ' + effectiveMinConf + '%)',
          step3: result.matched ? 'Confianca baixa - ' + (isAll ? 'proxima estrategia' : 'aguardando') : (result.reason || 'Nao detectado'),
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
      if (fixedTarget) {
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
        this.markPatternUsed(name, signal.target);
        this.addLog('SINAL APROVADO: ' + signal.target + ' (' + signal.confidence + '%) via ' + name);
        signal.strategy = name;
        EventBus.emit('signal:created', signal);
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
    this.usedPatterns = { RED: [], BLACK: [], GREY: [] };
    this.strategyIndex = 0;
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
      this.signalHistory.push({ type: 'win', target: targetColor, result: rColor, gale: resolvedGale, time: Date.now(), greenProtection: isGreenProtection });
      if (this.signalHistory.length > 100) this.signalHistory.shift();
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
        this.signalHistory.push({ type: 'loss', target: targetColor, result: rColor, gale: maxGale, time: Date.now() });
        if (this.signalHistory.length > 100) this.signalHistory.shift();
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
    return { id: this.id, name: this.name, game: this.game, strategy: this.strategy, strategies: this.strategies, status: this.status, mode: this.mode, target: this.target, filterMode: this.filterMode, patternSize: this.patternSize, lastPatternAnalysisTime: this.lastPatternAnalysisTime, telegram: { ...this.telegram, message: { ...(this.telegram.message || {}) } }, lastHeartbeat: this.lastHeartbeat, stats: { ...this.stats }, lastResult: this.lastResult, lastSignal: this.lastSignal, currentSignal: this.currentSignal, diagnostic: { ...this.diagnostic }, signalFlow: { ...this.signalFlow }, logs: [...this.logs], signalHistory: [...this.signalHistory], minimumConfidence: this.minimumConfidence, minScore: this.minScore, intervalMin: this.intervalMin, gale: { ...this.gale }, resultsToAnalyze: this.resultsToAnalyze, confirmations: this.confirmations, strategyIndex: this.strategyIndex, usedPatterns: JSON.parse(JSON.stringify(this.usedPatterns)), startedAt: this.startedAt, strategyConfig: JSON.parse(JSON.stringify(this.strategyConfig || {})), greenProtection: this.greenProtection, filters: this.filters, galeByColor: { ...this.galeByColor }, autoPause: this.autoPause, startDelayUntil: this.startDelayUntil };
  }

  toJSON() {
    return { id: this.id, name: this.name, game: this.game, strategy: this.strategy, strategies: this.strategies, status: this.status, mode: this.mode, target: this.target, filterMode: this.filterMode, patternSize: this.patternSize, lastPatternAnalysisTime: this.lastPatternAnalysisTime, history: this.history.slice(0, 400), resultsToAnalyze: this.resultsToAnalyze, minimumConfidence: this.minimumConfidence, minScore: this.minScore, confirmations: this.confirmations, intervalMin: this.intervalMin, galeMax: this.gale.max, telegram: { ...this.telegram, message: { ...(this.telegram.message || {}) } }, stats: this.stats, lastHeartbeat: this.lastHeartbeat, lastResult: this.lastResult, lastSignal: this.lastSignal, currentSignal: this.currentSignal, galeCount: this.galeCount, lastSignalTime: this.lastSignalTime, diagnostic: this.diagnostic, signalFlow: this.signalFlow, logs: this.logs, signalHistory: this.signalHistory, strategyIndex: this.strategyIndex, usedPatterns: this.usedPatterns, startedAt: this.startedAt, strategyConfig: this.strategyConfig || {}, greenProtection: this.greenProtection, filters: this.filters, galeByColor: this.galeByColor, autoPause: this.autoPause, startDelayUntil: this.startDelayUntil };
  }
}
