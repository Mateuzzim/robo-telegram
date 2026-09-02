const AnaliseEngine = (() => {
  const STORAGE_KEY = 'analise-bots-v1';
  const bots = new Map();

  const COLORS = {
    wheel: ['red', 'black', 'blue', 'green'],
    double: ['red', 'black', 'green']
  };

  const COLOR_LABELS = {
    red: '🔴 Vermelho',
    black: '⚫ Preto',
    grey: '⚪ Cinza',
    blue: '🔵 Azul',
    green: '🟢 Verde',
    RED: '🔴 Vermelho',
    BLACK: '⚫ Preto',
    GREY: '⚪ Cinza',
    BLUE: '🔵 Azul',
    GREEN: '🟢 Verde'
  };

  const EXPECTED = {
    wheel: { red: 0.4444, black: 0.4444, blue: 0.0741, green: 0.037 },
    double: { red: 0.4815, black: 0.4815, green: 0.037 }
  };

  function slugify(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  function getColor(r) {
    const c = normalizeColor(r.color || r.cellColor);
    if (c === 'grey' || c === 'gray') return 'black';
    return c;
  }

  function countColors(results, game) {
    const colors = COLORS[game];
    const counts = {};
    colors.forEach(c => counts[c] = 0);
    results.forEach(r => { const c = getColor(r); if (counts[c] !== undefined) counts[c]++; });
    return counts;
  }

  function getPercent(count, total) {
    return total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
  }

  function getCurrentStreak(results) {
    if (results.length === 0) return { color: null, length: 0 };
    let streak = 1;
    const first = getColor(results[0]);
    for (let i = 1; i < results.length; i++) {
      if (getColor(results[i]) === first) streak++;
      else break;
    }
    return { color: first, length: streak };
  }

  function getMaxStreaks(results) {
    if (results.length === 0) return {};
    const maxStreaks = {};
    let currentColor = getColor(results[0]);
    let currentLen = 1;
    maxStreaks[currentColor] = 1;
    for (let i = 1; i < results.length; i++) {
      const c = getColor(results[i]);
      if (c === currentColor) {
        currentLen++;
      } else {
        if (!maxStreaks[currentColor] || currentLen > maxStreaks[currentColor]) {
          maxStreaks[currentColor] = currentLen;
        }
        currentColor = c;
        currentLen = 1;
      }
    }
    if (!maxStreaks[currentColor] || currentLen > maxStreaks[currentColor]) {
      maxStreaks[currentColor] = currentLen;
    }
    return maxStreaks;
  }

  function getColorGaps(results, game) {
    const colors = COLORS[game];
    const gaps = {};
    colors.forEach(color => {
      let gap = 0;
      let found = false;
      for (let i = 0; i < results.length; i++) {
        if (getColor(results[i]) === color) { found = true; break; }
        gap++;
      }
      gaps[color] = found ? gap : results.length;
    });
    return gaps;
  }

  function calcChiSquared(results, game) {
    const expected = EXPECTED[game];
    const n = results.length;
    if (n === 0) return 0;
    const counts = countColors(results, game);
    const colors = COLORS[game];
    let chi2 = 0;
    colors.forEach(color => {
      const obs = counts[color] || 0;
      const exp = (expected[color] || 0) * n;
      if (exp > 0) chi2 += Math.pow(obs - exp, 2) / exp;
    });
    return chi2;
  }

  function calcStdDev(results, game) {
    const n = results.length;
    if (n < 2) return 0;
    const counts = countColors(results, game);
    const colors = COLORS[game];
    const mean = n / colors.length;
    let sumSq = 0;
    colors.forEach(color => {
      sumSq += Math.pow((counts[color] || 0) - mean, 2);
    });
    return Math.sqrt(sumSq / (n - 1));
  }

  function analiseEstatistica(results, game, cfg) {
    cfg = cfg || {};
    const n = results.length;
    const counts = countColors(results, game);
    const colors = COLORS[game];
    const streak = getCurrentStreak(results);
    const maxStreaks = getMaxStreaks(results);
    const gaps = getColorGaps(results, game);
    const chi2 = calcChiSquared(results, game);
    const stdDev = calcStdDev(results, game);

    const distribution = colors.map(color => ({
      color,
      label: COLOR_LABELS[color],
      count: counts[color] || 0,
      percent: getPercent(counts[color] || 0, n),
      bar: renderBar(counts[color] || 0, n)
    }));

    const mostDelayed = Object.entries(gaps)
      .sort((a, b) => b[1] - a[1])
      .map(([color, gap]) => ({ color, label: COLOR_LABELS[color], gap }));

    return {
      distribution,
      streak,
      maxStreaks,
      mostDelayed,
      chi2: chi2.toFixed(2),
      stdDev: stdDev.toFixed(2),
      total: n,
      _cfg: cfg
    };
  }

  function renderBar(count, total) {
    if (total === 0) return '';
    const filled = Math.round((count / total) * 10);
    return '█'.repeat(filled) + '░'.repeat(10 - filled);
  }

  function analisePadroes(results, game, cfg) {
    cfg = cfg || {};
    const n = results.length;
    if (n < 10) return { patterns: [], detected: 0 };

    const colors = results.map(r => getColor(r));
    const patterns = [];
    const altThreshold = (cfg.alternanciaThreshold || 55) / 100;
    const repThreshold = (cfg.repeticaoThreshold || 35) / 100;
    const domThreshold = (cfg.dominanciaThreshold || 50) / 100;

    let alternations = 0;
    for (let i = 1; i < n; i++) {
      if (colors[i] !== colors[i - 1]) alternations++;
    }
    const altRate = n > 1 ? alternations / (n - 1) : 0;
    patterns.push({
      name: 'Alternância',
      detected: altRate > altThreshold,
      confidence: Math.min(99, Math.round(altRate * 100)),
      description: `${(altRate * 100).toFixed(0)}% de alternância`
    });

    let repetitions = 0;
    for (let i = 1; i < n; i++) {
      if (colors[i] === colors[i - 1]) repetitions++;
    }
    const repRate = n > 1 ? repetitions / (n - 1) : 0;
    patterns.push({
      name: 'Repetição',
      detected: repRate > repThreshold,
      confidence: Math.min(99, Math.round(repRate * 100)),
      description: `${(repRate * 100).toFixed(0)}% de repetição consecutiva`
    });

    const colorCounts = {};
    colors.forEach(c => colorCounts[c] = (colorCounts[c] || 0) + 1);
    const dominant = Object.entries(colorCounts).sort((a, b) => b[1] - a[1]);
    const domRate = n > 0 ? dominant[0][1] / n : 0;
    const domLabel = COLOR_LABELS[dominant[0][0]] || dominant[0][0];
    patterns.push({
      name: 'Dominância',
      detected: domRate > domThreshold,
      confidence: Math.min(99, Math.round(domRate * 100)),
      description: `${domLabel} domina com ${(domRate * 100).toFixed(0)}%`
    });

    let trendUp = 0, trendDown = 0;
    const windowSize = Math.min(10, Math.floor(n / 3));
    if (windowSize >= 3) {
      const colorOf = COLORS[game][0];
      const firstWindow = colors.slice(0, windowSize).filter(c => c === colorOf).length;
      const lastWindow = colors.slice(-windowSize).filter(c => c === colorOf).length;
      if (lastWindow > firstWindow) trendUp++;
      else if (lastWindow < firstWindow) trendDown++;
    }
    patterns.push({
      name: 'Tendência',
      detected: trendUp > 0 || trendDown > 0,
      confidence: trendUp > 0 ? 65 : trendDown > 0 ? 65 : 50,
      description: trendUp > 0 ? 'Crescente' : trendDown > 0 ? 'Decrescente' : 'Estável'
    });

    const maxLag = cfg.maxCorrelationsLag || 5;
    const correlations = [];
    for (let lag = 1; lag <= Math.min(maxLag, Math.floor(n / 2)); lag++) {
      let matches = 0;
      let total = n - lag;
      for (let i = 0; i < total; i++) {
        if (colors[i] === colors[i + lag]) matches++;
      }
      const corr = total > 0 ? matches / total : 0;
      correlations.push({ lag, correlation: (corr * 100).toFixed(1) });
    }
    const hasCorrelation = correlations.some(c => parseFloat(c.correlation) > 60);
    patterns.push({
      name: 'Correlação',
      detected: hasCorrelation,
      confidence: hasCorrelation ? 70 : 50,
      description: hasCorrelation ? 'Correlação entre rodadas adjacentes detectada' : 'Sem correlação significativa'
    });

    const detected = patterns.filter(p => p.detected).length;

    return { patterns, detected, correlations };
  }

  function analiseTemporal(results, game, cfg) {
    cfg = cfg || {};
    const n = results.length;
    if (n < 20) return { cycles: [], periods: [], volatility: 0 };

    const colors = results.map(r => getColor(r));
    const cycles = [];
    const mainColor = COLORS[game][0];

    let lastSeen = -1;
    const intervals = [];
    for (let i = 0; i < n; i++) {
      if (colors[i] === mainColor) {
        if (lastSeen >= 0) intervals.push(i - lastSeen);
        lastSeen = i;
      }
    }
    if (intervals.length >= 3) {
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const stdInterval = Math.sqrt(intervals.reduce((s, v) => s + Math.pow(v - avgInterval, 2), 0) / intervals.length);
      cycles.push({
        color: mainColor,
        label: COLOR_LABELS[mainColor],
        avgInterval: avgInterval.toFixed(1),
        stdDev: stdInterval.toFixed(1),
        regular: stdInterval < avgInterval * 0.5
      });
    }

    const periods = [];
    const chunkCount = cfg.chunkCount || 5;
    const chunkSize = Math.max(10, Math.floor(n / chunkCount));
    for (let i = 0; i < n; i += chunkSize) {
      const chunk = colors.slice(i, i + chunkSize);
      const counts = {};
      COLORS[game].forEach(c => counts[c] = 0);
      chunk.forEach(c => { if (counts[c] !== undefined) counts[c]++; });
      const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      periods.push({
        start: i + 1,
        end: Math.min(i + chunkSize, n),
        dominant: dominant[0],
        label: COLOR_LABELS[dominant[0]],
        count: dominant[1],
        total: chunk.length
      });
    }

    let volatility = 0;
    for (let i = 1; i < n; i++) {
      if (colors[i] !== colors[i - 1]) volatility++;
    }
    volatility = n > 1 ? (volatility / (n - 1) * 100).toFixed(1) : 0;

    return { cycles, periods, volatility };
  }

  const EMOJI_MAP = {
    red: '🔴', black: '⚫', grey: '⚪', blue: '🔵', green: '🟢',
    RED: '🔴', BLACK: '⚫', GREY: '⚪', BLUE: '🔵', GREEN: '🟢'
  };

  function normalizeColor(c) {
    return String(c || '').toLowerCase();
  }

  function analiseHistorico(results, game, cfg) {
    cfg = cfg || {};
    const maxEmojis = cfg.maxEmojis || 100;
    const n = results.length;
    const recent = results.slice(0, maxEmojis);

    const emojis = recent.map(r => {
      const color = getColor(r);
      return EMOJI_MAP[color] || '❓';
    });

    return { emojis, total: n, count: recent.length };
  }

  function analisePrevisao(results, game, cfg) {
    cfg = cfg || {};
    const n = results.length;
    if (n < 10) return { predictions: [], confidence: 'Baixa', score: 30 };

    const colors = results.map(r => getColor(r));
    const gameColors = COLORS[game];
    const counts = countColors(results, game);
    const bayesW = cfg.bayesWeight || 0.6;
    const recentW = cfg.recentWeight || 0.4;
    const streakBonus = cfg.streakBonus || 0.05;
    const showTopN = cfg.showTopN || 3;

    const bayesScores = {};
    gameColors.forEach(color => {
      let score = (counts[color] || 0) / n;
      const recent10 = colors.slice(0, 10);
      const recentCount = recent10.filter(c => c === color).length;
      score = score * bayesW + (recentCount / 10) * recentW;
      bayesScores[color] = score;
    });

    const streak = getCurrentStreak(results);
    if (streak.length >= 3) {
      const oppositeColors = gameColors.filter(c => c !== streak.color);
      oppositeColors.forEach(c => {
        bayesScores[c] = (bayesScores[c] || 0) + streakBonus * Math.min(streak.length - 2, 3);
      });
      bayesScores[streak.color] = Math.max(0, (bayesScores[streak.color] || 0) - streakBonus * 2 * Math.min(streak.length - 2, 3));
    }

    const total = Object.values(bayesScores).reduce((a, b) => a + b, 0);
    const probabilities = gameColors.map(color => ({
      color,
      label: COLOR_LABELS[color],
      probability: total > 0 ? ((bayesScores[color] / total) * 100).toFixed(1) : '0.0'
    })).sort((a, b) => parseFloat(b.probability) - parseFloat(a.probability));

    let score = 40;
    if (n >= 50) score += 10;
    if (n >= 100) score += 10;
    if (streak.length >= 3) score += 5;
    const maxProb = parseFloat(probabilities[0].probability);
    if (maxProb > 50) score += 10;
    if (maxProb > 60) score += 5;
    score = Math.min(95, Math.max(15, score));

    let confidence;
    if (score >= 75) confidence = 'Alta';
    else if (score >= 55) confidence = 'Média';
    else confidence = 'Baixa';

    const topPredictions = probabilities.slice(0, showTopN);

    return { predictions: topPredictions, confidence, score, streak, totalResults: n };
  }

  function analiseProbabilidade(results, game, cfg) {
    cfg = cfg || {};
    const n = results.length;
    if (n < 10) return { colors: [], ev: {}, edge: 0, recomendacao: 'Dados insuficientes' };

    const colors = COLORS[game];
    const counts = countColors(results, game);
    const expected = EXPECTED[game];

    const colorAnalysis = colors.map(color => {
      const observed = (counts[color] || 0) / n;
      const exp = expected[color] || 0;
      const ev = ((observed - exp) / exp * 100).toFixed(1);
      const deviation = ((observed - exp) * 100).toFixed(1);
      const isOverdue = observed < exp;
      const isHot = observed > exp;

      let signal;
      if (isOverdue && parseFloat(deviation) < -5) signal = '📉 Sub-representada';
      else if (isHot && parseFloat(deviation) > 5) signal = '📈 Super-representada';
      else signal = '➡️ Equilibrada';

      return {
        color,
        label: COLOR_LABELS[color],
        observed: (observed * 100).toFixed(1),
        expected: (exp * 100).toFixed(1),
        deviation,
        ev,
        signal,
        isOverdue,
        isHot,
        gap: getColorGaps(results, game)[color] || 0
      };
    });

    const totalEdge = colors.reduce((sum, c) => {
      const obs = (counts[c] || 0) / n;
      const exp = expected[c] || 0;
      return sum + Math.abs(obs - exp);
    }, 0) * 100;

    const bestBet = colorAnalysis
      .filter(c => c.isOverdue && parseFloat(c.deviation) < -3)
      .sort((a, b) => parseFloat(a.deviation) - parseFloat(b.deviation))[0];

    const worstBet = colorAnalysis
      .filter(c => c.isHot && parseFloat(c.deviation) > 3)
      .sort((a, b) => parseFloat(b.deviation) - parseFloat(a.deviation))[0];

    let recomendacao;
    if (bestBet && parseFloat(bestBet.deviation) < -8) {
      recomendacao = `📈 ${bestBet.label} está sub-representada (${bestBet.deviation}%) - possível valor`;
    } else if (worstBet && parseFloat(worstBet.deviation) > 8) {
      recomendacao = `📉 ${worstBet.label} está super-representada (${worstBet.deviation}%) - cuidado`;
    } else {
      recomendacao = '➡️ Distribuição equilibrada';
    }

    return {
      colors: colorAnalysis,
      edge: totalEdge.toFixed(1),
      recomendacao,
      totalResults: n
    };
  }

  function analiseTendencia(results, game, cfg) {
    cfg = cfg || {};
    const n = results.length;
    if (n < 20) return { periods: [], trends: [], summary: 'Dados insuficientes' };

    const colors = COLORS[game];
    const periodSize = cfg.periodSize || Math.max(10, Math.floor(n / 10));
    const periods = [];

    for (let i = 0; i < n; i += periodSize) {
      const slice = results.slice(i, i + periodSize);
      const counts = countColors(slice, game);
      const total = slice.length;
      const period = {
        start: i + 1,
        end: Math.min(i + periodSize, n),
        total,
        distribution: {}
      };
      colors.forEach(c => {
        period.distribution[c] = {
          count: counts[c] || 0,
          percent: getPercent(counts[c] || 0, total),
          bar: renderBar(counts[c] || 0, total)
        };
      });
      periods.push(period);
    }

    const trends = colors.map(color => {
      const values = periods.map(p => parseFloat(p.distribution[color].percent));
      const firstHalf = values.slice(0, Math.floor(values.length / 2));
      const secondHalf = values.slice(Math.floor(values.length / 2));
      const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
      const change = avgSecond - avgFirst;

      let direction;
      if (change > 3) direction = '📈 Alta';
      else if (change < -3) direction = '📉 Baixa';
      else direction = '➡️ Estável';

      return {
        color,
        label: COLOR_LABELS[color],
        direction,
        change: change.toFixed(1),
        avgFirst: avgFirst.toFixed(1),
        avgSecond: avgSecond.toFixed(1)
      };
    });

    const summary = trends
      .filter(t => t.direction !== '➡️ Estável')
      .map(t => `${t.label}: ${t.direction} (${t.change > 0 ? '+' : ''}${t.change}%)`)
      .join(', ') || 'Todas estáveis';

    return { periods, trends, summary, periodSize };
  }

  function analiseSequencia(results, game, cfg) {
    cfg = cfg || {};
    const n = results.length;
    if (n < 20) return { pairs: [], triplets: [], afterRules: [], summary: 'Dados insuficientes' };

    const colors = results.map(r => getColor(r));
    const pairCounts = {};
    const tripletCounts = {};
    const afterCounts = {};

    for (let i = 1; i < n; i++) {
      const pair = `${colors[i - 1]}→${colors[i]}`;
      pairCounts[pair] = (pairCounts[pair] || 0) + 1;
    }

    for (let i = 2; i < n; i++) {
      const triplet = `${colors[i - 2]}${colors[i - 1]}→${colors[i]}`;
      tripletCounts[triplet] = (tripletCounts[triplet] || 0) + 1;
    }

    for (let i = 1; i < n; i++) {
      const after = colors[i - 1];
      if (!afterCounts[after]) afterCounts[after] = {};
      afterCounts[after][colors[i]] = (afterCounts[after][colors[i]] || 0) + 1;
    }

    const totalPairs = n - 1;
    const pairs = Object.entries(pairCounts)
      .map(([pair, count]) => ({
        pair,
        from: pair.split('→')[0],
        to: pair.split('→')[1],
        count,
        percent: getPercent(count, totalPairs),
        fromLabel: COLOR_LABELS[pair.split('→')[0]] || pair.split('→')[0],
        toLabel: COLOR_LABELS[pair.split('→')[1]] || pair.split('→')[1]
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, cfg.topPairs || 6);

    const totalTriplets = n - 2;
    const triplets = Object.entries(tripletCounts)
      .filter(([, count]) => count >= 2)
      .map(([triplet, count]) => ({
        triplet,
        count,
        percent: getPercent(count, totalTriplets),
        parts: triplet.split('→')
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, cfg.topTriplets || 4);

    const afterRules = [];
    Object.entries(afterCounts).forEach(([afterColor, nextCounts]) => {
      const total = Object.values(nextCounts).reduce((a, b) => a + b, 0);
      Object.entries(nextCounts).forEach(([nextColor, count]) => {
        const pct = parseFloat(getPercent(count, total));
        if (pct > 40) {
          afterRules.push({
            after: afterColor,
            afterLabel: COLOR_LABELS[afterColor] || afterColor,
            next: nextColor,
            nextLabel: COLOR_LABELS[nextColor] || nextColor,
            percent: pct,
            count,
            total
          });
        }
      });
    });

    afterRules.sort((a, b) => b.percent - a.percent);

    const summary = afterRules
      .slice(0, 3)
      .map(r => `Após ${r.afterLabel}, ${r.nextLabel}: ${r.percent}%`)
      .join(' | ') || 'Sem regra forte';

    return { pairs, triplets, afterRules, summary, totalPairs };
  }

  function analisePredAvancada(results, game, cfg) {
    cfg = cfg || {};
    const n = results.length;
    if (n < 30) return { predictions: [], models: {}, confidence: 'Baixa', score: 20 };

    const colors = COLORS[game];
    const counts = countColors(results, game);
    const expected = EXPECTED[game];
    const recent = results.slice(0, Math.min(50, n));
    const recentCounts = countColors(recent, game);

    const predictions = colors.map(color => {
      const freq = (counts[color] || 0) / n;
      const recentFreq = (recentCounts[color] || 0) / recent.length;
      const exp = expected[color] || 0;

      const bayesScore = (freq * 0.4 + recentFreq * 0.3 + exp * 0.3) * 100;

      let markovScore = 0;
      const transitions = {};
      for (let i = 1; i < n; i++) {
        const prev = getColor(results[i - 1]);
        const curr = getColor(results[i]);
        if (!transitions[prev]) transitions[prev] = {};
        transitions[prev][curr] = (transitions[prev][curr] || 0) + 1;
      }
      const lastColor = getColor(results[0]);
      if (transitions[lastColor]) {
        const total = Object.values(transitions[lastColor]).reduce((a, b) => a + b, 0);
        markovScore = ((transitions[lastColor][color] || 0) / total * 100);
      }

      const regressionScore = (recentFreq * 0.5 + freq * 0.3 + exp * 0.2) * 100;

      const hybridScore = (bayesScore * 0.35 + markovScore * 0.35 + regressionScore * 0.3);

      return {
        color,
        label: COLOR_LABELS[color],
        bayes: bayesScore.toFixed(1),
        markov: markovScore.toFixed(1),
        regression: regressionScore.toFixed(1),
        hybrid: hybridScore.toFixed(1),
        finalProb: hybridScore.toFixed(1)
      };
    });

    predictions.sort((a, b) => parseFloat(b.finalProb) - parseFloat(a.finalProb));

    const maxProb = parseFloat(predictions[0].finalProb);
    let confidence;
    if (maxProb > 55) confidence = 'Alta';
    else if (maxProb > 45) confidence = 'Média';
    else confidence = 'Baixa';

    const score = Math.min(95, Math.max(15, Math.round(maxProb * 0.8 + (confidence === 'Alta' ? 10 : 0))));

    return {
      predictions: predictions.slice(0, cfg.showTopN || 3),
      models: {
        bayes: predictions[0].bayes,
        markov: predictions[0].markov,
        regression: predictions[0].regression
      },
      confidence,
      score,
      totalResults: n
    };
  }

  function analiseAnomalias(results, game, cfg) {
    cfg = cfg || {};
    const n = results.length;
    if (n < 30) return { anomalies: [], score: 0, summary: 'Dados insuficientes' };

    const colors = results.map(r => getColor(r));
    const anomalies = [];
    let anomalyScore = 0;

    const counts = countColors(results, game);
    const total = n;
    const expected = EXPECTED[game];
    colors.forEach(c => {
      const obs = (counts[c] || 0) / total;
      const exp = expected[c] || 0;
      const zScore = Math.abs(obs - exp) / Math.sqrt(exp * (1 - exp) / total);
      if (zScore > 2) {
        anomalies.push({
          type: 'Distribuição Enviesada',
          description: `${COLOR_LABELS[c]}: ${(obs * 100).toFixed(1)}% vs esperado ${(exp * 100).toFixed(1)}%`,
          severity: zScore > 3 ? 'Alta' : 'Média',
          score: Math.min(100, Math.round(zScore * 25))
        });
        anomalyScore += zScore * 10;
      }
    });

    let maxRun = 1, currentRun = 1, runColor = colors[0];
    for (let i = 1; i < n; i++) {
      if (colors[i] === colors[i - 1]) {
        currentRun++;
        if (currentRun > maxRun) {
          maxRun = currentRun;
          runColor = colors[i];
        }
      } else {
        currentRun = 1;
      }
    }
    if (maxRun >= 6) {
      anomalies.push({
        type: 'Sequência Longa',
        description: `${COLOR_LABELS[runColor]} repetido ${maxRun} vezes consecutivas`,
        severity: maxRun >= 8 ? 'Alta' : 'Média',
        score: Math.min(100, (maxRun - 5) * 20)
      });
      anomalyScore += (maxRun - 5) * 15;
    }

    const periodSize = Math.floor(n / 5);
    const periods = [];
    for (let i = 0; i < n; i += periodSize) {
      const slice = colors.slice(i, i + periodSize);
      const c = countColors(slice.map((color, idx) => ({ color })), game);
      const dominant = Object.entries(c).sort((a, b) => b[1] - a[1]);
      if (dominant[0] && dominant[1]) {
        const ratio = dominant[0][1] / (dominant[1][1] || 1);
        if (ratio > 3) {
          periods.push({
            start: i + 1,
            end: Math.min(i + periodSize, n),
            dominant: dominant[0][0],
            ratio: ratio.toFixed(1)
          });
        }
      }
    }
    if (periods.length >= 2) {
      anomalies.push({
        type: 'Ciclos Repetitivos',
        description: `${periods.length} períodos com dominação forte`,
        severity: periods.length >= 3 ? 'Alta' : 'Média',
        score: Math.min(100, periods.length * 25)
      });
      anomalyScore += periods.length * 20;
    }

    anomalyScore = Math.min(100, Math.round(anomalyScore / 3));

    let summary;
    if (anomalyScore > 70) summary = '🔴 Anomalias significativas detectadas';
    else if (anomalyScore > 40) summary = '🟡 Algumas anomalias encontradas';
    else summary = '🟢 Distribuição dentro do esperado';

    return { anomalies, score: anomalyScore, summary, totalResults: n };
  }

  function analiseConfluenciaIA(results, game, cfg) {
    cfg = cfg || {};
    const n = results.length;
    if (n < 30) return { factors: [], totalScore: 0, recommendation: 'Dados insuficientes' };

    const colors = COLORS[game];
    const counts = countColors(results, game);
    const expected = EXPECTED[game];
    const streak = getCurrentStreak(results);
    const gaps = getColorGaps(results, game);
    const chi2 = calcChiSquared(results, game);

    const factors = [];

    let freqScore = 0;
    colors.forEach(c => {
      const obs = (counts[c] || 0) / n;
      const exp = expected[c] || 0;
      const deviation = Math.abs(obs - exp);
      if (deviation > 0.05) freqScore += deviation * 100;
    });
    freqScore = Math.min(100, freqScore);
    factors.push({
      name: 'Frequência',
      score: Math.round(freqScore),
      weight: cfg.freqWeight || 0.15,
      detail: 'Desvio da distribuição esperada'
    });

    let streakScore = 0;
    if (streak.length >= 5) streakScore = Math.min(100, streak.length * 12);
    else if (streak.length >= 3) streakScore = streak.length * 8;
    factors.push({
      name: 'Streak',
      score: Math.round(streakScore),
      weight: cfg.streakWeight || 0.12,
      detail: `${COLOR_LABELS[streak.color]} x${streak.length}`
    });

    let gapScore = 0;
    Object.values(gaps).forEach(gap => {
      if (gap > 15) gapScore += (gap - 10) * 5;
    });
    gapScore = Math.min(100, gapScore);
    factors.push({
      name: 'Atraso',
      score: Math.round(gapScore),
      weight: cfg.gapWeight || 0.13,
      detail: 'Cores atrasadas'
    });

    let chi2Score = 0;
    if (chi2 > 10) chi2Score = Math.min(100, chi2 * 5);
    else if (chi2 > 5) chi2Score = chi2 * 8;
    factors.push({
      name: 'Chi²',
      score: Math.round(chi2Score),
      weight: cfg.chi2Weight || 0.10,
      detail: `χ²: ${chi2.toFixed(2)}`
    });

    let patternScore = 0;
    const alts = results.filter((r, i) => i > 0 && getColor(r) !== getColor(results[i - 1])).length;
    const altRate = alts / (n - 1);
    if (altRate > 0.6) patternScore = altRate * 80;
    else if (altRate < 0.4) patternScore = (1 - altRate) * 60;
    factors.push({
      name: 'Padrão',
      score: Math.round(patternScore),
      weight: cfg.patternWeight || 0.12,
      detail: `Alternância: ${(altRate * 100).toFixed(0)}%`
    });

    let temporalScore = 0;
    const periodSize = Math.floor(n / 5);
    const recentPeriod = results.slice(0, periodSize);
    const olderPeriod = results.slice(periodSize, periodSize * 2);
    const recentDominant = Object.entries(countColors(recentPeriod, game)).sort((a, b) => b[1] - a[1])[0];
    const olderDominant = Object.entries(countColors(olderPeriod, game)).sort((a, b) => b[1] - a[1])[0];
    if (recentDominant && olderDominant && recentDominant[0] === olderDominant[0]) {
      temporalScore = 60;
    }
    factors.push({
      name: 'Temporal',
      score: Math.round(temporalScore),
      weight: cfg.temporalWeight || 0.10,
      detail: 'Tendência entre períodos'
    });

    let recoveryScore = 0;
    const last5 = results.slice(0, 5).map(r => getColor(r));
    const last5Counts = {};
    last5.forEach(c => last5Counts[c] = (last5Counts[c] || 0) + 1);
    const underrepresented = colors.filter(c => {
      const recentPct = (last5Counts[c] || 0) / 5;
      const totalPct = (counts[c] || 0) / n;
      return recentPct < totalPct - 0.1;
    });
    if (underrepresented.length > 0) recoveryScore = 65;
    factors.push({
      name: 'Recuperação',
      score: Math.round(recoveryScore),
      weight: cfg.recoveryWeight || 0.10,
      detail: underrepresented.length > 0 ? `${underrepresented.length} cor(es) abaixo da média` : 'Equilibrado'
    });

    let consistencyScore = 0;
    const chunks = [];
    for (let i = 0; i < n; i += Math.floor(n / 4)) {
      const chunk = results.slice(i, i + Math.floor(n / 4));
      const chunkCounts = countColors(chunk, game);
      const dominant = Object.entries(chunkCounts).sort((a, b) => b[1] - a[1])[0];
      if (dominant) chunks.push(dominant[0]);
    }
    const uniqueChunks = new Set(chunks).size;
    if (uniqueChunks <= 2) consistencyScore = 70;
    else if (uniqueChunks <= 3) consistencyScore = 45;
    factors.push({
      name: 'Consistência',
      score: Math.round(consistencyScore),
      weight: cfg.consistencyWeight || 0.10,
      detail: `${uniqueChunks} dominante(s) em 4 períodos`
    });

    let momentumScore = 0;
    const last10 = results.slice(0, 10).map(r => getColor(r));
    const first5 = last10.slice(5);
    const second5 = last10.slice(0, 5);
    const firstCounts = {};
    const secondCounts = {};
    first5.forEach(c => firstCounts[c] = (firstCounts[c] || 0) + 1);
    second5.forEach(c => secondCounts[c] = (secondCounts[c] || 0) + 1);
    colors.forEach(c => {
      const firstPct = (firstCounts[c] || 0) / 5;
      const secondPct = (secondCounts[c] || 0) / 5;
      const change = secondPct - firstPct;
      if (Math.abs(change) > 0.2) momentumScore += Math.abs(change) * 50;
    });
    momentumScore = Math.min(100, momentumScore);
    factors.push({
      name: 'Momentum',
      score: Math.round(momentumScore),
      weight: cfg.momentumWeight || 0.08,
      detail: 'Variação recente'
    });

    let correlationScore = 0;
    for (let lag = 1; lag <= 5; lag++) {
      let matches = 0;
      for (let i = lag; i < n; i++) {
        if (getColor(results[i]) === getColor(results[i - lag])) matches++;
      }
      const corr = matches / (n - lag);
      if (Math.abs(corr - 0.5) < 0.15) correlationScore += 20;
    }
    correlationScore = Math.min(100, correlationScore);
    factors.push({
      name: 'Correlação',
      score: Math.round(correlationScore),
      weight: cfg.correlationWeight || 0.07,
      detail: 'Correlação temporal'
    });

    let valueScore = 0;
    colors.forEach(c => {
      const obs = (counts[c] || 0) / n;
      const exp = expected[c] || 0;
      if (obs < exp - 0.03) valueScore += (exp - obs) * 200;
    });
    valueScore = Math.min(100, valueScore);
    factors.push({
      name: 'Valor',
      score: Math.round(valueScore),
      weight: cfg.valueWeight || 0.03,
      detail: 'Oportunidade de valor'
    });

    let totalScore = 0;
    let totalWeight = 0;
    factors.forEach(f => {
      totalScore += f.score * f.weight;
      totalWeight += f.weight;
    });
    totalScore = totalWeight > 0 ? Math.round(totalScore / totalWeight) : 30;
    totalScore = Math.min(100, Math.max(10, totalScore));

    const topFactor = factors.sort((a, b) => (b.score * b.weight) - (a.score * a.weight))[0];

    let recommendation;
    if (totalScore >= 75) recommendation = `🟢 Forte (${topFactor.name} domina)`;
    else if (totalScore >= 55) recommendation = `🟡 Moderada (${topFactor.name} destaca)`;
    else recommendation = `🔴 Fraca (${topFactor.name} limita)`;

    return {
      factors: factors.sort((a, b) => b.weight - a.weight),
      totalScore,
      recommendation,
      topFactor: topFactor.name,
      totalResults: n
    };
  }

  function analiseMatrizTransicao(results, game, cfg) {
    cfg = cfg || {};
    const n = results.length;
    if (n < 20) return { matrix: {}, flows: [], prediction: null, entropy: 0 };

    const colors = COLORS[game];
    const matrix = {};
    colors.forEach(from => {
      matrix[from] = {};
      colors.forEach(to => { matrix[from][to] = 0; });
    });

    for (let i = 1; i < n; i++) {
      const from = getColor(results[i - 1]);
      const to = getColor(results[i]);
      if (matrix[from] && matrix[from][to] !== undefined) {
        matrix[from][to]++;
      }
    }

    const normalized = {};
    colors.forEach(from => {
      normalized[from] = {};
      const total = Object.values(matrix[from]).reduce((a, b) => a + b, 0);
      colors.forEach(to => {
        normalized[from][to] = total > 0 ? ((matrix[from][to] / total) * 100).toFixed(1) : '0.0';
      });
    });

    const flows = [];
    colors.forEach(from => {
      colors.forEach(to => {
        if (from !== to) {
          const pct = parseFloat(normalized[from][to]);
          if (pct > 25) {
            flows.push({
              from, to,
              fromLabel: COLOR_LABELS[from],
              toLabel: COLOR_LABELS[to],
              percent: pct,
              strength: pct > 40 ? 'Forte' : pct > 30 ? 'Média' : 'Fraca'
            });
          }
        }
      });
    });
    flows.sort((a, b) => b.percent - a.percent);

    const lastColor = getColor(results[0]);
    const predictions = colors.map(to => ({
      color: to,
      label: COLOR_LABELS[to],
      probability: parseFloat(normalized[lastColor][to])
    })).sort((a, b) => b.probability - a.probability);

    let entropy = 0;
    colors.forEach(from => {
      const total = Object.values(matrix[from]).reduce((a, b) => a + b, 0);
      if (total > 0) {
        colors.forEach(to => {
          const p = matrix[from][to] / total;
          if (p > 0) entropy -= p * Math.log2(p);
        });
      }
    });
    const maxEntropy = Math.log2(colors.length);
    const normalizedEntropy = maxEntropy > 0 ? ((entropy / maxEntropy) * 100).toFixed(1) : 0;

    const matrixViz = colors.map(from => {
      return colors.map(to => {
        const pct = parseFloat(normalized[from][to]);
        if (pct > 40) return '██';
        if (pct > 30) return '▓▓';
        if (pct > 20) return '░░';
        return '  ';
      }).join(' ');
    });

    return {
      matrix: normalized,
      matrixRaw: matrix,
      matrixViz,
      flows: flows.slice(0, 5),
      predictions: predictions.slice(0, 3),
      entropy: normalizedEntropy,
      maxEntropy: (maxEntropy * 100).toFixed(1),
      lastColor,
      lastColorLabel: COLOR_LABELS[lastColor],
      totalResults: n
    };
  }

  function analiseEntropia(results, game, cfg) {
    cfg = cfg || {};
    const n = results.length;
    if (n < 30) return { shannon: 0, compression: 0, patterns: [], score: 0 };

    const colors = results.map(r => getColor(r));
    const counts = countColors(results, game);

    let shannon = 0;
    Object.values(counts).forEach(count => {
      if (count > 0) {
        const p = count / n;
        shannon -= p * Math.log2(p);
      }
    });
    const maxShannon = Math.log2(Object.keys(counts).length);
    const shannonNorm = maxShannon > 0 ? (shannon / maxShannon * 100).toFixed(1) : 0;

    const runLengths = [];
    let currentRun = 1;
    for (let i = 1; i < n; i++) {
      if (colors[i] === colors[i - 1]) {
        currentRun++;
      } else {
        runLengths.push(currentRun);
        currentRun = 1;
      }
    }
    runLengths.push(currentRun);

    const runFreq = {};
    runLengths.forEach(r => { runFreq[r] = (runFreq[r] || 0) + 1; });

    const lzwCompress = (arr) => {
      const dict = {};
      let code = 0;
      arr.forEach(c => { if (!(c in dict)) dict[c] = code++; });
      return { size: arr.length, unique: Object.keys(dict).length };
    };

    const uncompressed = lzwCompress(colors);
    const colorStr = colors.join('');
    const compressed = [];
    for (let i = 0; i < n; i += 5) {
      compressed.push(colorStr.substring(i, i + 5));
    }
    const compressionRatio = ((1 - compressed.length / n) * 100).toFixed(1);

    const patterns = [];

    let altCount = 0;
    for (let i = 1; i < n; i++) {
      if (colors[i] !== colors[i - 1]) altCount++;
    }
    const altRate = altCount / (n - 1);
    if (altRate > 0.65) {
      patterns.push({ name: 'Alta Alternância', rate: (altRate * 100).toFixed(1), entropy: 'Baixa' });
    } else if (altRate < 0.35) {
      patterns.push({ name: 'Alta Repetição', rate: ((1 - altRate) * 100).toFixed(1), entropy: 'Baixa' });
    }

    let maxRepeat = 1, currentRepeat = 1;
    for (let i = 1; i < n; i++) {
      if (colors[i] === colors[i - 1]) {
        currentRepeat++;
        maxRepeat = Math.max(maxRepeat, currentRepeat);
      } else {
        currentRepeat = 1;
      }
    }
    if (maxRepeat >= 5) {
      patterns.push({ name: 'Sequência Longa', maxRun: maxRepeat, entropy: 'Crítica' });
    }

    const pairs = {};
    for (let i = 1; i < n; i++) {
      const pair = `${colors[i - 1]}${colors[i]}`;
      pairs[pair] = (pairs[pair] || 0) + 1;
    }
    const topPair = Object.entries(pairs).sort((a, b) => b[1] - a[1])[0];
    if (topPair && topPair[1] / (n - 1) > 0.2) {
      patterns.push({ name: 'Par Dominante', pair: topPair[0], count: topPair[1] });
    }

    const triplets = {};
    for (let i = 2; i < n; i++) {
      const t = `${colors[i - 2]}${colors[i - 1]}${colors[i]}`;
      triplets[t] = (triplets[t] || 0) + 1;
    }
    const topTriplet = Object.entries(triplets).sort((a, b) => b[1] - a[1])[0];
    if (topTriplet && topTriplet[1] >= 3) {
      patterns.push({ name: 'Tripleto Frequente', triplet: topTriplet[0], count: topTriplet[1] });
    }

    const entropiaScore = 100 - parseFloat(shannonNorm);
    let assessment;
    if (entropiaScore > 70) assessment = '🔴 Alta previsibilidade - Padrões fortes';
    else if (entropiaScore > 40) assessment = '🟡 Média previsibilidade - Padrões moderados';
    else assessment = '🟢 Baixa previsibilidade - Próximo de aleatório';

    const visBar = [];
    const visColors = ['🔴', '⚫', '🔵', '🟢'];
    Object.entries(counts).forEach(([color, count], i) => {
      const pct = (count / n) * 100;
      const barLen = Math.round(pct / 5);
      visBar.push(`${visColors[i] || '⚪'} ${'█'.repeat(barLen)}${'░'.repeat(20 - barLen)} ${pct.toFixed(1)}%`);
    });

    return {
      shannon: shannon.toFixed(3),
      shannonNorm,
      maxShannon: maxShannon.toFixed(3),
      compressionRatio,
      uniqueSymbols: uncompressed.unique,
      runFreq,
      patterns,
      score: entropiaScore.toFixed(1),
      assessment,
      visBar,
      totalResults: n
    };
  }

  function analiseAlgoritmoGenetico(results, game, cfg) {
    cfg = cfg || {};
    const n = results.length;
    if (n < 40) return { generations: [], bestRule: null, fitness: 0, population: [] };

    const colors = results.map(r => getColor(r));
    const colorSet = COLORS[game];

    const generateRule = () => {
      const lookback = Math.floor(Math.random() * 5) + 1;
      const conditions = [];
      for (let i = 0; i < lookback; i++) {
        conditions.push(colorSet[Math.floor(Math.random() * colorSet.length)]);
      }
      const weights = conditions.map(() => (Math.random() * 2 - 1).toFixed(2));
      const threshold = (Math.random() * 2 - 1).toFixed(2);
      const prediction = colorSet[Math.floor(Math.random() * colorSet.length)];
      return { conditions, weights: weights.map(Number), prediction, threshold: Number(threshold) };
    };

    const evaluateRule = (rule, testResults) => {
      let correct = 0;
      let total = 0;
      const lb = rule.conditions.length;
      for (let i = lb; i < testResults.length; i++) {
        let score = 0;
        for (let j = 0; j < lb; j++) {
          if (getColor(testResults[i - lb + j]) === rule.conditions[j]) {
            score += rule.weights[j];
          }
        }
        if (score > rule.threshold) {
          total++;
          if (getColor(testResults[i]) === rule.prediction) correct++;
        }
      }
      return total > 10 ? (correct / total * 100) : 0;
    };

    const mutateRule = (rule) => {
      const mutated = JSON.parse(JSON.stringify(rule));
      const idx = Math.floor(Math.random() * mutated.conditions.length);
      mutated.conditions[idx] = colorSet[Math.floor(Math.random() * colorSet.length)];
      mutated.weights[idx] = (Math.random() * 2 - 1);
      mutated.threshold = (Math.random() * 2 - 1);
      return mutated;
    };

    const crossoverRules = (r1, r2) => {
      const child = JSON.parse(JSON.stringify(r1));
      const split = Math.floor(Math.random() * child.conditions.length);
      for (let i = split; i < child.conditions.length; i++) {
        child.conditions[i] = r2.conditions[i];
        child.weights[i] = r2.weights[i];
      }
      return child;
    };

    const trainSet = results.slice(Math.floor(n * 0.3));
    const testSet = results.slice(0, Math.floor(n * 0.3));

    let population = [];
    for (let i = 0; i < 20; i++) {
      population.push(generateRule());
    }

    const generations = [];
    const bestPerGen = [];

    for (let gen = 0; gen < 15; gen++) {
      population.forEach(rule => {
        rule.fitness = evaluateRule(rule, trainSet);
      });
      population.sort((a, b) => b.fitness - a.fitness);

      bestPerGen.push({
        gen: gen + 1,
        bestFitness: population[0].fitness.toFixed(1),
        avgFitness: (population.reduce((s, r) => s + r.fitness, 0) / population.length).toFixed(1)
      });

      const elite = population.slice(0, 5);
      const newPop = [...elite];
      while (newPop.length < 20) {
        if (Math.random() < 0.7) {
          const p1 = elite[Math.floor(Math.random() * elite.length)];
          const p2 = elite[Math.floor(Math.random() * elite.length)];
          newPop.push(crossoverRules(p1, p2));
        } else {
          newPop.push(mutateRule(elite[Math.floor(Math.random() * elite.length)]));
        }
      }
      population = newPop;
    }

    population.forEach(rule => {
      rule.fitness = evaluateRule(rule, testSet);
    });
    population.sort((a, b) => b.fitness - a.fitness);

    const bestRule = population[0];
    const ruleStr = bestRule.conditions.map((c, i) => {
      const w = bestRule.weights[i];
      const sign = w > 0 ? '+' : '';
      return `${COLOR_LABELS[c] || c}${sign}${(w != null ? Number(w) : 0).toFixed(1)}`;
    }).join(' ');

    const confianca = bestRule.fitness > 60 ? 'Alta' : bestRule.fitness > 45 ? 'Média' : 'Baixa';

    const historyViz = bestPerGen.map(g => {
      const barLen = Math.round(parseFloat(g.bestFitness) / 5);
      return `G${String(g.gen).padStart(2, '0')} ${'█'.repeat(barLen)}${'░'.repeat(20 - barLen)} ${g.bestFitness}%`;
    });

    return {
      bestRule: {
        conditions: bestRule.conditions,
        weights: bestRule.weights,
        prediction: bestRule.prediction,
        predictionLabel: COLOR_LABELS[bestRule.prediction],
        threshold: bestRule.threshold,
        fitness: bestRule.fitness.toFixed(1),
        ruleStr
      },
      fitness: bestRule.fitness.toFixed(1),
      confianca,
      generations: bestPerGen,
      historyViz,
      topRules: population.slice(0, 3).map(r => ({
        fitness: r.fitness.toFixed(1),
        prediction: COLOR_LABELS[r.prediction],
        conditions: r.conditions.map(c => COLOR_LABELS[c] || c).join('→')
      })),
      totalResults: n
    };
  }

  function analiseMultidimensional(results, game, cfg) {
    cfg = cfg || {};
    const n = results.length;
    if (n < 40) return { dimensions: [], matrix: [], score: 0, recommendation: 'Dados insuficientes' };

    const colors = results.map(r => getColor(r));
    const colorSet = COLORS[game];
    const expected = EXPECTED[game];

    const dimensions = [];

    const freq = countColors(results, game);
    const freqScore = {};
    let totalEntropy = 0;
    Object.values(freq).forEach(c => {
      const p = c / n;
      if (p > 0) totalEntropy -= p * Math.log2(p);
    });
    const maxEntropy = Math.log2(colorSet.length);
    const entropyNorm = maxEntropy > 0 ? totalEntropy / maxEntropy : 0.5;
    freqScore.raw = (1 - entropyNorm) * 100;
    freqScore.visual = '█'.repeat(Math.round(freqScore.raw / 10)) + '░'.repeat(10 - Math.round(freqScore.raw / 10));
    freqScore.label = 'Frequência';
    freqScore.detail = `Entropia: ${(entropyNorm * 100).toFixed(0)}%`;
    dimensions.push(freqScore);

    const streakScore = {};
    let currentRun = 1, maxRun = 1;
    for (let i = 1; i < n; i++) {
      if (colors[i] === colors[i - 1]) {
        currentRun++;
        maxRun = Math.max(maxRun, currentRun);
      } else {
        currentRun = 1;
      }
    }
    streakScore.raw = maxRun >= 8 ? 90 : maxRun >= 5 ? 70 : maxRun >= 3 ? 50 : 30;
    streakScore.visual = '█'.repeat(Math.round(streakScore.raw / 10)) + '░'.repeat(10 - Math.round(streakScore.raw / 10));
    streakScore.label = 'Streak';
    streakScore.detail = `Máx: ${maxRun}x`;
    dimensions.push(streakScore);

    const gaps = {};
    colorSet.forEach(c => gaps[c] = 0);
    for (let i = 0; i < n; i++) {
      colorSet.forEach(c => {
        if (getColor(results[i]) === c) gaps[c] = 0;
        else gaps[c]++;
      });
    }
    const maxGap = Math.max(...Object.values(gaps));
    const gapScore = {};
    gapScore.raw = maxGap > 20 ? 90 : maxGap > 10 ? 65 : maxGap > 5 ? 40 : 20;
    gapScore.visual = '█'.repeat(Math.round(gapScore.raw / 10)) + '░'.repeat(10 - Math.round(gapScore.raw / 10));
    gapScore.label = 'Atraso';
    gapScore.detail = `Máx: ${maxGap}rd`;
    dimensions.push(gapScore);

    const patternScore = {};
    let altCount = 0;
    for (let i = 1; i < n; i++) {
      if (colors[i] !== colors[i - 1]) altCount++;
    }
    const altRate = altCount / (n - 1);
    const patternDeviation = Math.abs(altRate - 0.5);
    patternScore.raw = patternDeviation * 200;
    patternScore.visual = '█'.repeat(Math.round(patternScore.raw / 10)) + '░'.repeat(10 - Math.round(patternScore.raw / 10));
    patternScore.label = 'Padrão';
    patternScore.detail = `Alt: ${(altRate * 100).toFixed(0)}%`;
    dimensions.push(patternScore);

    const temporalScore = {};
    const periodSize = Math.floor(n / 5);
    const periodDominated = [];
    for (let i = 0; i < 5; i++) {
      const slice = results.slice(i * periodSize, (i + 1) * periodSize);
      const c = countColors(slice, game);
      const dominant = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
      periodDominated.push(dominant[0]);
    }
    const uniquePeriods = new Set(periodDominated).size;
    temporalScore.raw = uniquePeriods <= 2 ? 85 : uniquePeriods <= 3 ? 60 : 35;
    temporalScore.visual = '█'.repeat(Math.round(temporalScore.raw / 10)) + '░'.repeat(10 - Math.round(temporalScore.raw / 10));
    temporalScore.label = 'Temporal';
    temporalScore.detail = `${uniquePeriods} dominante(s) em 5`;
    dimensions.push(temporalScore);

    const correlationScore = {};
    let corrSum = 0;
    for (let lag = 1; lag <= 5; lag++) {
      let matches = 0;
      for (let i = lag; i < n; i++) {
        if (colors[i] === colors[i - lag]) matches++;
      }
      corrSum += matches / (n - lag);
    }
    const avgCorr = corrSum / 5;
    correlationScore.raw = Math.abs(avgCorr - 0.5) * 200;
    correlationScore.visual = '█'.repeat(Math.round(correlationScore.raw / 10)) + '░'.repeat(10 - Math.round(correlationScore.raw / 10));
    correlationScore.label = 'Correlação';
    correlationScore.detail = `Média: ${(avgCorr * 100).toFixed(0)}%`;
    dimensions.push(correlationScore);

    let chi2 = 0;
    colorSet.forEach(c => {
      const observed = freq[c] || 0;
      const expectedCount = expected[c] * n;
      chi2 += Math.pow(observed - expectedCount, 2) / expectedCount;
    });
    const chi2Score = {};
    chi2Score.raw = chi2 > 10 ? 90 : chi2 > 5 ? 65 : chi2 > 2 ? 40 : 20;
    chi2Score.visual = '█'.repeat(Math.round(chi2Score.raw / 10)) + '░'.repeat(10 - Math.round(chi2Score.raw / 10));
    chi2Score.label = 'Chi²';
    chi2Score.detail = `χ²: ${chi2.toFixed(2)}`;
    dimensions.push(chi2Score);

    const momentumScore = {};
    const last20 = results.slice(0, 20).map(r => getColor(r));
    const first10 = last20.slice(10);
    const second10 = last20.slice(0, 10);
    const firstCounts = countColors(first10.map(c => ({ color: c })), game);
    const secondCounts = countColors(second10.map(c => ({ color: c })), game);
    let momentumChange = 0;
    colorSet.forEach(c => {
      const firstPct = (firstCounts[c] || 0) / 10;
      const secondPct = (secondCounts[c] || 0) / 10;
      momentumChange += Math.abs(secondPct - firstPct);
    });
    momentumScore.raw = Math.min(100, momentumChange * 150);
    momentumScore.visual = '█'.repeat(Math.round(momentumScore.raw / 10)) + '░'.repeat(10 - Math.round(momentumScore.raw / 10));
    momentumScore.label = 'Momentum';
    momentumScore.detail = `Δ: ${(momentumChange * 100).toFixed(0)}%`;
    dimensions.push(momentumScore);

    const recoveryScore = {};
    const last5 = results.slice(0, 5).map(r => getColor(r));
    const last5Counts = countColors(last5.map(c => ({ color: c })), game);
    let underrep = 0;
    colorSet.forEach(c => {
      const recentPct = (last5Counts[c] || 0) / 5;
      const totalPct = (freq[c] || 0) / n;
      if (recentPct < totalPct - 0.1) underrep++;
    });
    recoveryScore.raw = underrep > 0 ? Math.min(100, 50 + underrep * 20) : 30;
    recoveryScore.visual = '█'.repeat(Math.round(recoveryScore.raw / 10)) + '░'.repeat(10 - Math.round(recoveryScore.raw / 10));
    recoveryScore.label = 'Recuperação';
    recoveryScore.detail = `${underrep} abaixo da média`;
    dimensions.push(recoveryScore);

    const valueScore = {};
    let totalDev = 0;
    colorSet.forEach(c => {
      const obs = (freq[c] || 0) / n;
      const exp = expected[c] || 0;
      totalDev += Math.abs(obs - exp);
    });
    valueScore.raw = Math.min(100, totalDev * 300);
    valueScore.visual = '█'.repeat(Math.round(valueScore.raw / 10)) + '░'.repeat(10 - Math.round(valueScore.raw / 10));
    valueScore.label = 'Valor';
    valueScore.detail = `Desvio: ${(totalDev * 100).toFixed(0)}%`;
    dimensions.push(valueScore);

    let totalScore = 0;
    dimensions.forEach(d => { totalScore += d.raw; });
    totalScore = Math.round(totalScore / dimensions.length);
    totalScore = Math.min(100, Math.max(10, totalScore));

    const matrix = dimensions.map(d => ({
      label: d.label,
      score: Math.round(d.raw),
      visual: d.visual,
      detail: d.detail
    }));

    const sortedDesc = [...dimensions].sort((a, b) => b.raw - a.raw);
    const sortedAsc = [...dimensions].sort((a, b) => a.raw - b.raw);
    const topDim = sortedDesc[0];
    const lowDim = sortedAsc[0];

    let recommendation;
    if (totalScore >= 75) recommendation = `🟢 Forte — ${topDim.label} domina (${Math.round(topDim.raw)}%)`;
    else if (totalScore >= 55) recommendation = `🟡 Moderada — ${topDim.label} destaca (${Math.round(topDim.raw)}%)`;
    else recommendation = `🔴 Fraca — ${lowDim.label} limita (${Math.round(lowDim.raw)}%)`;

    const radar = dimensions.map(d => {
      const len = Math.round(d.raw / 10);
      return `${(d.label || '?').padEnd(12)} ${'█'.repeat(len)}${'░'.repeat(10 - len)} ${Math.round(d.raw)}%`;
    });

    return {
      dimensions: matrix,
      matrix,
      radar,
      score: totalScore,
      recommendation,
      topFactor: topDim.label,
      lowFactor: lowDim.label,
      totalResults: n
    };
  }

  function analiseCombinada(estatistica, padroes, temporal, previsao, cfg) {
    cfg = cfg || {};
    let score = 0;
    let factors = 0;

    if (previsao.score) { score += previsao.score; factors++; }

    if (padroes.detected) { score += padroes.detected * 10; factors++; }

    if (parseFloat(estatistica.chi2) > 5) { score += 15; factors++; }

    if (parseFloat(temporal.volatility) > 70) { score += 10; factors++; }

    score = factors > 0 ? Math.round(score / factors * 1.2) : 30;
    score = Math.min(100, Math.max(10, score));

    let recomendacao;
    if (score >= 75) recomendacao = '🟢 Forte';
    else if (score >= 50) recomendacao = '🟡 Moderada';
    else recomendacao = '🔴 Fraca';

    return { score, recomendacao, _cfg: cfg };
  }

  function gerarRelatorio(botId, results) {
    const bot = bots.get(botId);
    if (!bot) return null;

    const cfg = bot.config || {};
    const historico = analiseHistorico(results, bot.game, cfg.historico);
    const estatistica = analiseEstatistica(results, bot.game, cfg.estatistica);
    const padroes = analisePadroes(results, bot.game, cfg.padroes);
    const temporal = analiseTemporal(results, bot.game, cfg.temporal);
    const previsao = analisePrevisao(results, bot.game, cfg.previsao);
    const probabilidade = analiseProbabilidade(results, bot.game, cfg.probabilidade);
    const tendencia = analiseTendencia(results, bot.game, cfg.tendencia);
    const sequencia = analiseSequencia(results, bot.game, cfg.sequencia);
    const predAvancada = analisePredAvancada(results, bot.game, cfg.predAvancada);
    const anomalias = analiseAnomalias(results, bot.game, cfg.anomalias);
    const confluenciaIA = analiseConfluenciaIA(results, bot.game, cfg.confluenciaIA);
    const matrizTransicao = analiseMatrizTransicao(results, bot.game, cfg.matrizTransicao);
    const entropia = analiseEntropia(results, bot.game, cfg.entropia);
    const algoritmoGenetico = analiseAlgoritmoGenetico(results, bot.game, cfg.algoritmoGenetico);
    const multidimensional = analiseMultidimensional(results, bot.game, cfg.multidimensional);
    const combinada = analiseCombinada(estatistica, padroes, temporal, previsao, cfg.combinada);

    return {
      botId,
      botName: bot.name,
      game: bot.game,
      timestamp: new Date().toISOString(),
      historico,
      estatistica,
      padroes,
      temporal,
      previsao,
      probabilidade,
      tendencia,
      sequencia,
      predAvancada,
      anomalias,
      confluenciaIA,
      matrizTransicao,
      entropia,
      algoritmoGenetico,
      multidimensional,
      combinada
    };
  }

  const ALL_ANALISES = ['historico', 'estatistica', 'padroes', 'previsao', 'temporal', 'probabilidade', 'tendencia', 'sequencia', 'predAvancada', 'anomalias', 'confluenciaIA', 'matrizTransicao', 'entropia', 'algoritmoGenetico', 'multidimensional'];

  function migrateOldData() {
    const data = Store.get(STORAGE_KEY) || {};
    let changed = false;
    Object.entries(data).forEach(([id, config]) => {
      if (!config.analises) config.analises = [...ALL_ANALISES];
      ALL_ANALISES.forEach(a => {
        if (!config.analises.includes(a)) { config.analises.push(a); changed = true; }
      });
      if (!config.analiseOrder) {
        config.analiseOrder = config.analises ? [...config.analises] : [...ALL_ANALISES];
        changed = true;
      } else {
        ALL_ANALISES.forEach(a => {
          if (!config.analiseOrder.includes(a)) { config.analiseOrder.push(a); changed = true; }
        });
      }
      if (!config.config) config.config = {};
      const defaultConfigs = {
        estatistica: { showDistribution: true, showStreak: true, showMaxStreaks: true, maxStreakEntries: 3, showMostDelayed: true, showChi2: true, showStdDev: true },
        padroes: { showCorrelations: true },
        temporal: { showCycles: true, showPeriods: true, showVolatility: true },
        previsao: { showConfidence: true, showStreakInfluence: true },
        probabilidade: { showEdge: true, showRecomendacao: true },
        tendencia: { showPeriods: true },
        sequencia: { showTriplets: true, showAfterRules: true },
        predAvancada: { showModels: true, showConfidence: true },
        anomalias: { showSummary: true },
        confluenciaIA: { showRecommendation: true, showTopFactor: true },
        matrizTransicao: { showPrediction: true },
        entropia: { showDistribution: true, showAssessment: true },
        algoritmoGenetico: { showHistory: true, showTopRules: true },
        multidimensional: { showTopFactor: true, showLowFactor: true, showRecommendation: true },
        combinada: { showScore: true, showRecomendacao: true }
      };
      Object.entries(defaultConfigs).forEach(([section, defaults]) => {
        if (!config.config[section]) { config.config[section] = { ...defaults }; changed = true; }
      });
    });
    if (changed) Store.set(STORAGE_KEY, data);
  }

  function loadFromStorage() {
    migrateOldData();
    const data = Store.get(STORAGE_KEY) || {};
    Object.entries(data).forEach(([id, config]) => {
      const existing = bots.get(id);
      bots.set(id, {
        id,
        name: config.name,
        game: config.game,
        analises: config.analises || [...ALL_ANALISES],
        analiseOrder: config.analiseOrder || config.analises || [...ALL_ANALISES],
        intervalo: config.intervalo || 60,
        historico: config.historico || 100,
        telegramEnabled: config.telegramEnabled || false,
        telegramChannel: config.telegramChannel || null,
        config: config.config || {},
        status: config.status || (existing && existing.status) || 'offline',
        lastReport: config.lastReport || (existing && existing.lastReport) || null,
        messageId: config.messageId || (existing && existing.messageId) || null,
        createdAt: config.createdAt || Date.now()
      });
    });
  }

  function saveToStorage() {
    const existing = Store.get(STORAGE_KEY) || {};
    const data = {};
    bots.forEach((bot, id) => {
      const savedCfg = (existing[id] && existing[id].config) || {};
      const memCfg = bot.config && Object.keys(bot.config).length > 0 ? bot.config : {};
      data[id] = {
        ...existing[id],
        name: bot.name,
        game: bot.game,
        analises: bot.analises,
        analiseOrder: bot.analiseOrder,
        intervalo: bot.intervalo,
        historico: bot.historico,
        telegramEnabled: bot.telegramEnabled,
        telegramChannel: bot.telegramChannel,
        config: Object.keys(memCfg).length > 0 ? memCfg : savedCfg,
        status: bot.status,
        lastReport: bot.lastReport,
        messageId: bot.messageId,
        createdAt: bot.createdAt
      };
    });
    Store.set(STORAGE_KEY, data);
  }

  function init() {
    loadFromStorage();
    EventBus.on('result:new', handleNewResult);
    EventBus.on('results:history', handleHistory);
  }

  function handleNewResult(data) {
    bots.forEach((bot, id) => {
      if (bot.status !== 'online') return;
      if (bot.game !== data.game) return;
      processBotIfNeeded(id);
    });
  }

  function handleHistory(data) {
    bots.forEach((bot, id) => {
      if (bot.status !== 'online') return;
      if (bot.game !== data.game) return;
      processBotIfNeeded(id);
    });
  }

  const processTimers = {};

  function processBotIfNeeded(id) {
    const bot = bots.get(id);
    if (!bot || bot.status !== 'online') return;

    if (processTimers[id]) {
      clearTimeout(processTimers[id]);
    }

    processTimers[id] = setTimeout(() => {
      delete processTimers[id];
      if (!bot || bot.status !== 'online') return;

      const storageKey = `historico-${bot.game}-v1`;
      const allResults = localStorage.getItem(storageKey);
      const parsed = allResults ? JSON.parse(allResults) : [];
      const results = parsed.slice(0, bot.historico);

      if (results.length < 10) return;

      const allBots = Store.get(STORAGE_KEY) || {};
      if (allBots[id] && allBots[id].config) {
        bot.config = allBots[id].config;
      }

      const relatorio = gerarRelatorio(id, results);
      if (!relatorio) return;

      bot.lastReport = relatorio;
      saveToStorage();

      EventBus.emit('analisebot:updated', { botId: id, relatorio });
    }, 500);
  }

  function createBot(config) {
    const id = `${config.game}-analise-${slugify(config.name)}`;
    if (bots.has(id)) throw new Error('Já existe um robô com esse nome');

    const bot = {
      id,
      name: config.name,
      game: config.game,
      analises: config.analises || ['historico', 'estatistica', 'padroes', 'previsao'],
      analiseOrder: config.analiseOrder || config.analises || ['historico', 'estatistica', 'padroes', 'previsao'],
      intervalo: config.intervalo || 60,
      historico: config.historico || 100,
      telegramEnabled: config.telegramEnabled || false,
      telegramChannel: config.telegramChannel || null,
      config: config.config || {},
      status: 'offline',
      lastReport: null,
      messageId: null,
      createdAt: Date.now()
    };

    bots.set(id, bot);
    saveToStorage();
    EventBus.emit('analisebot:created', { botId: id });
    return id;
  }

  function getBot(id) {
    return bots.get(id) || null;
  }

  function getAllBots() {
    return Array.from(bots.values());
  }

  function updateBot(id, data) {
    const bot = bots.get(id);
    if (!bot) return false;
    const wasOnline = bot.status === 'online';
    Object.assign(bot, data);
    saveToStorage();
    if (wasOnline && intervalTimers[id]) {
      startBotInterval(id);
    }
    EventBus.emit('analisebot:updated', { botId: id });
    return true;
  }

  function deleteBot(id) {
    if (!bots.has(id)) return false;
    stopBot(id);
    bots.delete(id);
    saveToStorage();
    EventBus.emit('analisebot:deleted', { botId: id });
    return true;
  }

  function startBot(id) {
    const bot = bots.get(id);
    if (!bot) return false;
    bot.status = 'online';
    saveToStorage();
    processBotIfNeeded(id);
    startBotInterval(id);
    EventBus.emit('analisebot:started', { botId: id });
    return true;
  }

  const intervalTimers = {};

  function startBotInterval(id) {
    const bot = bots.get(id);
    if (!bot) return;
    if (intervalTimers[id]) clearInterval(intervalTimers[id]);
    intervalTimers[id] = setInterval(() => {
      if (bot.status !== 'online') {
        clearInterval(intervalTimers[id]);
        delete intervalTimers[id];
        return;
      }
      processBotIfNeeded(id);
    }, (bot.intervalo || 60) * 1000);
  }

  function stopBot(id) {
    const bot = bots.get(id);
    if (!bot) return false;
    bot.status = 'offline';
    if (processTimers[id]) { clearTimeout(processTimers[id]); delete processTimers[id]; }
    if (intervalTimers[id]) { clearInterval(intervalTimers[id]); delete intervalTimers[id]; }
    saveToStorage();
    EventBus.emit('analisebot:stopped', { botId: id });
    return true;
  }

  function syncFromStorage() {
    loadFromStorage();
    bots.forEach((bot, id) => {
      if (bot.status === 'online' && !intervalTimers[id]) {
        processBotIfNeeded(id);
        startBotInterval(id);
      }
    });
  }

  init();

  return {
    createBot,
    getBot,
    getAllBots,
    updateBot,
    deleteBot,
    startBot,
    stopBot,
    syncFromStorage,
    processBotIfNeeded,
    gerarRelatorio,
    analiseHistorico,
    analiseEstatistica,
    analisePadroes,
    analiseTemporal,
    analisePrevisao,
    analiseProbabilidade,
    analiseTendencia,
    analiseSequencia,
    analisePredAvancada,
    analiseAnomalias,
    analiseConfluenciaIA,
    analiseMatrizTransicao,
    analiseEntropia,
    analiseAlgoritmoGenetico,
    analiseMultidimensional,
    analiseCombinada,
    COLOR_LABELS
  };
})();
