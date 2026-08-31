const RobotEngine = {
  robots: new Map(),

  strategies: {
    alternancia(history) {
      if (history.length < 10) return { matched: false, confidence: 0, reason: 'Historico insuficiente' };
      const colors = history.slice(0, 20).map(r => r.color);
      let changes = 0;
      for (let i = 0; i < colors.length - 1; i++) { if (colors[i] !== colors[i + 1]) changes++; }
      const score = Math.round((changes / (colors.length - 1)) * 100);
      const last = colors[0];
      const allColors = [...new Set(colors)];
      const others = allColors.filter(c => c !== last);
      const target = others.length ? others[0] : (last === 'RED' ? 'BLACK' : 'RED');
      return { matched: score >= 60, target, confidence: score, pattern: colors.slice(0, 5), reason: score >= 60 ? 'Alternancia identificada' : 'Alternancia fraca' };
    },
    repeticao(history) {
      if (history.length < 10) return { matched: false, confidence: 0, reason: 'Historico insuficiente' };
      const colors = history.slice(0, 30).map(r => r.color);
      const last = colors[0];
      let count = 0;
      for (const c of colors) { if (c === last) count++; else break; }
      const score = count >= 3 ? Math.min(90, 50 + count * 10) : 0;
      const colorLabels = { RED: 'VERMELHO', BLACK: 'PRETO', GREY: 'PRETO', BLUE: 'AZUL', GREEN: 'VERDE' };
      const others = Object.keys(colorLabels).filter(c => c !== last && c !== 'GREY' || (last !== 'BLACK' && last !== 'GREY'));
      const target = others.length ? others[0] : (last === 'RED' ? 'BLACK' : 'RED');
      return { matched: score >= 60, target, confidence: score, pattern: colors.slice(0, 5), reason: count >= 3 ? `Repeticao ${count}x ${colorLabels[last] || last}` : 'Sem repeticao' };
    },
    frequencia(history) {
      if (history.length < 20) return { matched: false, confidence: 0, reason: 'Historico insuficiente' };
      const colors = history.slice(0, 40).map(r => r.color);
      const freq = {};
      colors.forEach(c => { freq[c] = (freq[c] || 0) + 1; });
      const total = colors.length;
      const sorted = Object.entries(freq).sort((a, b) => a[1] - b[1]);
      const rare = sorted[0];
      const most = sorted[sorted.length - 1];
      const score = rare ? Math.round(((total - rare[1]) / total) * 100) : 0;
      const colorLabels = { RED: 'VERMELHO', BLACK: 'PRETO', GREY: 'PRETO', BLUE: 'AZUL', GREEN: 'VERDE' };
      const freqStr = Object.entries(freq).map(([c, n]) => `${colorLabels[c] || c}:${n}`).join(' | ');
      return { matched: score >= 65, target: rare ? rare[0] : 'RED', confidence: score, pattern: [freqStr], reason: score >= 65 ? `${colorLabels[rare[0]] || rare[0]} atrasado (${rare[1]}x de ${total})` : 'Frequencia equilibrada' };
    },
    tendencia(history) {
      if (history.length < 15) return { matched: false, confidence: 0, reason: 'Historico insuficiente' };
      const colors = history.slice(0, 20).map(r => r.color);
      let streak = 1;
      for (let i = 1; i < colors.length; i++) { if (colors[i] === colors[0]) streak++; else break; }
      const score = streak >= 3 ? Math.min(85, 40 + streak * 12) : 0;
      const colorLabels = { RED: 'VERMELHO', BLACK: 'PRETO', GREY: 'PRETO', BLUE: 'AZUL', GREEN: 'VERDE' };
      const allColors = [...new Set(colors)];
      const others = allColors.filter(c => c !== colors[0]);
      const target = others.length ? others[0] : (colors[0] === 'RED' ? 'BLACK' : 'RED');
      return { matched: score >= 60, target, confidence: score, pattern: colors.slice(0, 5), reason: streak >= 3 ? `Tendencia ${colorLabels[colors[0]] || colors[0]} x${streak}` : 'Sem tendencia' };
    },
    espelhamento(history) {
      if (history.length < 20) return { matched: false, confidence: 0, reason: 'Historico insuficiente' };
      const colors = history.slice(0, 40).map(r => r.color);
      const half = Math.floor(colors.length / 2);
      const first = colors.slice(0, half), second = colors.slice(half, half * 2);
      let m = 0;
      const len = Math.min(first.length, second.length);
      for (let i = 0; i < len; i++) { if (first[i] === second[i]) m++; }
      const score = Math.round((m / len) * 100);
      const allColors = [...new Set(colors)];
      const others = allColors.filter(c => c !== colors[0]);
      const target = others.length ? others[0] : (colors[0] === 'RED' ? 'BLACK' : 'RED');
      return { matched: score >= 55, target, confidence: score, pattern: first.slice(0, 5), reason: score >= 55 ? 'Espelhamento detectado' : 'Sem espelhamento' };
    },
    diagonal(history) {
      if (history.length < 15) return { matched: false, confidence: 0, reason: 'Historico insuficiente' };
      const colors = history.slice(0, 30).map(r => r.color);
      let d = 0;
      for (let i = 0; i < Math.min(10, colors.length - 2); i++) {
        if (colors[i] !== colors[i + 1] && colors[i + 1] !== colors[i + 2]) d++;
      }
      const score = Math.round((d / 8) * 100);
      const allColors = [...new Set(colors)];
      const others = allColors.filter(c => c !== colors[0]);
      const target = others.length ? others[0] : (colors[0] === 'RED' ? 'BLACK' : 'RED');
      return { matched: score >= 60, target, confidence: Math.min(score, 95), pattern: colors.slice(0, 6), reason: score >= 60 ? 'Diagonal detectada' : 'Sem diagonal' };
    }
  },

  evaluate(robot, strategyResult) {
    const normalizeColor = color => typeof robot.normalizeColor === 'function' ? robot.normalizeColor(color) : String(color || '').toUpperCase();
    const targetColor = normalizeColor(robot.target?.color || 'any');
    if (targetColor !== 'ANY' && targetColor !== 'ALL') {
      strategyResult.target = targetColor;
    } else if (strategyResult.target) {
      strategyResult.target = normalizeColor(strategyResult.target);
    }

    if (!strategyResult.matched) {
      robot.diagnostic.status = 'IDLE';
      robot.diagnostic.decision = { approved: false, reason: strategyResult.reason };
      robot.diagnostic.signalBlocked = true;
      robot.diagnostic.blockReason = strategyResult.reason;
      robot.signalFlow = { step1: 'Padrao identificado: ' + (robot.diagnostic.mainPattern || '--'), step2: 'Filtrado: ' + (strategyResult.reason || 'Sem padrao'), step3: 'Aguardando entrada...', step4: 'Placar sera atualizado apos resultado' };
      robot.stats.signalsRejected++;
      return null;
    }

    const confluences = Object.values(robot.diagnostic.patternScores || {}).filter(v => v >= 60).length;
    const recentLosses = (robot.stats?.losses || 0) > (robot.stats?.wins || 0) ? Math.min(3, (robot.stats.losses - robot.stats.wins)) : 0;
    const streak = robot.stats?.currentStreak || 0;

    let risk = 'BAIXO';
    if (recentLosses >= 2 || streak <= -3) risk = 'ALTO';
    else if (recentLosses >= 1 || streak <= -1) risk = 'MEDIO';

    let signalScore = Math.round(
      (strategyResult.confidence || 0) * 0.4 +
      (confluences / Math.max(Object.keys(robot.diagnostic.patternScores || {}).length, 1)) * 100 * 0.3 +
      Math.max(0, 100 - recentLosses * 20) * 0.2 +
      (risk === 'BAIXO' ? 90 : risk === 'MEDIO' ? 60 : 30) * 0.1
    );
    signalScore = Math.min(99, Math.max(10, signalScore));

    robot.diagnostic.confluences = confluences;
    robot.diagnostic.risk = risk;
    robot.diagnostic.signalScore = signalScore;

    const filterMode = robot.filterMode || 'moderado';
    const thresholds = {
      desligado: { minConf: 0, minConfluences: 0, minScore: 0 },
      conservador: { minConf: 80, minConfluences: 3, minScore: 75 },
      moderado: { minConf: 65, minConfluences: 2, minScore: 55 },
      agressivo: { minConf: 45, minConfluences: 1, minScore: 30 }
    };
    const th = thresholds[filterMode] || thresholds.moderado;
    const effectiveConf = th.minConf > 0 ? th.minConf : (robot.minimumConfidence || 80);

    const filter = {
      padraoEncontrado: true,
      resultadosSuficientes: robot.history.length >= robot.resultsToAnalyze,
      confiancaMinima: strategyResult.confidence >= effectiveConf,
      confluencia: confluences >= th.minConfluences,
      scoreMinimo: signalScore >= th.minScore,
      intervaloRespeitado: Date.now() - robot.lastSignalTime >= (robot.intervalMin || 60) * 1000,
      semDuplicata: !robot.currentSignal,
      roboAtivo: robot.status === 'online'
    };
    robot.diagnostic.filterResults = filter;

    const filterLabels = {
      padraoEncontrado: 'Padrao nao encontrado',
      resultadosSuficientes: 'Resultados insuficientes (' + robot.history.length + '/' + robot.resultsToAnalyze + ')',
      confiancaMinima: 'Confianca minima (' + Math.round(strategyResult.confidence) + '% < ' + effectiveConf + '%)',
      confluencia: 'Confluencias insuficientes (' + confluences + '/' + th.minConfluences + ')',
      scoreMinimo: 'Score minimo (' + signalScore + ' < ' + th.minScore + ')',
      intervaloRespeitado: 'Intervalo minimo (' + robot.intervalMin + 's)',
      semDuplicata: 'Sinal pendente ativo',
      roboAtivo: 'Robo offline'
    };

    const rejected = Object.entries(filter).find(([, v]) => !v);
    if (rejected) {
      robot.diagnostic.status = 'REJECTED';
      robot.diagnostic.decision = { approved: false, reason: filterLabels[rejected[0]] || rejected[0] };
      robot.diagnostic.signalBlocked = true;
      robot.diagnostic.blockReason = filterLabels[rejected[0]] || rejected[0];
      robot.signalFlow = { step1: 'Padrao: ' + (robot.diagnostic.mainPattern || '--'), step2: 'Bloqueado: ' + (filterLabels[rejected[0]] || rejected[0]), step3: 'Aguardando entrada...', step4: 'Placar sera atualizado apos resultado' };
      robot.stats.signalsRejected++;
      return null;
    }

    robot.diagnostic.signalBlocked = false;
    robot.diagnostic.blockReason = '';
    const sourceResult = robot.history?.[0] || null;
    const sourceResultKey = sourceResult && typeof robot.getResultKey === 'function'
      ? robot.getResultKey(sourceResult)
      : ((sourceResult?.color || '') + ':' + (sourceResult?.number ?? ''));
    const signal = { id: uid(), robotId: robot.id, game: robot.game, target: normalizeColor(strategyResult.target), confidence: strategyResult.confidence, pattern: strategyResult.pattern, reason: strategyResult.reason, gale: robot.galeCount, status: 'approved', createdAt: Date.now(), sourceResultKey, waitingAfterResultKey: sourceResultKey, lastCheckedResultKey: null, entrySent: false };
    robot.currentSignal = signal;
    robot.lastSignal = signal;
    robot.lastSignalTime = Date.now();
    robot.stats.signals++;
    robot.stats.signalsApproved++;
    robot.diagnostic.status = 'SIGNAL_READY';
    robot.diagnostic.decision = { approved: true, target: signal.target, confidence: signal.confidence };
    robot.signalFlow = { step1: 'Entrada: ' + signal.target + ' (' + signal.confidence + '%)', step2: 'SINAL APROVADO - Score: ' + signalScore + '/100', step3: 'Aguardando resultado...', step4: 'Placar sera atualizado apos resultado' };
    return signal;
  },

  createRobot(config) {
    const robot = new Robot(config);
    if (config.status) robot.status = config.status;
    else robot.status = 'online';
    this.robots.set(robot.id, robot);
    EventBus.emit('robot:started', { id: robot.id });
    return robot;
  },

  getRobot(id) { return this.robots.get(id); },
  getAllRobots() { return [...this.robots.values()]; },
  getAllStates() { return this.getAllRobots().map(r => r.getState()); },

  startRobot(id) { const r = this.robots.get(id); if (r) { r.status = 'online'; r.startedAt = Date.now(); EventBus.emit('robot:started', { id }); this.save(); } },
  stopRobot(id) { const r = this.robots.get(id); if (r) { r.status = 'offline'; r.startedAt = null; EventBus.emit('robot:stopped', { id }); this.save(); } },
  pauseRobot(id) { const r = this.robots.get(id); if (r) { r.status = 'paused'; EventBus.emit('robot:paused', { id }); this.save(); } },
  resumeRobot(id) { const r = this.robots.get(id); if (r) { r.status = 'online'; EventBus.emit('robot:resumed', { id }); this.save(); } },
  deleteRobot(id) {
    const r = this.robots.get(id);
    if (!r) return;
    r.status = 'offline';
    r.currentSignal = null;
    this.robots.delete(id);
    EventBus.emit('robot:deleted', { id });
    this.save();
  },

  save() {
    const robots = this.getAllRobots().map(r => r.toJSON());
    Store.set('robots', robots);
  },

  createRobotFromStorage(config, options = {}) {
    const robot = new Robot(config);
    if (config.status) robot.status = config.status;
    else robot.status = 'online';
    this.robots.set(robot.id, robot);
    if (options.emitStarted) EventBus.emit('robot:started', { id: robot.id });
    return robot;
  },

  load(options = {}) {
    const opts = { loadHistory: true, emitStarted: true, ...options };
    const saved = Store.get('robots', []);
    this.robots.clear();
    saved.forEach(config => {
      const robot = this.createRobotFromStorage(config, opts);
      if (opts.loadHistory) this.loadHistoryFromStorage(robot);
    });
  },

  syncFromStorage() {
    this.load({ loadHistory: false, emitStarted: false });
    EventBus.emit('robots:synced', { robots: this.getAllStates() });
  },

  loadHistoryFromStorage(robot) {
    const key = robot.game === 'double' ? 'historico-double-v1' : 'historico-wheel-v1';
    try {
      const raw = JSON.parse(localStorage.getItem(key) || '[]');
      if (!Array.isArray(raw) || !raw.length) return false;
      const existing = new Set(robot.history.map(h => h.roundId ? 'round:' + h.roundId : h.color + ':' + h.number + ':' + (h.multiplier || '')));
      let added = 0;
      for (let i = raw.length - 1; i >= 0; i--) {
        const r = raw[i];
        const rawColor = robot.game === 'double' ? r.color : (r.cellColor ?? r.color);
        const color = typeof robot.normalizeColor === 'function' ? robot.normalizeColor(rawColor) : String(rawColor || '').toUpperCase();
        const number = robot.game === 'double' ? r.number : (r.cellIndex ?? r.number);
        const roundId = r.roundId ?? r.roundID ?? r.roundUuid ?? r.roundUUID ?? r.gameId ?? r.gameID ?? r.id ?? r.uuid;
        const id = roundId !== undefined && roundId !== null ? 'round:' + String(roundId) : color + ':' + number + ':' + (r.multiplier || '');
        if (existing.has(id)) continue;
        existing.add(id);
        const item = robot.game === 'double'
          ? { color, number, roundId: roundId !== undefined && roundId !== null ? String(roundId) : undefined, timestamp: Date.now() }
          : { color, number, multiplier: r.multiplier, roundId: roundId !== undefined && roundId !== null ? String(roundId) : undefined, timestamp: Date.now() };
        robot.history.unshift(item);
        added++;
      }
      if (added > 0) {
        if (robot.history.length > 200) robot.history.length = 200;
        robot.diagnostic.analyzedResults = robot.history.length;
        robot.analyze();
      }
      return added > 0;
    } catch {}
    return false;
  },

  syncHistoriesFromStorage() {
    let changed = false;
    this.getAllRobots().forEach(robot => {
      if (robot.status !== 'online') return;
      changed = this.loadHistoryFromStorage(robot) || changed;
    });
    if (changed) this.save();
    return changed;
  },

  distributeResult(result) {
    const label = result.label || result.game;
    this.getAllRobots().forEach(robot => {
      if (robot.status === 'online' && robot.game === label) {
        const pendingSignal = robot.currentSignal;
        const accepted = robot.receiveResult(result);
        if (accepted && pendingSignal) robot.checkResult(result, pendingSignal);
        EventBus.emit('robot:state', robot.getState());
      }
    });
    this.save();
  }
};

EventBus.on('result:new', (result) => {
  RobotEngine.distributeResult(result);
});

EventBus.on('results:history', (d) => {
  if (!d || !d.results || !d.results.length) return;
  RobotEngine.getAllRobots().forEach(robot => {
    if (robot.status === 'online' && robot.game === d.label) {
      d.results.forEach(r => {
        const rawColor = r.color ?? r.cellColor;
        const color = typeof robot.normalizeColor === 'function' ? robot.normalizeColor(rawColor) : String(rawColor || '').toUpperCase();
        const number = r.number ?? r.cellIndex;
        const roundId = r.roundId ?? r.roundID ?? r.roundUuid ?? r.roundUUID ?? r.gameId ?? r.gameID ?? r.id ?? r.uuid;
        robot.history.unshift({ color, number, multiplier: r.multiplier, roundId: roundId !== undefined && roundId !== null ? String(roundId) : undefined, timestamp: Date.now() });
      });
      if (robot.history.length > 200) robot.history.length = 200;
      robot.diagnostic.analyzedResults = robot.history.length;
      robot.analyze();
    }
  });
  RobotEngine.save();
});
