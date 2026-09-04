const Filters = {
  applyAll(robot, history, candidates) {
    const activeFilters = robot.filters || [];
    if (activeFilters.length === 0) return candidates;
    let filtered = [...candidates];
    const context = this.buildContext(robot, history);
    for (const filterName of activeFilters) {
      if (typeof this[filterName] === 'function') {
        filtered = this[filterName](filtered, context, robot);
      }
    }
    return filtered;
  },

  buildContext(robot, history) {
    const results = history.map(h => h.result || h.color || h);
    const len = results.length;
    const counts = {};
    results.forEach(r => { counts[r] = (counts[r] || 0) + 1; });
    const recent10 = results.slice(0, 10);
    const recent30 = results.slice(0, 30);
    const countsRecent10 = {};
    recent10.forEach(r => { countsRecent10[r] = (countsRecent10[r] || 0) + 1; });
    const countsRecent30 = {};
    recent30.forEach(r => { countsRecent30[r] = (countsRecent30[r] || 0) + 1; });
    const lastSeen = {};
    results.forEach((r, i) => {
      if (lastSeen[r] === undefined) lastSeen[r] = i;
    });
    const streaks = {};
    const currentColor = results[0];
    if (currentColor) {
      let currentStreak = 0;
      for (const r of results) {
        if (r !== currentColor) break;
        currentStreak++;
      }
      streaks[currentColor] = currentStreak;
    }
    const entropy = this.calcEntropy(results);
    const volatility = this.calcVolatility(results);
    return { results, len, counts, recent10, recent30, countsRecent10, countsRecent30, lastSeen, streaks, entropy, volatility };
  },

  calcEntropy(arr) {
    if (!arr.length) return 0;
    const counts = {};
    arr.forEach(r => { counts[r] = (counts[r] || 0) + 1; });
    const len = arr.length;
    let H = 0;
    Object.values(counts).forEach(c => {
      const p = c / len;
      if (p > 0) H -= p * Math.log2(p);
    });
    return H;
  },

  calcVolatility(arr) {
    if (arr.length < 10) return 0;
    const recent = arr.slice(0, 10);
    const older = arr.slice(10, 20);
    if (older.length === 0) return 0;
    const freqRecent = {};
    recent.forEach(r => { freqRecent[r] = (freqRecent[r] || 0) + 1; });
    const freqOlder = {};
    older.forEach(r => { freqOlder[r] = (freqOlder[r] || 0) + 1; });
    let diff = 0;
    const allKeys = new Set([...Object.keys(freqRecent), ...Object.keys(freqOlder)]);
    allKeys.forEach(k => { diff += Math.abs((freqRecent[k] || 0) - (freqOlder[k] || 0)); });
    return diff / 2;
  },

  frequencia(candidates, ctx) {
    return candidates.filter(c => {
      const freq = (ctx.counts[c.color] || 0) / ctx.len;
      return freq > 0.05;
    });
  },

  repeticaoExcessiva(candidates, ctx) {
    return candidates.filter(c => {
      const ratio = (ctx.countsRecent10[c.color] || 0) / 10;
      return ratio < 0.7;
    });
  },

  sequenciaEsticada(candidates, ctx) {
    return candidates.filter(c => {
      const streak = ctx.streaks[c.color] || 0;
      return streak < 8;
    });
  },

  recencia(candidates, ctx) {
    return candidates.filter(c => {
      const last = ctx.lastSeen[c.color] ?? ctx.len;
      return last > 0;
    });
  },

  distanciaOcorrencias(candidates, ctx) {
    return candidates.filter(c => {
      const positions = [];
      ctx.results.forEach((r, i) => { if (r === c.color) positions.push(i); });
      if (positions.length < 2) return true;
      const lastTwo = positions.slice(0, 2);
      const dist = lastTwo[1] - lastTwo[0];
      return dist > 1;
    });
  },

  janelaCurtaLonga(candidates, ctx) {
    return candidates.filter(c => {
      const f10 = (ctx.countsRecent10[c.color] || 0) / 10;
      const f30 = (ctx.countsRecent30[c.color] || 0) / 30;
      return Math.abs(f10 - f30) < 0.3;
    });
  },

  tendencia(candidates, ctx) {
    return candidates.filter(c => {
      const recent = ctx.recent10.filter(r => r === c.color).length;
      const older = ctx.results.slice(10, 20).filter(r => r === c.color).length;
      return recent >= older;
    });
  },

  quebraTendencia(candidates, ctx) {
    return candidates.filter(c => {
      const recent5 = ctx.results.slice(0, 5).filter(r => r === c.color).length;
      const recent10 = ctx.results.slice(0, 10).filter(r => r === c.color).length;
      const rate5 = recent5 / 5;
      const rate10 = recent10 / 10;
      return !(rate5 < rate10 * 0.5);
    });
  },

  alternancia(candidates, ctx) {
    return candidates.filter(c => {
      const last5 = ctx.results.slice(0, 5);
      let alternations = 0;
      for (let i = 1; i < last5.length; i++) {
        if (last5[i] !== last5[i - 1]) alternations++;
      }
      return alternations >= 2;
    });
  },

  concentracao(candidates, ctx) {
    return candidates.filter(c => {
      const freq = (ctx.counts[c.color] || 0) / ctx.len;
      return freq < 0.6;
    });
  },

  dispersao(candidates, ctx) {
    return candidates.filter(c => {
      const numColors = Object.keys(ctx.counts).length;
      return numColors >= 3;
    });
  },

  atraso(candidates, ctx) {
    return candidates.filter(c => {
      const last = ctx.lastSeen[c.color] ?? ctx.len;
      return last < 30;
    });
  },

  padraoRecorrente(candidates, ctx) {
    return candidates.filter(c => {
      const len = ctx.results.length;
      if (len < 10) return true;
      const recent = ctx.results.slice(0, 5).join(',');
      let occurrences = 0;
      for (let i = 1; i <= len - 5; i++) {
        const window = ctx.results.slice(i, i + 5).join(',');
        if (window === recent) occurrences++;
      }
      return occurrences < 3;
    });
  },

  transicao(candidates, ctx) {
    return candidates.filter(c => {
      const last = ctx.results[0];
      if (!last) return true;
      let transFromLast = 0;
      let totalFromLast = 0;
      for (let i = 1; i < ctx.len; i++) {
        if (ctx.results[i] === last) {
          totalFromLast++;
          if (ctx.results[i - 1] === c.color) transFromLast++;
        }
      }
      if (totalFromLast === 0) return true;
      return (transFromLast / totalFromLast) > 0.1;
    });
  },

  matrizTransicao(candidates, ctx) {
    return Filters.transicao(candidates, ctx);
  },

  probabilidadeCondicional(candidates, ctx) {
    return Filters.transicao(candidates, ctx);
  },

  entropia(candidates, ctx) {
    return candidates.filter(() => ctx.entropy < 1.6);
  },

  volatilidade(candidates, ctx) {
    return candidates.filter(() => ctx.volatility < 3);
  },

  consensoEstrategias(candidates, ctx, robot) {
    if (!robot._strategyScores) return candidates;
    return candidates.filter(c => {
      const scores = robot._strategyScores[c.color] || [];
      return scores.length >= 2;
    });
  },

  divergenciaEstrategias(candidates, ctx, robot) {
    if (!robot._strategyScores) return candidates;
    return candidates.filter(c => {
      const scores = robot._strategyScores[c.color] || [];
      if (scores.length < 2) return true;
      const max = Math.max(...scores);
      const min = Math.min(...scores);
      return (max - min) < 30;
    });
  },

  scoreMinimo(candidates, ctx, robot) {
    const min = robot.minScore || 52;
    return candidates.filter(c => (c.score || 0) >= min);
  },

  confiancaMinima(candidates, ctx, robot) {
    const min = robot.minimumConfidence !== undefined ? robot.minimumConfidence : 50;
    return candidates.filter(c => (c.confidence || 0) >= min);
  },

  diferencaCandidatos(candidates, ctx, robot) {
    if (candidates.length < 2) {
      return candidates.filter(c => {
        const conf = c.confidence || c.score || 0;
        const avgConf = ctx.len > 0 ? 50 : 50;
        return conf > avgConf * 0.6;
      });
    }
    const sorted = [...candidates].sort((a, b) => (b.score || 0) - (a.score || 0));
    const diff = (sorted[0].score || 0) - (sorted[1].score || 0);
    return diff > 5 ? candidates : [];
  },

  confirmacaoMultipla(candidates, ctx, robot) {
    return candidates.filter(c => {
      const criteria = [];
      if ((ctx.counts[c.color] || 0) / ctx.len > 0.1) criteria.push('freq');
      if ((ctx.streaks[c.color] || 0) < 5) criteria.push('streak');
      if ((ctx.lastSeen[c.color] ?? 999) < 15) criteria.push('recency');
      return criteria.length >= 2;
    });
  },

  cooldownSinal(candidates, ctx, robot) {
    const cooldown = robot.intervalMin || 60;
    const lastSignal = robot.lastSignalTime || 0;
    const now = Date.now();
    if (now - lastSignal < cooldown * 1000) return [];
    return candidates;
  },

  posWin(candidates, ctx, robot) {
    const last = Array.isArray(robot.signalHistory) ? robot.signalHistory[robot.signalHistory.length - 1] : null;
    if (!last || last.type !== 'win') return candidates;
    {
      const lastWinTime = last.time || 0;
      const now = Date.now();
      if (now - lastWinTime < 30000) return [];
    }
    return candidates;
  },

  posLoss(candidates, ctx, robot) {
    const last = Array.isArray(robot.signalHistory) ? robot.signalHistory[robot.signalHistory.length - 1] : null;
    if (!last || last.type !== 'loss') return candidates;
    {
      const lastLossTime = last.time || 0;
      const now = Date.now();
      if (now - lastLossTime < 60000) return [];
    }
    return candidates;
  },

  lossConsecutivo(candidates, ctx, robot) {
    const maxLosses = robot.gale?.max || 2;
    const consecutiveLosses = Math.max(0, -(robot.stats?.currentStreak || 0));
    if (consecutiveLosses >= maxLosses) return [];
    return candidates;
  },

  qualidadeAmostra(candidates, ctx, robot) {
    const minResults = robot.resultsToAnalyze || 40;
    if (ctx.len < minResults * 0.5) return [];
    return candidates;
  },

  antiOverfitting(candidates, ctx, robot) {
    if (ctx.len < 50) return candidates;
    const mid = Math.floor(ctx.len / 2);
    const firstHalf = ctx.results.slice(0, mid);
    const secondHalf = ctx.results.slice(mid);
    return candidates.filter(c => {
      const freq1 = firstHalf.filter(r => r === c.color).length / firstHalf.length;
      const freq2 = secondHalf.filter(r => r === c.color).length / secondHalf.length;
      return Math.abs(freq1 - freq2) < 0.3;
    });
  }
};
