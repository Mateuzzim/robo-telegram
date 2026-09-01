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
    },

    padroesCores(history, target, patternSize) {
      const pSize = patternSize || 3;
      if (history.length < 15) return { matched: false, confidence: 0, reason: 'Historico insuficiente' };
      
      const rawTargetColor = target?.color || 'any';
      const targetMult = target?.multiplier || null;
      const colors = history.map(r => r.color);
      const multipliers = history.map(r => r.multiplier);
      const now = Date.now();
      
      const isMultiTarget = rawTargetColor.includes('+');
      const effectiveTarget = (rawTargetColor === 'any' || isMultiTarget) ? 'any' : rawTargetColor;
      const allowedColors = isMultiTarget ? rawTargetColor.split('+').map(c => c.toUpperCase()) : null;
      
      const colorLabels = { RED: 'VERMELHO', BLACK: 'PRETO', GREY: 'PRETO', BLUE: 'AZUL', GREEN: 'VERDE' };
      
      const analyses = [];
      
      const sequences = {};
      for (let i = 0; i <= colors.length - pSize; i++) {
        const seq = colors.slice(i, i + pSize).join('-');
        if (!sequences[seq]) sequences[seq] = [];
        sequences[seq].push(i);
      }
      
      let bestSeqPattern = null;
      let bestSeqScore = 0;
      
      for (const [seq, positions] of Object.entries(sequences)) {
        if (positions.length < 2) continue;
        const seqColors = seq.split('-');
        let nextWins = 0;
        let totalNext = 0;
        
        for (const pos of positions) {
          const nextIdx = pos + pSize;
          if (nextIdx < colors.length) {
            totalNext++;
            if (effectiveTarget === 'any') {
              nextWins++;
            } else if (colors[nextIdx] === effectiveTarget) {
              nextWins++;
            }
          }
        }
        
        if (totalNext === 0) continue;
        const winRate = (nextWins / totalNext) * 100;
        const recentPos = positions[positions.length - 1];
        const recencyBoost = Math.max(0, 100 - (recentPos * 2));
        const finalScore = Math.round(winRate * 0.7 + recencyBoost * 0.3);
        
        if (finalScore > bestSeqScore) {
          bestSeqScore = finalScore;
          bestSeqPattern = {
            sequence: seqColors,
            wins: nextWins,
            total: totalNext,
            winRate: Math.round(winRate),
            positions: positions.slice(-3),
            recency: recentPos
          };
        }
      }
      
      if (bestSeqPattern) {
        analyses.push({
          type: 'sequencia',
          score: bestSeqScore,
          detail: `Seq ${bestSeqPattern.wins}x/${bestSeqPattern.total} (${bestSeqPattern.winRate}%)`,
          pattern: bestSeqPattern.sequence
        });
      }
      
      let alternScore = 0;
      let alternDetail = '';
      const last10 = colors.slice(0, Math.min(20, colors.length));
      let alternCount = 0;
      for (let i = 0; i < last10.length - 1; i++) {
        if (last10[i] !== last10[i + 1]) alternCount++;
      }
      alternScore = Math.round((alternCount / Math.max(last10.length - 1, 1)) * 100);
      
      let streak = 1;
      for (let i = 1; i < last10.length; i++) {
        if (last10[i] === last10[0]) streak++;
        else break;
      }
      
      if (alternScore >= 70 && streak <= 1) {
        analyses.push({
          type: 'alternado',
          score: alternScore,
          detail: `Alternancia ${alternScore}% - ${colorLabels[last10[0]] || last10[0]} atual`,
          target: last10[0] === 'RED' ? 'BLACK' : 'RED'
        });
      }
      
      const freq = {};
      colors.forEach(c => { freq[c] = (freq[c] || 0) + 1; });
      const sorted = Object.entries(freq).sort((a, b) => a[1] - b[1]);
      if (sorted.length > 0) {
        const [rareColor, rareCount] = sorted[0];
        const total = colors.length;
        const expected = total / (Object.keys(freq).length || 1);
        const deviation = Math.round(((expected - rareCount) / expected) * 100);
        
        if (deviation >= 30) {
          analyses.push({
            type: 'atrasada',
            score: Math.min(90, 50 + deviation),
            detail: `${colorLabels[rareColor] || rareColor} atrasada ${rareCount}x (esperado ~${Math.round(expected)})`,
            target: rareColor
          });
        }
      }
      
      if (targetMult) {
        const multiFreq = {};
        for (let i = 0; i < colors.length; i++) {
          const m = multipliers[i];
          if (m) {
            if (!multiFreq[m]) multiFreq[m] = { total: 0, wins: {} };
            multiFreq[m].total++;
            multiFreq[m].wins[colors[i]] = (multiFreq[m].wins[colors[i]] || 0) + 1;
          }
        }
        
        const multData = multiFreq[targetMult];
        if (multData && multData.total >= 3) {
          const sortedMult = Object.entries(multData.wins).sort((a, b) => b[1] - a[1]);
          if (sortedMult.length > 0) {
            const [bestColor, winCount] = sortedMult[0];
            const winRate = Math.round((winCount / multData.total) * 100);
            if (winRate >= 55) {
              analyses.push({
                type: 'multiplier',
                score: winRate,
                detail: `${targetMult}X: ${colorLabels[bestColor] || bestColor} ${winRate}% (${winCount}/${multData.total})`,
                target: bestColor
              });
            }
          }
        }
      }
      
      const cyclePatterns = {};
      for (let cycle = 2; cycle <= Math.min(8, Math.floor(colors.length / 3)); cycle++) {
        const cycleKey = colors.slice(0, cycle).join('-');
        let matches = 0;
        let totalCycles = 0;
        
        for (let i = cycle; i <= colors.length - cycle; i += cycle) {
          totalCycles++;
          const segment = colors.slice(i, i + cycle).join('-');
          if (segment === cycleKey) matches++;
        }
        
        if (totalCycles >= 2) {
          const matchRate = Math.round((matches / totalCycles) * 100);
          if (matchRate >= 60) {
            analyses.push({
              type: 'ciclo',
              score: matchRate,
              detail: `Ciclo ${cycle}: ${matches}x/${totalCycles} (${matchRate}%)`,
              cycle: cycle,
              pattern: cycleKey.split('-')
            });
          }
        }
      }
      
      if (colors.length >= pSize + 1) {
        const currentSeq = colors.slice(0, pSize).join('-');
        const nextColor = colors[pSize];
        
        if (sequences[currentSeq] && sequences[currentSeq].length >= 2) {
          const positions = sequences[currentSeq];
          let breakCount = 0;
          let breaks = [];
          
          for (let i = 0; i < positions.length - 1; i++) {
            const afterFirst = positions[i] + pSize;
            const afterSecond = positions[i + 1] + pSize;
            
            if (afterFirst < colors.length && afterSecond < colors.length) {
              if (colors[afterFirst] !== colors[afterSecond]) {
                breakCount++;
                breaks.push({
                  expected: colors[afterFirst],
                  actual: colors[afterSecond]
                });
              }
            }
          }
          
          if (breakCount > 0) {
            const breakRate = Math.round((breakCount / Math.max(positions.length - 1, 1)) * 100);
            analyses.push({
              type: 'distorcao',
              score: Math.min(85, 50 + breakRate),
              detail: `Padrao distorcendo ${breakRate}% - ${breakCount} quebras`,
              breaks: breaks.slice(-3)
            });
          }
        }
      }
      
      const confluences = analyses.filter(a => a.score >= 60).length;
      const confluenciaScore = Math.min(95, confluences * 25);
      
      if (confluences >= 2) {
        analyses.push({
          type: 'confluencia',
          score: confluenciaScore,
          detail: `${confluences} padroes concordando`
        });
      }
      
      const validAnalyses = analyses.filter(a => a.score >= 50);
      
      if (validAnalyses.length === 0) {
        return { matched: false, confidence: 0, reason: 'Nenhum padrao detectado' };
      }
      
      validAnalyses.sort((a, b) => b.score - a.score);
      const best = validAnalyses[0];
      
      let suggested;
      if (effectiveTarget !== 'any') {
        suggested = effectiveTarget;
      } else if (best.target) {
        suggested = best.target;
      } else if (best.pattern) {
        const last = best.pattern[best.pattern.length - 1];
        suggested = last === 'RED' ? 'BLACK' : 'RED';
      } else {
        suggested = 'RED';
      }

      if (allowedColors && !allowedColors.includes(suggested)) {
        suggested = allowedColors[0];
      }
      
      const confidence = Math.min(95, Math.max(10, best.score));
      const allTypes = validAnalyses.map(a => a.type).join(', ');
      
      return {
        matched: confidence >= 55,
        target: suggested,
        confidence,
        pattern: best.pattern || best.sequence || colors.slice(0, pSize),
        reason: `${best.type.toUpperCase()}: ${best.detail}`,
        analyses: validAnalyses.slice(0, 5),
        confluences,
        lastAnalysis: now
      };
    }
  },

  evaluate(robot, strategyResult) {
    const normalizeColor = color => typeof robot.normalizeColor === 'function' ? robot.normalizeColor(color) : String(color || '').toUpperCase();
    const targetColor = normalizeColor(robot.target?.color || 'any');

    if (targetColor !== 'ANY' && targetColor !== 'ALL' && !targetColor.includes('+')) {
      strategyResult.target = targetColor;
    } else if (targetColor.includes('+')) {
      const allowed = targetColor.split('+').map(c => normalizeColor(c));
      const normalized = normalizeColor(strategyResult.target);
      if (allowed.includes(normalized)) {
        strategyResult.target = normalized;
      } else {
        strategyResult.target = allowed[0];
      }
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
      const existing = new Set(robot.history.map(h => h.roundId ? 'round:' + h.roundId : (h.storageId ? 'stored:' + h.storageId : h.color + ':' + h.number + ':' + (h.multiplier || '') + ':' + (h.timestamp || ''))));
      let added = 0;
      for (let i = raw.length - 1; i >= 0; i--) {
        const r = raw[i];
        const rawColor = robot.game === 'double' ? r.color : (r.cellColor ?? r.color);
        const color = typeof robot.normalizeColor === 'function' ? robot.normalizeColor(rawColor) : String(rawColor || '').toUpperCase();
        const number = robot.game === 'double' ? r.number : (r.cellIndex ?? r.number);
        const roundId = r.roundId ?? r.roundID ?? r.roundUuid ?? r.roundUUID ?? r.gameId ?? r.gameID ?? r.id ?? r.uuid;
        const storageId = r.storageId ? String(r.storageId) : '';
        const timestamp = r.time || Date.now();
        const id = roundId !== undefined && roundId !== null ? 'round:' + String(roundId) : (storageId ? 'stored:' + storageId : color + ':' + number + ':' + (r.multiplier || '') + ':' + timestamp);
        if (existing.has(id)) continue;
        existing.add(id);
        const item = robot.game === 'double'
          ? { color, number, roundId: roundId !== undefined && roundId !== null ? String(roundId) : undefined, storageId: storageId || undefined, timestamp }
          : { color, number, multiplier: r.multiplier, roundId: roundId !== undefined && roundId !== null ? String(roundId) : undefined, storageId: storageId || undefined, timestamp };
        if (robot.game === 'wheel' && typeof robot.isImmediateDuplicateResult === 'function' && robot.isImmediateDuplicateResult(robot.history[0], item)) continue;
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
      const existingStable = new Set(robot.history
        .map(h => h.roundId ? 'round:' + h.roundId : (h.storageId ? 'stored:' + h.storageId : ''))
        .filter(Boolean));
      d.results.forEach(r => {
        const rawColor = r.color ?? r.cellColor;
        const color = typeof robot.normalizeColor === 'function' ? robot.normalizeColor(rawColor) : String(rawColor || '').toUpperCase();
        const number = r.number ?? r.cellIndex;
        const roundId = r.roundId ?? r.roundID ?? r.roundUuid ?? r.roundUUID ?? r.gameId ?? r.gameID ?? r.id ?? r.uuid;
        const item = { color, number, multiplier: r.multiplier, roundId: roundId !== undefined && roundId !== null ? String(roundId) : undefined, storageId: r.storageId ? String(r.storageId) : undefined, timestamp: r.time || Date.now() };
        const stableKey = item.roundId ? 'round:' + item.roundId : (item.storageId ? 'stored:' + item.storageId : '');
        if (stableKey && existingStable.has(stableKey)) return;
        if (robot.game === 'wheel' && typeof robot.isImmediateDuplicateResult === 'function' && robot.isImmediateDuplicateResult(robot.history[0], item)) return;
        if (stableKey) existingStable.add(stableKey);
        robot.history.unshift(item);
      });
      if (robot.history.length > 200) robot.history.length = 200;
      robot.diagnostic.analyzedResults = robot.history.length;
      robot.analyze();
    }
  });
  RobotEngine.save();
});
