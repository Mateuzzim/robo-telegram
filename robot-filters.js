const RobotFilters = (() => {

  const ALL_FILTERS = {
    frequencia:           { label: 'Frequencia',              group: 'estatistico',   desc: 'Mede frequencia de cor/numero/terminal na janela' },
    repeticaoExcessiva:   { label: 'Repeticao Excessiva',    group: 'estatistico',   desc: 'Bloqueia sinais baseados em repeticao excessiva' },
    sequenciaEsticada:    { label: 'Sequencia Esticada',      group: 'estatistico',   desc: 'Evita perseguir sequencias longas da mesma cor' },
    recencia:             { label: 'Recencia',                group: 'temporal',      desc: 'Verifica ha quantas rodadas o resultado apareceu' },
    distanciaOcorrencias: { label: 'Distancia Ocorrencias',   group: 'temporal',      desc: 'Intervalo entre aparecimentos do mesmo resultado' },
    janelaCurtaLonga:     { label: 'Janela Curta x Longa',   group: 'comparativo',   desc: 'Comportamento recente vs janela maior' },
    tendencia:            { label: 'Tendencia',               group: 'tendencia',     desc: 'Aumento de frequencia nas rodadas recentes' },
    quebraTendencia:      { label: 'Quebra de Tendencia',     group: 'tendencia',     desc: 'Tendencia que perdeu forca ou mudou' },
    alternancia:          { label: 'Alternancia',             group: 'padrao',        desc: 'Padroes de alternancia V-P-V-P' },
    concentracao:         { label: 'Concentracao',            group: 'distribuicao',  desc: 'Muitos resultados concentrados em mesma cor' },
    dispersao:            { label: 'Dispersao',               group: 'distribuicao',  desc: 'Resultados muito espalhados, sem padrao' },
    atraso:               { label: 'Atraso',                  group: 'estatistico',   desc: 'Rodadas sem aparecer determinado resultado' },
    padraoRecorrente:     { label: 'Padrao Recorrente',       group: 'padrao',        desc: 'Sequencias anteriores semelhantes a atual' },
    transicao:            { label: 'Transicao',               group: 'markov',        desc: 'Resultados que costumam vir depois de outro' },
    matrizTransicao:      { label: 'Matriz Transicao',        group: 'markov',        desc: 'Tabela completa de transicoes entre cores' },
    probabilidadeCond:    { label: 'Prob. Condicional',       group: 'markov',        desc: 'Frequencia considerando condicao anterior' },
    entropia:             { label: 'Entropia',                group: 'complexidade',  desc: 'Nivel de desorganizacao dos resultados' },
    volatilidade:         { label: 'Volatilidade',            group: 'complexidade',  desc: 'Mudanca rapida de comportamento' },
    consenso:             { label: 'Consenso Estrategias',    group: 'qualidade',     desc: 'Libera sinal quando 2+ analises concordam' },
    divergencia:          { label: 'Divergencia Estrategias', group: 'qualidade',     desc: 'Bloqueia quando metodos apontam resultados diferentes' },
    scoreMinimo:          { label: 'Score Minimo',            group: 'sinal',         desc: 'Sinal ultrapassa valor minimo (75/100)' },
    confiancaMinima:      { label: 'Confianca Minima',        group: 'sinal',         desc: 'Nivel minimo de confianca antes do sinal' },
    diferencaCandidatos:  { label: 'Diferenca 1-2 Candidato', group: 'sinal',         desc: 'Bloqueia quando 1o e 2o candidato muito proximos' },
    multiCriterios:       { label: 'Multi Criterios',         group: 'sinal',         desc: 'Sinal sustentado por varios fatores' },
    cooldown:             { label: 'Cooldown',                group: 'operacional',   desc: 'Espera N rodadas antes de novo sinal' },
    posWin:               { label: 'Pos-Win',                 group: 'operacional',   desc: 'Controle de entrada apos WIN' },
    posLoss:              { label: 'Pos-Loss',                group: 'operacional',   desc: 'Pausa ou exige mais apos LOSS' },
    lossConsecutivo:      { label: 'Loss Consecutivo',        group: 'operacional',   desc: 'Interrompe sinais apos N losses seguidos' },
    qualidadeAmostra:     { label: 'Qualidade Amostra',       group: 'robustez',      desc: 'Impede analise com poucos resultados' },
    antiOverfitting:      { label: 'Anti-Overfitting',        group: 'robustez',      desc: 'Valida padrao em multiplas janelas' }
  };

  function countColors(history, n) {
    const counts = {};
    const slice = history.slice(0, n);
    for (const r of slice) {
      const c = String(r.cellColor || r.color || '').toLowerCase();
      counts[c] = (counts[c] || 0) + 1;
    }
    return counts;
  }

  function getColors(history, n) {
    return history.slice(0, n).map(r => String(r.cellColor || r.color || '').toLowerCase());
  }

  function getNumbers(history, n) {
    return history.slice(0, n).map(r => r.cellIndex ?? r.number ?? null);
  }

  function getMultipliers(history, n) {
    return history.slice(0, n).map(r => r.multiplier || null);
  }

  function calcEntropy(colors) {
    const total = colors.length;
    if (!total) return 0;
    const counts = {};
    for (const c of colors) counts[c] = (counts[c] || 0) + 1;
    let h = 0;
    for (const c of Object.values(counts)) {
      const p = c / total;
      if (p > 0) h -= p * Math.log2(p);
    }
    const maxH = Math.log2(Object.keys(counts).length || 1);
    return maxH > 0 ? Math.round((h / maxH) * 100) : 0;
  }

  function calcMovingWindow(colors, shortN, longN) {
    const short = colors.slice(0, shortN);
    const long = colors.slice(0, longN);
    const shortDist = {};
    const longDist = {};
    for (const c of short) shortDist[c] = (shortDist[c] || 0) + 1;
    for (const c of long) longDist[c] = (longDist[c] || 0) + 1;
    let totalDiff = 0;
    const allColors = new Set([...Object.keys(shortDist), ...Object.keys(longDist)]);
    for (const c of allColors) {
      const sPct = (shortDist[c] || 0) / short.length * 100;
      const lPct = (longDist[c] || 0) / long.length * 100;
      totalDiff += Math.abs(sPct - lPct);
    }
    return { shortDist, longDist, totalDiff: Math.round(totalDiff / 2) };
  }

  function evaluateFilter(key, history, signal, robot) {
    if (!history || history.length < 3) {
      return { passed: true, score: 50, reason: 'historico insuficiente' };
    }

    const colors = getColors(history, 100);
    const numbers = getNumbers(history, 100);
    const mults = getMultipliers(history, 100);
    const target = String(signal?.target || '').toLowerCase();
    const n = Math.min(history.length, robot.resultsToAnalyze || 40);
    const recentColors = colors.slice(0, n);

    switch (key) {

      case 'frequencia': {
        const counts = countColors(history, n);
        const targetCount = counts[target] || 0;
        const pct = Math.round((targetCount / n) * 100);
        const expected = 33;
        const deviation = Math.abs(pct - expected);
        return {
          passed: pct >= 15 && deviation <= 35,
          score: Math.max(10, 80 - deviation),
          reason: `${target}: ${pct}% na janela (${n}rd)`,
          detail: { pct, expected, deviation }
        };
      }

      case 'repeticaoExcessiva': {
        let streak = 0;
        for (const c of recentColors) {
          if (c === target) streak++;
          else break;
        }
        const blocked = streak >= 4;
        return {
          passed: !blocked,
          score: blocked ? 15 : Math.max(40, 90 - streak * 15),
          reason: streak >= 4 ? `${target} repetiu ${streak}x seguidas` : `${target}: streak de ${streak}`,
          detail: { streak, blocked }
        };
      }

      case 'sequenciaEsticada': {
        let maxRun = 0, curRun = 0, lastColor = '';
        for (const c of recentColors) {
          if (c === lastColor) { curRun++; } else { curRun = 1; lastColor = c; }
          if (curRun > maxRun) maxRun = curRun;
        }
        const longRun = maxRun >= 5;
        return {
          passed: !longRun,
          score: longRun ? 20 : Math.max(50, 95 - maxRun * 8),
          reason: longRun ? `Sequencia longa detectada: ${maxRun}x` : `Max run: ${maxRun}x`,
          detail: { maxRun, longRun }
        };
      }

      case 'recencia': {
        let lastSeen = n;
        for (let i = 0; i < n; i++) {
          if (recentColors[i] === target) { lastSeen = i; break; }
        }
        const fresh = lastSeen <= 2;
        return {
          passed: true,
          score: fresh ? 40 : Math.min(95, 30 + lastSeen * 3),
          reason: `${target} visto ha ${lastSeen}rd`,
          detail: { lastSeen, fresh }
        };
      }

      case 'distanciaOcorrencias': {
        const positions = [];
        for (let i = 0; i < n; i++) {
          if (recentColors[i] === target) positions.push(i);
        }
        if (positions.length < 2) {
          return { passed: true, score: 50, reason: `${target}: apenas ${positions.length} ocorrencias`, detail: { positions, gaps: [] } };
        }
        const gaps = [];
        for (let i = 1; i < positions.length; i++) gaps.push(positions[i] - positions[i - 1]);
        const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        const consistent = gaps.every(g => Math.abs(g - avgGap) <= 2);
        return {
          passed: consistent,
          score: consistent ? 75 : Math.max(30, 70 - Math.abs(gaps[gaps.length - 1] - avgGap) * 5),
          reason: `Intervalo medio: ${avgGap.toFixed(1)}rd${consistent ? ' (consistente)' : ' (irregular)'}`,
          detail: { positions, gaps, avgGap, consistent }
        };
      }

      case 'janelaCurtaLonga': {
        const w = calcMovingWindow(colors, 10, Math.min(n, 30));
        const aligned = w.totalDiff <= 15;
        return {
          passed: aligned,
          score: aligned ? 75 : Math.max(25, 70 - w.totalDiff),
          reason: aligned ? 'Curta e longa alinhadas' : `Divergencia: ${w.totalDiff}%`,
          detail: w
        };
      }

      case 'tendencia': {
        const half = Math.floor(n / 2);
        const firstHalf = recentColors.slice(half);
        const secondHalf = recentColors.slice(0, half);
        const fCount = firstHalf.filter(c => c === target).length;
        const sCount = secondHalf.filter(c => c === target).length;
        const fPct = Math.round((fCount / (firstHalf.length || 1)) * 100);
        const sPct = Math.round((sCount / (secondHalf.length || 1)) * 100);
        const rising = sPct > fPct && (sPct - fPct) >= 10;
        return {
          passed: true,
          score: rising ? 75 : 45,
          reason: `${target}: ${fPct}% -> ${sPct}% ${rising ? '(subindo)' : '(estavel)'}`,
          detail: { firstHalfPct: fPct, secondHalfPct: sPct, rising }
        };
      }

      case 'quebraTendencia': {
        const q1 = colors.slice(0, Math.floor(n * 0.25));
        const q2 = colors.slice(Math.floor(n * 0.25), Math.floor(n * 0.5));
        const c1 = q1.filter(c => c === target).length / (q1.length || 1);
        const c2 = q2.filter(c => c === target).length / (q2.length || 1);
        const broke = c1 > 0.3 && c2 < 0.1 && (c1 - c2) > 0.2;
        return {
          passed: !broke,
          score: broke ? 25 : 65,
          reason: broke ? `${target} perdeu tendencia (${(c1*100).toFixed(0)}% -> ${(c2*100).toFixed(0)}%)` : 'Sem quebra detectada',
          detail: { q1Pct: c1, q2Pct: c2, broke }
        };
      }

      case 'alternancia': {
        let altCount = 0;
        for (let i = 1; i < Math.min(n, 10); i++) {
          if (recentColors[i] !== recentColors[i - 1]) altCount++;
        }
        const ratio = altCount / Math.max(Math.min(n, 10) - 1, 1);
        const strong = ratio >= 0.7;
        return {
          passed: true,
          score: strong ? 70 : 40,
          reason: `Alternancia: ${(ratio * 100).toFixed(0)}% das transicoes`,
          detail: { altCount, ratio, strong }
        };
      }

      case 'concentracao': {
        const counts = countColors(history, n);
        const maxCount = Math.max(...Object.values(counts));
        const dominant = Object.entries(counts).find(([, v]) => v === maxCount)?.[0];
        const pct = Math.round((maxCount / n) * 100);
        const concentrated = pct >= 60;
        return {
          passed: true,
          score: concentrated ? 35 : 65,
          reason: concentrated ? `${dominant} dominando: ${pct}%` : 'Distribuicao equilibrada',
          detail: { dominant, pct, concentrated, counts }
        };
      }

      case 'dispersao': {
        const counts = countColors(history, n);
        const unique = Object.keys(counts).length;
        const tooScattered = unique >= 5 || (n >= 10 && Object.values(counts).every(c => c <= 2));
        return {
          passed: !tooScattered,
          score: tooScattered ? 30 : 60,
          reason: tooScattered ? `${unique} cores distintas, alta dispersao` : 'Padrao identificavel',
          detail: { unique, tooScattered }
        };
      }

      case 'atraso': {
        let lastSeen = n;
        for (let i = 0; i < n; i++) {
          if (recentColors[i] === target) { lastSeen = i; break; }
        }
        const delayed = lastSeen >= Math.floor(n * 0.6);
        return {
          passed: true,
          score: delayed ? 70 : 45,
          reason: `${target} atrasado: ${lastSeen}rd sem aparecer`,
          detail: { lastSeen, delayed }
        };
      }

      case 'padraoRecorrente': {
        const patLen = Math.min(5, Math.floor(n / 3));
        if (patLen < 2) return { passed: true, score: 50, reason: 'Padrao curto demais', detail: {} };
        const currentPat = recentColors.slice(0, patLen).join('-');
        let matches = 0, goodFollow = 0;
        for (let i = patLen; i <= n - patLen; i++) {
          const slice = recentColors.slice(i, i + patLen).join('-');
          if (slice === currentPat) {
            matches++;
            if (i > 0 && recentColors[i - 1] === target) goodFollow++;
          }
        }
        const found = matches >= 2;
        return {
          passed: true,
          score: found ? 70 : 40,
          reason: found ? `Padrao "${currentPat}" encontrado ${matches}x (${goodFollow}x seguido de ${target})` : `Padrao "${currentPat}" raro`,
          detail: { currentPat, matches, goodFollow }
        };
      }

      case 'transicao': {
        const lastColor = recentColors[0] || '';
        const transCounts = {};
        for (let i = 1; i < n; i++) {
          const from = recentColors[i];
          const to = recentColors[i - 1];
          const key = `${from}->${to}`;
          transCounts[key] = (transCounts[key] || 0) + 1;
        }
        const fromLast = recentColors[1] || '';
        const transKey = `${fromLast}->${lastColor}`;
        const totalFrom = Object.entries(transCounts).filter(([k]) => k.startsWith(fromLast + '->')).reduce((s, [, v]) => s + v, 0);
        const toTarget = transCounts[`${lastColor}->${target}`] || 0;
        const prob = totalFrom > 0 ? Math.round((toTarget / totalFrom) * 100) : 0;
        return {
          passed: true,
          score: prob >= 40 ? 70 : 40,
          reason: `${lastColor} -> ${target}: ${prob}% (${toTarget}/${totalFrom})`,
          detail: { lastColor, target, prob, transCounts }
        };
      }

      case 'matrizTransicao': {
        const matrix = {};
        for (let i = 1; i < n; i++) {
          const from = recentColors[i];
          const to = recentColors[i - 1];
          if (!matrix[from]) matrix[from] = {};
          matrix[from][to] = (matrix[from][to] || 0) + 1;
        }
        const lastColor = recentColors[0] || '';
        const row = matrix[lastColor] || {};
        const total = Object.values(row).reduce((s, v) => s + v, 0);
        const targetCount = row[target] || 0;
        const prob = total > 0 ? Math.round((targetCount / total) * 100) : 0;
        return {
          passed: true,
          score: prob >= 35 ? 65 : 35,
          reason: `Matriz: ${lastColor}->${target} = ${prob}% (${targetCount}/${total})`,
          detail: { matrix, lastColor, target, prob }
        };
      }

      case 'probabilidadeCond': {
        const condColor = recentColors[1] || '';
        let total = 0, matchCond = 0;
        for (let i = 1; i < n; i++) {
          if (recentColors[i] === condColor) {
            total++;
            if (recentColors[i - 1] === target) matchCond++;
          }
        }
        const prob = total > 0 ? Math.round((matchCond / total) * 100) : 0;
        return {
          passed: true,
          score: prob >= 40 ? 65 : 35,
          reason: `P(${target} | ${condColor}) = ${prob}%`,
          detail: { condColor, prob, total, matchCond }
        };
      }

      case 'entropia': {
        const ent = calcEntropy(colors.slice(0, n));
        const lowEntropy = ent <= 60;
        return {
          passed: lowEntropy,
          score: lowEntropy ? 70 : Math.max(25, 80 - ent),
          reason: `Entropia: ${ent}/100${lowEntropy ? ' (padrao detectavel)' : ' (caotico)'}`,
          detail: { entropy: ent, lowEntropy }
        };
      }

      case 'volatilidade': {
        const win = 5;
        const changes = [];
        for (let i = 0; i <= n - win; i++) {
          const slice = colors.slice(i, i + win);
          const counts = {};
          for (const c of slice) counts[c] = (counts[c] || 0) + 1;
          const dominant = Math.max(...Object.values(counts));
          changes.push(dominant / win);
        }
        const avg = changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length : 0.5;
        const variance = changes.length ? changes.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / changes.length : 0;
        const volatil = variance > 0.05;
        return {
          passed: !volatil,
          score: volatil ? 30 : 65,
          reason: volatil ? `Volatilidade alta (var: ${variance.toFixed(3)})` : `Volatilidade baixa (var: ${variance.toFixed(3)})`,
          detail: { variance, avg, volatil }
        };
      }

      case 'consenso': {
        const scores = Object.values(robot.diagnostic?.patternScores || {});
        const highScores = scores.filter(s => s >= 60).length;
        const consensus = highScores >= 2;
        return {
          passed: consensus,
          score: consensus ? 80 : Math.max(30, 30 + highScores * 20),
          reason: consensus ? `${highScores} estrategias concordando` : `Apenas ${highScores} estrategia(s)`,
          detail: { highScores, consensus, total: scores.length }
        };
      }

      case 'divergencia': {
        const scores = Object.values(robot.diagnostic?.patternScores || {});
        if (scores.length < 2) return { passed: true, score: 50, reason: 'Poucas estrategias para avaliar', detail: {} };
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        const variance = scores.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / scores.length;
        const divergent = variance > 400;
        return {
          passed: !divergent,
          score: divergent ? 25 : 70,
          reason: divergent ? `Alta divergencia (var: ${variance.toFixed(0)})` : `Convergencia (var: ${variance.toFixed(0)})`,
          detail: { variance, avg, divergent }
        };
      }

      case 'scoreMinimo': {
        const score = robot.diagnostic?.signalScore || 0;
        const minReq = robot.minScore || 75;
        return {
          passed: score >= minReq,
          score: score >= minReq ? 75 : score,
          reason: `Score: ${score}/${minReq}`,
          detail: { score, minReq }
        };
      }

      case 'confiancaMinima': {
        const conf = signal?.confidence || 0;
        const minConf = robot.minimumConfidence || 80;
        return {
          passed: conf >= minConf,
          score: conf >= minConf ? 75 : conf,
          reason: `Confianca: ${conf}%/${minConf}%`,
          detail: { conf, minConf }
        };
      }

      case 'diferencaCandidatos': {
        const scores = Object.values(robot.diagnostic?.patternScores || {}).sort((a, b) => b - a);
        if (scores.length < 2) return { passed: true, score: 50, reason: 'Menos de 2 candidatos', detail: {} };
        const diff = scores[0] - scores[1];
        const blocked = diff < 5;
        return {
          passed: !blocked,
          score: blocked ? 20 : Math.min(80, 50 + diff * 3),
          reason: blocked ? `Diferenca minima: ${diff}pts` : `Diferenca: ${diff}pts`,
          detail: { diff, first: scores[0], second: scores[1], blocked }
        };
      }

      case 'multiCriterios': {
        const filterResults = robot.diagnostic?.filterResults || {};
        const passedCount = Object.values(filterResults).filter(v => v === true).length;
        const totalFilters = Object.keys(filterResults).length || 1;
        const ratio = passedCount / totalFilters;
        const multi = ratio >= 0.6;
        return {
          passed: multi,
          score: multi ? 75 : Math.round(ratio * 100),
          reason: `${passedCount}/${totalFilters} filtros passaram (${(ratio*100).toFixed(0)}%)`,
          detail: { passedCount, totalFilters, ratio, multi }
        };
      }

      case 'cooldown': {
        const lastTime = robot.lastSignalTime || 0;
        const intervalMs = (robot.intervalMin || 60) * 1000;
        const elapsed = Date.now() - lastTime;
        const ready = elapsed >= intervalMs;
        return {
          passed: ready,
          score: ready ? 70 : Math.round((elapsed / intervalMs) * 100),
          reason: ready ? 'Cooldown respeitado' : `Cooldown: ${Math.round((intervalMs - elapsed) / 1000)}s restantes`,
          detail: { elapsed, intervalMs, ready }
        };
      }

      case 'posWin': {
        const lastWin = robot.stats?.wins || 0;
        const lastLoss = robot.stats?.losses || 0;
        const lastSignalWasWin = robot.lastSignal?.status === 'win';
        if (!lastSignalWasWin) return { passed: true, score: 60, reason: 'Ultimo sinal nao foi WIN', detail: { lastSignalWasWin: false } };
        return {
          passed: true,
          score: 50,
          reason: 'WIN recente, entrada liberada',
          detail: { lastSignalWasWin: true }
        };
      }

      case 'posLoss': {
        const currentStreak = robot.stats?.currentStreak || 0;
        const afterLoss = currentStreak < 0;
        return {
          passed: !afterLoss || currentStreak >= -1,
          score: afterLoss ? Math.max(20, 60 + currentStreak * 10) : 60,
          reason: afterLoss ? `Loss recente: streak ${currentStreak}` : 'Sem loss recente',
          detail: { currentStreak, afterLoss }
        };
      }

      case 'lossConsecutivo': {
        const maxLosses = robot.gale?.max > 0 ? robot.gale.max + 1 : 3;
        const currentStreak = robot.stats?.currentStreak || 0;
        const consecutiveLosses = currentStreak < 0 ? Math.abs(currentStreak) : 0;
        const blocked = consecutiveLosses >= maxLosses;
        return {
          passed: !blocked,
          score: blocked ? 10 : Math.max(40, 80 - consecutiveLosses * 15),
          reason: blocked ? `${consecutiveLosses} losses consecutivos (limite: ${maxLosses})` : `${consecutiveLosses} losses consecutivos`,
          detail: { consecutiveLosses, maxLosses, blocked }
        };
      }

      case 'qualidadeAmostra': {
        const available = history.length;
        const required = Math.max(15, robot.resultsToAnalyze || 40);
        const ratio = available / required;
        const ok = ratio >= 0.75;
        return {
          passed: ok,
          score: ok ? 70 : Math.round(ratio * 100),
          reason: `${available}/${required} resultados disponiveis`,
          detail: { available, required, ratio, ok }
        };
      }

      case 'antiOverfitting': {
        const winSize = Math.floor(n / 3);
        if (winSize < 5) return { passed: true, score: 50, reason: 'Janela pequena para validacao', detail: {} };
        const windows = [];
        for (let i = 0; i + winSize <= n; i += winSize) {
          windows.push(colors.slice(i, i + winSize));
        }
        let consistentWindows = 0;
        for (const w of windows) {
          const counts = {};
          for (const c of w) counts[c] = (counts[c] || 0) + 1;
          const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
          if (top && top[0] === target && top[1] / w.length >= 0.3) consistentWindows++;
        }
        const valid = consistentWindows >= Math.ceil(windows.length * 0.5);
        return {
          passed: valid,
          score: valid ? 70 : 35,
          reason: valid ? `${consistentWindows}/${windows.length} janelas validam padrao` : `Apenas ${consistentWindows}/${windows.length} janelas`,
          detail: { windows: windows.length, consistentWindows, valid }
        };
      }

      default:
        return { passed: true, score: 50, reason: 'Filtro desconhecido', detail: {} };
    }
  }

  function runFilters(enabledFilters, history, signal, robot) {
    const results = {};
    let totalScore = 0;
    let passedCount = 0;
    let blocked = false;
    let blockReason = '';

    for (const key of enabledFilters) {
      if (!ALL_FILTERS[key]) continue;
      const result = evaluateFilter(key, history, signal, robot);
      results[key] = result;
      totalScore += result.score;
      if (result.passed) passedCount++;
      if (!result.passed && !blocked) {
        blocked = true;
        blockReason = result.reason;
      }
    }

    const total = enabledFilters.length || 1;
    const avgScore = Math.round(totalScore / total);

    return {
      results,
      avgScore,
      passedCount,
      totalFilters: total,
      passRate: Math.round((passedCount / total) * 100),
      blocked,
      blockReason
    };
  }

  return {
    ALL_FILTERS,
    evaluateFilter,
    runFilters,
    getFilterGroups() {
      const groups = {};
      for (const [key, f] of Object.entries(ALL_FILTERS)) {
        if (!groups[f.group]) groups[f.group] = [];
        groups[f.group].push({ key, ...f });
      }
      return groups;
    },
    getDefaultFilters() {
      return Object.keys(ALL_FILTERS);
    }
  };
})();
