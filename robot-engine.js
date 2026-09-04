const RobotEngine = {
  robots: new Map(),

  strategies: {
    alternancia(history, _target, patternSize) {
      const ps = patternSize || 5;
      const window = ps * 5;
      if (history.length < Math.min(10, window)) return { matched: false, confidence: 0, reason: 'Historico insuficiente' };
      const colors = history.slice(0, window).map(r => r.color);
      let changes = 0;
      for (let i = 0; i < colors.length - 1; i++) { if (colors[i] !== colors[i + 1]) changes++; }
      const score = Math.round((changes / (colors.length - 1)) * 100);
      const last = colors[0];
      const allColors = [...new Set(colors)];
      const others = allColors.filter(c => c !== last);
      const target = others.length ? others[0] : (last === 'RED' ? 'BLACK' : 'RED');
      return { matched: score >= 60, target, confidence: score, pattern: colors.slice(0, ps), reason: score >= 60 ? 'Alternancia identificada' : 'Alternancia fraca' };
    },
    repeticao(history, _target, patternSize) {
      const ps = patternSize || 5;
      const window = ps * 6;
      if (history.length < Math.min(10, window)) return { matched: false, confidence: 0, reason: 'Historico insuficiente' };
      const colors = history.slice(0, window).map(r => r.color);
      const last = colors[0];
      let count = 0;
      for (const c of colors) { if (c === last) count++; else break; }
      const score = count >= 3 ? Math.min(90, 50 + count * 10) : 0;
      const colorLabels = { RED: 'VERMELHO', BLACK: 'PRETO', GREY: 'PRETO', BLUE: 'AZUL', GREEN: 'VERDE' };
      const others = Object.keys(colorLabels).filter(c => c !== last && c !== 'GREY');
      const target = others.length ? others[0] : (last === 'RED' ? 'BLACK' : 'RED');
      return { matched: score >= 60, target, confidence: score, pattern: colors.slice(0, ps), reason: count >= 3 ? `Repeticao ${count}x ${colorLabels[last] || last}` : 'Sem repeticao' };
    },
    frequencia(history, _target, patternSize) {
      const ps = patternSize || 1;
      const window = ps * 10;
      if (history.length < Math.min(5, window)) return { matched: false, confidence: 0, reason: 'Historico insuficiente' };
      const colors = history.slice(0, window).map(r => r.color);
      const freq = {};
      colors.forEach(c => { freq[c] = (freq[c] || 0) + 1; });
      const total = colors.length;
      const sorted = Object.entries(freq).sort((a, b) => a[1] - b[1]);
      const rare = sorted[0];
      const most = sorted[sorted.length - 1];
      const expected = total / Object.keys(freq).length;
      const deviation = most ? Math.round(((most[1] - rare[1]) / total) * 100) : 0;
      const score = Math.min(95, Math.round(deviation * 2.5));
      const colorLabels = { RED: 'VERMELHO', BLACK: 'PRETO', GREY: 'PRETO', BLUE: 'AZUL', GREEN: 'VERDE' };
      return { matched: score >= 50, target: rare ? rare[0] : 'RED', confidence: score, pattern: colors.slice(0, ps), reason: score >= 50 ? `${colorLabels[rare[0]] || rare[0]} atrasado (${rare[1]}x/${total})` : 'Frequencia equilibrada' };
    },
    tendencia(history, _target, patternSize) {
      const ps = patternSize || 5;
      const window = ps * 5;
      if (history.length < Math.min(15, window)) return { matched: false, confidence: 0, reason: 'Historico insuficiente' };
      const colors = history.slice(0, window).map(r => r.color);
      let streak = 1;
      for (let i = 1; i < colors.length; i++) { if (colors[i] === colors[0]) streak++; else break; }
      const score = streak >= 3 ? Math.min(85, 40 + streak * 12) : 0;
      const colorLabels = { RED: 'VERMELHO', BLACK: 'PRETO', GREY: 'PRETO', BLUE: 'AZUL', GREEN: 'VERDE' };
      const allColors = [...new Set(colors)];
      const others = allColors.filter(c => c !== colors[0]);
      const target = others.length ? others[0] : (colors[0] === 'RED' ? 'BLACK' : 'RED');
      return { matched: score >= 60, target, confidence: score, pattern: colors.slice(0, ps), reason: streak >= 3 ? `Tendencia ${colorLabels[colors[0]] || colors[0]} x${streak}` : 'Sem tendencia' };
    },
    espelhamento(history, _target, patternSize) {
      const ps = patternSize || 5;
      const window = ps * 8;
      if (history.length < Math.min(20, window)) return { matched: false, confidence: 0, reason: 'Historico insuficiente' };
      const colors = history.slice(0, window).map(r => r.color);
      const half = Math.floor(colors.length / 2);
      const first = colors.slice(0, half), second = colors.slice(half, half * 2);
      let m = 0;
      const len = Math.min(first.length, second.length);
      for (let i = 0; i < len; i++) { if (first[i] === second[i]) m++; }
      const score = Math.round((m / len) * 100);
      const allColors = [...new Set(colors)];
      const others = allColors.filter(c => c !== colors[0]);
      const target = others.length ? others[0] : (colors[0] === 'RED' ? 'BLACK' : 'RED');
      return { matched: score >= 55, target, confidence: score, pattern: first.slice(0, ps), reason: score >= 55 ? 'Espelhamento detectado' : 'Sem espelhamento' };
    },
    diagonal(history, _target, patternSize) {
      const ps = patternSize || 6;
      const window = ps * 5;
      if (history.length < Math.min(15, window)) return { matched: false, confidence: 0, reason: 'Historico insuficiente' };
      const colors = history.slice(0, window).map(r => r.color);
      let d = 0;
      for (let i = 0; i < Math.min(10, colors.length - 2); i++) {
        if (colors[i] !== colors[i + 1] && colors[i + 1] !== colors[i + 2]) d++;
      }
      const score = Math.round((d / 8) * 100);
      const allColors = [...new Set(colors)];
      const others = allColors.filter(c => c !== colors[0]);
      const target = others.length ? others[0] : (colors[0] === 'RED' ? 'BLACK' : 'RED');
      return { matched: score >= 60, target, confidence: Math.min(score, 95), pattern: colors.slice(0, ps), reason: score >= 60 ? 'Diagonal detectada' : 'Sem diagonal' };
    },

    padroesCores(history, target, patternSize) {
      const pSize = patternSize || 3;
      if (history.length < Math.max(pSize + 1, 5)) return { matched: false, confidence: 0, reason: 'Historico insuficiente' };
      
      const rawTargetColor = target?.color || 'any';
      const targetMult = target?.multiplier || null;
      const colors = [];
      const multis = [];
      for (let i = 0; i < history.length; i++) {
        colors.push(history[i].color);
        multis.push(history[i].multiplier);
      }
      const now = Date.now();
      
      const isMultiTarget = rawTargetColor.includes('+');
      const effectiveTarget = (rawTargetColor === 'any' || isMultiTarget) ? 'any' : rawTargetColor;
      const allowedColors = isMultiTarget ? rawTargetColor.split('+').map(c => c.toUpperCase()) : null;
      
      const colorLabels = { RED: 'VERMELHO', BLACK: 'PRETO', GREY: 'PRETO', BLUE: 'AZUL', GREEN: 'VERDE' };
      const analyses = [];
      
      const seqMap = {};
      for (let i = 0; i <= colors.length - pSize; i++) {
        let seq = colors[i];
        for (let j = 1; j < pSize; j++) seq += '-' + colors[i + j];
        if (!seqMap[seq]) seqMap[seq] = { count: 0, wins: 0, lastPos: i };
        seqMap[seq].count++;
        const nextIdx = i + pSize;
        if (nextIdx < colors.length) {
          if (effectiveTarget === 'any' || colors[nextIdx] === effectiveTarget) {
            seqMap[seq].wins++;
          }
        }
      }
      
      let bestScore = 0;
      let bestData = null;
      for (const [seq, d] of Object.entries(seqMap)) {
        if (d.count < 2) continue;
        const winRate = (d.wins / d.count) * 100;
        const recency = Math.max(0, 100 - d.lastPos * 2);
        const score = Math.round(winRate * 0.7 + recency * 0.3);
        if (score > bestScore) {
          bestScore = score;
          bestData = { seq: seq.split('-'), wins: d.wins, total: d.count, winRate: Math.round(winRate) };
        }
      }
      if (bestData) {
        analyses.push({ type: 'sequencia', score: bestScore, detail: `Seq ${bestData.wins}x/${bestData.total} (${bestData.winRate}%)`, pattern: bestData.seq });
      }
      
      let altCount = 0;
      const checkLen = Math.min(20, colors.length);
      for (let i = 0; i < checkLen - 1; i++) {
        if (colors[i] !== colors[i + 1]) altCount++;
      }
      const altScore = Math.round((altCount / Math.max(checkLen - 1, 1)) * 100);
      let streak = 1;
      for (let i = 1; i < checkLen; i++) {
        if (colors[i] === colors[0]) streak++; else break;
      }
      if (altScore >= 70 && streak <= 1) {
        analyses.push({ type: 'alternado', score: altScore, detail: `Alternancia ${altScore}%`, target: colors[0] === 'RED' ? 'BLACK' : 'RED' });
      }
      
      const freq = {};
      for (let i = 0; i < colors.length; i++) freq[colors[i]] = (freq[colors[i]] || 0) + 1;
      const sorted = Object.entries(freq).sort((a, b) => a[1] - b[1]);
      if (sorted.length > 0) {
        const [rare, rareCount] = sorted[0];
        const expected = colors.length / Object.keys(freq).length;
        const dev = Math.round(((expected - rareCount) / expected) * 100);
        if (dev >= 30) {
          analyses.push({ type: 'atrasada', score: Math.min(90, 50 + dev), detail: `${colorLabels[rare] || rare} atrasada ${rareCount}x`, target: rare });
        }
      }
      
      if (targetMult) {
        const mData = {};
        for (let i = 0; i < colors.length; i++) {
          const m = multis[i];
          if (!m) continue;
          if (!mData[m]) mData[m] = { total: 0, wins: {} };
          mData[m].total++;
          mData[m].wins[colors[i]] = (mData[m].wins[colors[i]] || 0) + 1;
        }
        const md = mData[targetMult];
        if (md && md.total >= 3) {
          const best = Object.entries(md.wins).sort((a, b) => b[1] - a[1])[0];
          if (best) {
            const wr = Math.round((best[1] / md.total) * 100);
            if (wr >= 55) analyses.push({ type: 'multiplier', score: wr, detail: `${targetMult}X: ${colorLabels[best[0]] || best[0]} ${wr}%`, target: best[0] });
          }
        }
      }
      
      for (let cycle = 2; cycle <= Math.min(6, Math.floor(colors.length / 3)); cycle++) {
        let matches = 0;
        let total = 0;
        const ref = colors.slice(0, cycle);
        for (let i = cycle; i <= colors.length - cycle; i += cycle) {
          total++;
          let ok = true;
          for (let j = 0; j < cycle; j++) {
            if (colors[i + j] !== ref[j]) { ok = false; break; }
          }
          if (ok) matches++;
        }
        if (total >= 2) {
          const mr = Math.round((matches / total) * 100);
          if (mr >= 60) analyses.push({ type: 'ciclo', score: mr, detail: `Ciclo ${cycle}: ${matches}x/${total}`, pattern: ref });
        }
      }
      
      if (colors.length >= pSize + 1) {
        const curSeq = colors.slice(0, pSize).join('-');
        const posList = seqMap[curSeq];
        if (posList && posList.count >= 2) {
          let breaks = 0;
          for (let i = 0; i < Math.min(posList.count - 1, 5); i++) {
            const p1 = i * pSize;
            const p2 = (i + 1) * pSize;
            if (p1 + pSize < colors.length && p2 + pSize < colors.length) {
              if (colors[p1 + pSize] !== colors[p2 + pSize]) breaks++;
            }
          }
          if (breaks > 0) {
            const br = Math.round((breaks / Math.min(posList.count - 1, 5)) * 100);
            analyses.push({ type: 'distorcao', score: Math.min(85, 50 + br), detail: `Distorcao ${br}% - ${breaks} quebras` });
          }
        }
      }
      
      const confluences = analyses.filter(a => a.score >= 60).length;
      if (confluences >= 2) {
        analyses.push({ type: 'confluencia', score: Math.min(95, confluences * 25), detail: `${confluences} padroes concordando` });
      }
      
      const valid = analyses.filter(a => a.score >= 50);
      if (valid.length === 0) {
        const bestAny = analyses.length > 0 ? analyses.sort((a, b) => b.score - a.score)[0] : null;
        return {
          matched: false,
          target: bestAny?.target || (colors[0] === 'RED' ? 'BLACK' : 'RED'),
          confidence: bestAny ? Math.max(10, Math.round(bestAny.score * 0.6)) : 0,
          pattern: bestAny?.pattern || colors.slice(0, pSize),
          reason: bestAny ? `${bestAny.type.toUpperCase()}: ${bestAny.detail}` : 'Nenhum padrao detectado',
          analyses: analyses.slice(0, 5),
          confluences,
          lastAnalysis: now
        };
      }
      
      valid.sort((a, b) => b.score - a.score);
      const best = valid[0];
      
      let suggested;
      if (effectiveTarget !== 'any') suggested = effectiveTarget;
      else if (best.target) suggested = best.target;
      else if (best.pattern) suggested = best.pattern[best.pattern.length - 1] === 'RED' ? 'BLACK' : 'RED';
      else suggested = 'RED';
      
      if (allowedColors && !allowedColors.includes(suggested)) suggested = allowedColors[0];
      
      return {
        matched: best.score >= 55,
        target: suggested,
        confidence: Math.min(95, Math.max(10, best.score)),
        pattern: best.pattern || colors.slice(0, pSize),
        reason: `${best.type.toUpperCase()}: ${best.detail}`,
        analyses: valid.slice(0, 5),
        confluences,
        lastAnalysis: now
      };
    },

    cicloVerde(history, _target, _patternSize) {
      if (history.length < 20) return { matched: false, confidence: 0, reason: 'Historico insuficiente (min 20)' };
      
      const colors = history.map(r => r.color);
      const greenPositions = [];
      for (let i = 0; i < colors.length; i++) {
        if (colors[i] === 'GREEN') greenPositions.push(i);
      }
      
      if (greenPositions.length < 2) {
        return { matched: false, target: 'GREEN', confidence: 0, reason: `Apenas ${greenPositions.length} verde(s) encontrado(s)` };
      }
      
      const intervals = [];
      for (let i = 1; i < greenPositions.length; i++) {
        intervals.push(greenPositions[i] - greenPositions[i - 1]);
      }
      
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const lastGreenPos = greenPositions[0];
      const currentDelay = lastGreenPos;
      
      const expectedNext = avgInterval - currentDelay;
      const delayRatio = currentDelay / avgInterval;
      
      let confidence = 0;
      let reason = '';
      
      if (delayRatio >= 1.2) {
        confidence = Math.min(85, Math.round(50 + (delayRatio - 1) * 40));
        reason = `Verde atrasado: ${Math.round(currentDelay)} vs media ${Math.round(avgInterval)} (${Math.round(delayRatio * 100)}%)`;
      } else if (delayRatio >= 0.8) {
        confidence = Math.round(40 + (delayRatio - 0.5) * 30);
        reason = `Proximo do ciclo: ${Math.round(currentDelay)} vs media ${Math.round(avgInterval)}`;
      } else {
        confidence = Math.round(20 + delayRatio * 20);
        reason = `Ciclo recente: ${Math.round(currentDelay)} vs media ${Math.round(avgInterval)}`;
      }
      
      const stdDev = Math.sqrt(intervals.reduce((sum, i) => sum + Math.pow(i - avgInterval, 2), 0) / intervals.length);
      const consistency = Math.max(0, 100 - (stdDev / avgInterval) * 100);
      confidence = Math.round(confidence * (consistency / 100) * 0.3 + confidence * 0.7);
      
      return {
        matched: confidence >= 55,
        target: 'GREEN',
        confidence,
        pattern: greenPositions.slice(0, 5),
        reason,
        analyses: [
          { type: 'ciclo', score: confidence, detail: `Media: ${Math.round(avgInterval)} | Atual: ${Math.round(currentDelay)} | Ratio: ${Math.round(delayRatio * 100)}%` }
        ],
        confluences: confidence >= 60 ? 1 : 0,
        lastAnalysis: Date.now()
      };
    },

    convergencia(history, _target, _patternSize) {
      if (history.length < 30) return { matched: false, confidence: 0, reason: 'Historico insuficiente (min 30)' };
      
      const colors = history.map(r => r.color);
      const analyses = [];
      
      let streak = 1;
      for (let i = 1; i < Math.min(20, colors.length); i++) {
        if (colors[i] === colors[0]) streak++; else break;
      }
      if (streak >= 3) {
        const score = Math.min(80, 40 + streak * 10);
        analyses.push({ type: 'streak', score, detail: `Streak ${colors[0]} x${streak}`, target: colors[0] === 'RED' ? 'BLACK' : 'RED' });
      }
      
      const freq = {};
      for (let i = 0; i < Math.min(50, colors.length); i++) freq[colors[i]] = (freq[colors[i]] || 0) + 1;
      const sorted = Object.entries(freq).sort((a, b) => a[1] - b[1]);
      if (sorted.length > 0) {
        const [rare, rareCount] = sorted[0];
        const total = colors.length;
        const expected = total / Object.keys(freq).length;
        const deviation = Math.round(((expected - rareCount) / expected) * 100);
        if (deviation >= 40) {
          analyses.push({ type: 'atraso', score: Math.min(85, 50 + deviation), detail: `${rare} atrasado (${rareCount}x/${total})`, target: rare });
        }
      }
      
      let alternations = 0;
      for (let i = 0; i < Math.min(15, colors.length - 1); i++) {
        if (colors[i] !== colors[i + 1]) alternations++;
      }
      const altRate = alternations / Math.min(14, colors.length - 1);
      if (altRate >= 0.7) {
        analyses.push({ type: 'alternancia', score: Math.round(altRate * 100), detail: `Alternancia ${Math.round(altRate * 100)}%`, target: colors[0] === 'RED' ? 'BLACK' : 'RED' });
      }
      
      const greenPositions = [];
      for (let i = 0; i < Math.min(100, colors.length); i++) {
        if (colors[i] === 'GREEN') greenPositions.push(i);
      }
      if (greenPositions.length >= 2) {
        const intervals = [];
        for (let i = 1; i < greenPositions.length; i++) {
          intervals.push(greenPositions[i] - greenPositions[i - 1]);
        }
        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const currentDelay = greenPositions[0];
        const delayRatio = currentDelay / avgInterval;
        if (delayRatio >= 1.3) {
          analyses.push({ type: 'cicloVerde', score: Math.min(80, 50 + (delayRatio - 1) * 30), detail: `Verde atrasado ${Math.round(delayRatio * 100)}%`, target: 'GREEN' });
        }
      }
      
      const valid = analyses.filter(a => a.score >= 50);
      if (valid.length === 0) {
        return { matched: false, target: 'RED', confidence: 0, reason: 'Nenhuma convergencia detectada' };
      }
      
      valid.sort((a, b) => b.score - a.score);
      const best = valid[0];
      const confluences = valid.filter(a => a.score >= 60).length;
      
      return {
        matched: best.score >= 55,
        target: best.target || 'RED',
        confidence: Math.min(90, Math.round(best.score * (1 + confluences * 0.1))),
        pattern: colors.slice(0, 5),
        reason: `${best.type.toUpperCase()}: ${best.detail}${confluences > 1 ? ` (${confluences} convergencias)` : ''}`,
        analyses: valid.slice(0, 5),
        confluences,
        lastAnalysis: Date.now()
      };
    },

    cicloZero(history, _target, _patternSize) {
      if (history.length < 20) return { matched: false, confidence: 0, reason: 'Historico insuficiente (min 20)' };
      
      const numbers = history.map(r => r.number ?? r.cellIndex ?? -1);
      const zeroPositions = [];
      for (let i = 0; i < numbers.length; i++) {
        if (numbers[i] === 0) zeroPositions.push(i);
      }
      
      if (zeroPositions.length < 2) {
        return { matched: false, target: 'GREEN', confidence: 0, reason: `Apenas ${zeroPositions.length} zero(s) encontrado(s)` };
      }
      
      const intervals = [];
      for (let i = 1; i < zeroPositions.length; i++) {
        intervals.push(zeroPositions[i] - zeroPositions[i - 1]);
      }
      
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const lastZeroPos = zeroPositions[0];
      const currentDelay = lastZeroPos;
      
      const delayRatio = currentDelay / avgInterval;
      
      let confidence = 0;
      let reason = '';
      
      if (delayRatio >= 1.2) {
        confidence = Math.min(85, Math.round(50 + (delayRatio - 1) * 40));
        reason = `Zero atrasado: ${Math.round(currentDelay)} vs media ${Math.round(avgInterval)} (${Math.round(delayRatio * 100)}%)`;
      } else if (delayRatio >= 0.8) {
        confidence = Math.round(40 + (delayRatio - 0.5) * 30);
        reason = `Proximo do ciclo: ${Math.round(currentDelay)} vs media ${Math.round(avgInterval)}`;
      } else {
        confidence = Math.round(20 + delayRatio * 20);
        reason = `Ciclo recente: ${Math.round(currentDelay)} vs media ${Math.round(avgInterval)}`;
      }
      
      const stdDev = Math.sqrt(intervals.reduce((sum, i) => sum + Math.pow(i - avgInterval, 2), 0) / intervals.length);
      const consistency = Math.max(0, 100 - (stdDev / avgInterval) * 100);
      confidence = Math.round(confidence * (consistency / 100) * 0.3 + confidence * 0.7);
      
      return {
        matched: confidence >= 55,
        target: 'GREEN',
        confidence,
        pattern: zeroPositions.slice(0, 5),
        reason,
        analyses: [
          { type: 'ciclo', score: confidence, detail: `Media: ${Math.round(avgInterval)} | Atual: ${Math.round(currentDelay)} | Ratio: ${Math.round(delayRatio * 100)}%` }
        ],
        confluences: confidence >= 60 ? 1 : 0,
        lastAnalysis: Date.now()
      };
    },

    padraoNumerico(history, _target, _patternSize) {
      if (history.length < 15) return { matched: false, confidence: 0, reason: 'Historico insuficiente (min 15)' };
      
      const numbers = history.map(r => r.number ?? r.cellIndex ?? -1);
      const zeroPositions = [];
      for (let i = 0; i < numbers.length; i++) {
        if (numbers[i] === 0) zeroPositions.push(i);
      }
      
      if (zeroPositions.length < 2) {
        return { matched: false, target: 'GREEN', confidence: 0, reason: `Apenas ${zeroPositions.length} zero(s) encontrado(s)` };
      }
      
      const beforeZeros = [];
      for (const pos of zeroPositions) {
        if (pos >= 3) {
          beforeZeros.push([numbers[pos - 1], numbers[pos - 2], numbers[pos - 3]]);
        }
      }
      
      if (beforeZeros.length < 2) {
        return { matched: false, target: 'GREEN', confidence: 0, reason: 'Dados insuficientes antes dos zeros' };
      }
      
      const currentSequence = numbers.slice(0, 3);
      
      let matchCount = 0;
      for (const seq of beforeZeros) {
        if (seq[0] === currentSequence[0] && seq[1] === currentSequence[1]) matchCount++;
      }
      
      let confidence = 0;
      let reason = '';
      
      if (matchCount >= 2) {
        confidence = Math.min(85, Math.round(50 + matchCount * 15));
        reason = `Padrao numerico detectado: ${currentSequence.join(',')} - ${matchCount} ocorrencia(s) antes de zero`;
      } else {
        const highLowMatch = beforeZeros.filter(seq => {
          const isHigh = seq[0] >= 8;
          return isHigh === (currentSequence[0] >= 8);
        }).length;
        
        if (highLowMatch >= Math.ceil(beforeZeros.length * 0.7)) {
          confidence = Math.round(40 + highLowMatch * 5);
          reason = `Zeros apos numeros ${currentSequence[0] >= 8 ? 'altos (8-14)' : 'baixos (1-7)'}: ${highLowMatch}x/${beforeZeros.length}`;
        } else {
          confidence = Math.round(20 + (matchCount * 10));
          reason = `Padrao fraco: ${matchCount} matches diretos`;
        }
      }
      
      const consecutiveHigh = numbers.slice(0, 5).filter(n => n >= 8).length;
      const consecutiveLow = numbers.slice(0, 5).filter(n => n >= 1 && n <= 7).length;
      
      if (consecutiveHigh >= 4 && currentSequence[0] >= 8) {
        confidence = Math.min(80, confidence + 15);
        reason += ` | Sequencia alta x${consecutiveHigh}`;
      } else if (consecutiveLow >= 4 && currentSequence[0] <= 7) {
        confidence = Math.min(80, confidence + 15);
        reason += ` | Sequencia baixa x${consecutiveLow}`;
      }
      
      return {
        matched: confidence >= 55,
        target: 'GREEN',
        confidence,
        pattern: currentSequence,
        reason,
        analyses: [
          { type: 'numerico', score: confidence, detail: `Seq atual: ${currentSequence.join(',')} | Matches: ${matchCount}/${beforeZeros.length}` }
        ],
        confluences: confidence >= 60 ? 1 : 0,
        lastAnalysis: Date.now()
      };
    },

    sequenciaNegra(history, _target, _patternSize) {
      if (history.length < 20) return { matched: false, confidence: 0, reason: 'Historico insuficiente (min 20)' };
      
      const colors = history.map(r => r.color);
      const numbers = history.map(r => r.number ?? r.cellIndex ?? -1);
      
      const isBlack = (c) => c === 'BLACK';
      const isRed = (c) => c === 'RED';
      const isGreen = (c) => c === 'GREEN';
      
      const analyses = [];
      
      let redStreak = 0;
      for (let i = 0; i < Math.min(20, colors.length); i++) {
        if (isRed(colors[i])) redStreak++;
        else break;
      }
      if (redStreak >= 2) {
        const score = Math.min(85, 45 + redStreak * 12);
        analyses.push({ type: 'reacaoVermelho', score, detail: `${redStreak} vermelhos seguidos - preto reativo`, target: 'BLACK' });
      }
      
      if (colors[0] === 'GREEN' || (numbers[0] === 0)) {
        const greenFollowedByBlack = [];
        for (let i = 0; i < Math.min(100, colors.length - 1); i++) {
          if (isGreen(colors[i]) && i + 1 < colors.length) {
            greenFollowedByBlack.push(isBlack(colors[i + 1]));
          }
        }
        if (greenFollowedByBlack.length >= 2) {
          const blackRate = greenFollowedByBlack.filter(Boolean).length / greenFollowedByBlack.length;
          if (blackRate >= 0.5) {
            const score = Math.round(50 + blackRate * 30);
            analyses.push({ type: 'aposVerde', score, detail: `Apos verde: ${Math.round(blackRate * 100)}% preto (${greenFollowedByBlack.filter(Boolean).length}x/${greenFollowedByBlack.length})`, target: 'BLACK' });
          }
        }
      }
      
      let blackStreak = 0;
      for (let i = 0; i < Math.min(10, colors.length); i++) {
        if (isBlack(colors[i])) blackStreak++;
        else break;
      }
      if (blackStreak >= 3) {
        const score = Math.min(75, 40 + blackStreak * 10);
        analyses.push({ type: 'momentoForte', score, detail: `Sequencia preta ativa x${blackStreak}`, target: 'BLACK' });
      }
      
      const last5Colors = colors.slice(0, 5);
      const last5Numbers = numbers.slice(0, 5);
      const highInLast5 = last5Numbers.filter(n => n >= 8).length;
      const lowInLast5 = last5Numbers.filter(n => n >= 1 && n <= 7).length;
      
      if (highInLast5 >= 3 && lowInLast5 <= 1) {
        const score = Math.round(55 + highInLast5 * 5);
        analyses.push({ type: 'zonaAlta', score, detail: `Zona alta dominante: ${highInLast5}/5 numeros altos (8-14)`, target: 'BLACK' });
      }
      
      const transitions = {};
      for (let i = 0; i < Math.min(50, colors.length - 1); i++) {
        const from = colors[i];
        const to = colors[i + 1];
        const key = `${from}->${to}`;
        transitions[key] = (transitions[key] || 0) + 1;
      }
      
      const redToBlack = transitions['RED->BLACK'] || 0;
      const redToAny = Object.entries(transitions).filter(([k]) => k.startsWith('RED->')).reduce((sum, [, v]) => sum + v, 0);
      if (redToAny >= 5) {
        const rate = redToBlack / redToAny;
        if (rate >= 0.4) {
          const score = Math.round(50 + rate * 35);
          analyses.push({ type: 'transicao', score, detail: `Transicao RED->BLACK: ${Math.round(rate * 100)}% (${redToBlack}x/${redToAny})`, target: 'BLACK' });
        }
      }
      
      const valid = analyses.filter(a => a.score >= 50);
      if (valid.length === 0) {
        return { matched: false, target: 'BLACK', confidence: 0, reason: 'Nenhum padrao preto detectado' };
      }
      
      valid.sort((a, b) => b.score - a.score);
      const best = valid[0];
      const confluences = valid.filter(a => a.score >= 60).length;
      
      return {
        matched: best.score >= 55,
        target: 'BLACK',
        confidence: Math.min(90, Math.round(best.score * (1 + confluences * 0.08))),
        pattern: colors.slice(0, 5),
        reason: `${best.type.toUpperCase()}: ${best.detail}${confluences > 1 ? ` (${confluences} sinais)` : ''}`,
        analyses: valid.slice(0, 5),
        confluences,
        lastAnalysis: Date.now()
      };
    },

    momentumPreto(history, _target, _patternSize) {
      if (history.length < 30) return { matched: false, confidence: 0, reason: 'Historico insuficiente (min 30)' };
      
      const colors = history.map(r => r.color);
      const numbers = history.map(r => r.number ?? r.cellIndex ?? -1);
      
      const isBlack = (c) => c === 'BLACK';
      
      const analyses = [];
      
      const expectedBlackRate = 7 / 15;
      
      const windows = [10, 15, 20, 30];
      for (const w of windows) {
        const windowColors = colors.slice(0, w);
        const blackCount = windowColors.filter(isBlack).length;
        const actualRate = blackCount / w;
        const deviation = (expectedBlackRate - actualRate) / expectedBlackRate;
        
        if (deviation >= 0.3) {
          const score = Math.min(85, Math.round(50 + deviation * 40));
          analyses.push({ type: 'frequencia', score, detail: `Preto frio: ${blackCount}/${w} (${Math.round(actualRate * 100)}%) vs ${Math.round(expectedBlackRate * 100)}%`, target: 'BLACK', window: w });
        }
      }
      
      let consecutiveNonBlack = 0;
      for (let i = 0; i < Math.min(30, colors.length); i++) {
        if (!isBlack(colors[i])) consecutiveNonBlack++;
        else break;
      }
      
      if (consecutiveNonBlack >= 3) {
        const expectedInRow = Math.pow(1 - expectedBlackRate, consecutiveNonBlack);
        const probability = 1 - expectedInRow;
        const score = Math.min(80, Math.round(probability * 100));
        analyses.push({ type: 'ausencia', score, detail: `${consecutiveNonBlack} resultados sem preto - probabilidade ${Math.round(probability * 100)}%`, target: 'BLACK' });
      }
      
      const segments = [];
      const segSize = 5;
      for (let i = 0; i < Math.min(50, colors.length); i += segSize) {
        const seg = colors.slice(i, i + segSize);
        const blackInSeg = seg.filter(isBlack).length;
        segments.push(blackInSeg);
      }
      
      if (segments.length >= 3) {
        const trend = segments[0] - segments[segments.length - 1];
        if (trend >= 2) {
          const score = Math.round(55 + trend * 8);
          analyses.push({ type: 'tendencia', score, detail: `Tendencia de alta: ${segments[0]}->${segments[segments.length - 1]} preto por bloco`, target: 'BLACK' });
        } else if (trend <= -2) {
          const score = Math.round(55 + Math.abs(trend) * 8);
          analyses.push({ type: 'reversao', score, detail: `Reversao iminente: ${segments[0]}->${segments[segments.length - 1]} - preto voltando`, target: 'BLACK' });
        }
      }
      
      const last10Numbers = numbers.slice(0, 10);
      const last10Colors = colors.slice(0, 10);
      const highNumbers = last10Numbers.filter(n => n >= 10);
      const veryHighNumbers = last10Numbers.filter(n => n >= 12);
      
      if (highNumbers.length >= 4 && veryHighNumbers.length >= 2) {
        const score = Math.round(60 + highNumbers.length * 3);
        analyses.push({ type: 'zonaCritica', score, detail: `Zona critica: ${highNumbers.length}/10 altos, ${veryHighNumbers.length}/10 muito altos`, target: 'BLACK' });
      }
      
      let blackStreak = 0;
      for (let i = 0; i < Math.min(5, colors.length); i++) {
        if (isBlack(colors[i])) blackStreak++;
        else break;
      }
      
      if (blackStreak >= 2) {
        const score = Math.round(55 + blackStreak * 8);
        analyses.push({ type: 'continuidade', score, detail: `Momentum preto ativo x${blackStreak}`, target: 'BLACK' });
      }
      
      const valid = analyses.filter(a => a.score >= 50);
      if (valid.length === 0) {
        return { matched: false, target: 'BLACK', confidence: 0, reason: 'Momentum preto fraco' };
      }
      
      valid.sort((a, b) => b.score - a.score);
      const best = valid[0];
      const confluences = valid.filter(a => a.score >= 60).length;
      
      let finalConfidence = Math.min(88, Math.round(best.score * (1 + confluences * 0.05)));
      
      return {
        matched: best.score >= 55,
        target: 'BLACK',
        confidence: finalConfidence,
        pattern: colors.slice(0, 5),
        reason: `${best.type.toUpperCase()}: ${best.detail}${confluences > 1 ? ` (${confluences} convergencias)` : ''}`,
        analyses: valid.slice(0, 5),
        confluences,
        lastAnalysis: Date.now()
      };
    },

    sequenciaVermelha(history, _target, _patternSize) {
      if (history.length < 20) return { matched: false, confidence: 0, reason: 'Historico insuficiente (min 20)' };
      
      const colors = history.map(r => r.color);
      const numbers = history.map(r => r.number ?? r.cellIndex ?? -1);
      
      const isBlack = (c) => c === 'BLACK';
      const isRed = (c) => c === 'RED';
      const isGreen = (c) => c === 'GREEN';
      
      const analyses = [];
      
      let blackStreak = 0;
      for (let i = 0; i < Math.min(20, colors.length); i++) {
        if (isBlack(colors[i])) blackStreak++;
        else break;
      }
      if (blackStreak >= 2) {
        const score = Math.min(85, 45 + blackStreak * 12);
        analyses.push({ type: 'reacaoPreto', score, detail: `${blackStreak} pretos seguidos - vermelho reativo`, target: 'RED' });
      }
      
      if (colors[0] === 'GREEN' || (numbers[0] === 0)) {
        const greenFollowedByRed = [];
        for (let i = 0; i < Math.min(100, colors.length - 1); i++) {
          if (isGreen(colors[i]) && i + 1 < colors.length) {
            greenFollowedByRed.push(isRed(colors[i + 1]));
          }
        }
        if (greenFollowedByRed.length >= 2) {
          const redRate = greenFollowedByRed.filter(Boolean).length / greenFollowedByRed.length;
          if (redRate >= 0.5) {
            const score = Math.round(50 + redRate * 30);
            analyses.push({ type: 'aposVerde', score, detail: `Apos verde: ${Math.round(redRate * 100)}% vermelho (${greenFollowedByRed.filter(Boolean).length}x/${greenFollowedByRed.length})`, target: 'RED' });
          }
        }
      }
      
      let redStreak = 0;
      for (let i = 0; i < Math.min(10, colors.length); i++) {
        if (isRed(colors[i])) redStreak++;
        else break;
      }
      if (redStreak >= 3) {
        const score = Math.min(75, 40 + redStreak * 10);
        analyses.push({ type: 'momentoForte', score, detail: `Sequencia vermelha ativa x${redStreak}`, target: 'RED' });
      }
      
      const last5Colors = colors.slice(0, 5);
      const last5Numbers = numbers.slice(0, 5);
      const lowInLast5 = last5Numbers.filter(n => n >= 1 && n <= 7).length;
      const highInLast5 = last5Numbers.filter(n => n >= 8).length;
      
      if (lowInLast5 >= 3 && highInLast5 <= 1) {
        const score = Math.round(55 + lowInLast5 * 5);
        analyses.push({ type: 'zonaBaixa', score, detail: `Zona baixa dominante: ${lowInLast5}/5 numeros baixos (1-7)`, target: 'RED' });
      }
      
      const transitions = {};
      for (let i = 0; i < Math.min(50, colors.length - 1); i++) {
        const from = colors[i];
        const to = colors[i + 1];
        const key = `${from}->${to}`;
        transitions[key] = (transitions[key] || 0) + 1;
      }
      
      const blackToRed = transitions['BLACK->RED'] || 0;
      const blackToAny = Object.entries(transitions).filter(([k]) => k.startsWith('BLACK->')).reduce((sum, [, v]) => sum + v, 0);
      if (blackToAny >= 5) {
        const rate = blackToRed / blackToAny;
        if (rate >= 0.4) {
          const score = Math.round(50 + rate * 35);
          analyses.push({ type: 'transicao', score, detail: `Transicao BLACK->RED: ${Math.round(rate * 100)}% (${blackToRed}x/${blackToAny})`, target: 'RED' });
        }
      }
      
      const valid = analyses.filter(a => a.score >= 50);
      if (valid.length === 0) {
        return { matched: false, target: 'RED', confidence: 0, reason: 'Nenhum padrao vermelho detectado' };
      }
      
      valid.sort((a, b) => b.score - a.score);
      const best = valid[0];
      const confluences = valid.filter(a => a.score >= 60).length;
      
      return {
        matched: best.score >= 55,
        target: 'RED',
        confidence: Math.min(90, Math.round(best.score * (1 + confluences * 0.08))),
        pattern: colors.slice(0, 5),
        reason: `${best.type.toUpperCase()}: ${best.detail}${confluences > 1 ? ` (${confluences} sinais)` : ''}`,
        analyses: valid.slice(0, 5),
        confluences,
        lastAnalysis: Date.now()
      };
    },

    momentumVermelho(history, _target, _patternSize) {
      if (history.length < 30) return { matched: false, confidence: 0, reason: 'Historico insuficiente (min 30)' };
      
      const colors = history.map(r => r.color);
      const numbers = history.map(r => r.number ?? r.cellIndex ?? -1);
      
      const isRed = (c) => c === 'RED';
      
      const analyses = [];
      
      const expectedRedRate = 7 / 15;
      
      const windows = [10, 15, 20, 30];
      for (const w of windows) {
        const windowColors = colors.slice(0, w);
        const redCount = windowColors.filter(isRed).length;
        const actualRate = redCount / w;
        const deviation = (expectedRedRate - actualRate) / expectedRedRate;
        
        if (deviation >= 0.3) {
          const score = Math.min(85, Math.round(50 + deviation * 40));
          analyses.push({ type: 'frequencia', score, detail: `Vermelho frio: ${redCount}/${w} (${Math.round(actualRate * 100)}%) vs ${Math.round(expectedRedRate * 100)}%`, target: 'RED', window: w });
        }
      }
      
      let consecutiveNonRed = 0;
      for (let i = 0; i < Math.min(30, colors.length); i++) {
        if (!isRed(colors[i])) consecutiveNonRed++;
        else break;
      }
      
      if (consecutiveNonRed >= 3) {
        const expectedInRow = Math.pow(1 - expectedRedRate, consecutiveNonRed);
        const probability = 1 - expectedInRow;
        const score = Math.min(80, Math.round(probability * 100));
        analyses.push({ type: 'ausencia', score, detail: `${consecutiveNonRed} resultados sem vermelho - probabilidade ${Math.round(probability * 100)}%`, target: 'RED' });
      }
      
      const segments = [];
      const segSize = 5;
      for (let i = 0; i < Math.min(50, colors.length); i += segSize) {
        const seg = colors.slice(i, i + segSize);
        const redInSeg = seg.filter(isRed).length;
        segments.push(redInSeg);
      }
      
      if (segments.length >= 3) {
        const trend = segments[0] - segments[segments.length - 1];
        if (trend >= 2) {
          const score = Math.round(55 + trend * 8);
          analyses.push({ type: 'tendencia', score, detail: `Tendencia de alta: ${segments[0]}->${segments[segments.length - 1]} vermelho por bloco`, target: 'RED' });
        } else if (trend <= -2) {
          const score = Math.round(55 + Math.abs(trend) * 8);
          analyses.push({ type: 'reversao', score, detail: `Reversao iminente: ${segments[0]}->${segments[segments.length - 1]} - vermelho voltando`, target: 'RED' });
        }
      }
      
      const last10Numbers = numbers.slice(0, 10);
      const lowNumbers = last10Numbers.filter(n => n >= 1 && n <= 4);
      const veryLowNumbers = last10Numbers.filter(n => n >= 1 && n <= 2);
      
      if (lowNumbers.length >= 4 && veryLowNumbers.length >= 2) {
        const score = Math.round(60 + lowNumbers.length * 3);
        analyses.push({ type: 'zonaCritica', score, detail: `Zona critica: ${lowNumbers.length}/10 baixos, ${veryLowNumbers.length}/10 muito baixos`, target: 'RED' });
      }
      
      let redStreak = 0;
      for (let i = 0; i < Math.min(5, colors.length); i++) {
        if (isRed(colors[i])) redStreak++;
        else break;
      }
      
      if (redStreak >= 2) {
        const score = Math.round(55 + redStreak * 8);
        analyses.push({ type: 'continuidade', score, detail: `Momentum vermelho ativo x${redStreak}`, target: 'RED' });
      }
      
      const valid = analyses.filter(a => a.score >= 50);
      if (valid.length === 0) {
        return { matched: false, target: 'RED', confidence: 0, reason: 'Momentum vermelho fraco' };
      }
      
      valid.sort((a, b) => b.score - a.score);
      const best = valid[0];
      const confluences = valid.filter(a => a.score >= 60).length;
      
      let finalConfidence = Math.min(88, Math.round(best.score * (1 + confluences * 0.05)));
      
      return {
        matched: best.score >= 55,
        target: 'RED',
        confidence: finalConfidence,
        pattern: colors.slice(0, 5),
        reason: `${best.type.toUpperCase()}: ${best.detail}${confluences > 1 ? ` (${confluences} convergencias)` : ''}`,
        analyses: valid.slice(0, 5),
        confluences,
        lastAnalysis: Date.now()
      };
    },

    cicloPreto(history, _target, _patternSize) {
      if (history.length < 20) return { matched: false, confidence: 0, reason: 'Historico insuficiente (min 20)' };
      
      const colors = history.map(r => r.color);
      const isBlack = (c) => c === 'BLACK' || c === 'GREY';
      
      const blackPositions = [];
      for (let i = 0; i < colors.length; i++) {
        if (isBlack(colors[i])) blackPositions.push(i);
      }
      
      if (blackPositions.length < 3) {
        return { matched: false, target: 'BLACK', confidence: 0, reason: `Apenas ${blackPositions.length} preto(s) encontrado(s)` };
      }
      
      const intervals = [];
      for (let i = 1; i < blackPositions.length; i++) {
        intervals.push(blackPositions[i] - blackPositions[i - 1]);
      }
      
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const currentDelay = blackPositions[0];
      const delayRatio = currentDelay / avgInterval;
      
      let confidence = 0;
      let reason = '';
      
      if (delayRatio >= 1.3) {
        confidence = Math.min(85, Math.round(55 + (delayRatio - 1) * 35));
        reason = `Preto atrasado: ${Math.round(currentDelay)} vs media ${Math.round(avgInterval)} (${Math.round(delayRatio * 100)}%)`;
      } else if (delayRatio >= 0.9) {
        confidence = Math.round(45 + (delayRatio - 0.5) * 25);
        reason = `Proximo do ciclo: ${Math.round(currentDelay)} vs media ${Math.round(avgInterval)}`;
      } else {
        confidence = Math.round(25 + delayRatio * 20);
        reason = `Ciclo recente: ${Math.round(currentDelay)} vs media ${Math.round(avgInterval)}`;
      }
      
      const stdDev = Math.sqrt(intervals.reduce((sum, i) => sum + Math.pow(i - avgInterval, 2), 0) / intervals.length);
      const consistency = Math.max(0, 100 - (stdDev / avgInterval) * 100);
      confidence = Math.round(confidence * (consistency / 100) * 0.3 + confidence * 0.7);
      
      return {
        matched: confidence >= 55,
        target: 'BLACK',
        confidence,
        pattern: blackPositions.slice(0, 5),
        reason,
        analyses: [
          { type: 'ciclo', score: confidence, detail: `Media: ${Math.round(avgInterval)} | Atual: ${Math.round(currentDelay)} | Ratio: ${Math.round(delayRatio * 100)}%` }
        ],
        confluences: confidence >= 60 ? 1 : 0,
        lastAnalysis: Date.now()
      };
    },

    reacaoPreto(history, _target, _patternSize) {
      if (history.length < 20) return { matched: false, confidence: 0, reason: 'Historico insuficiente (min 20)' };
      
      const colors = history.map(r => r.color);
      const isBlack = (c) => c === 'BLACK' || c === 'GREY';
      const isRed = (c) => c === 'RED';
      const isBlue = (c) => c === 'BLUE';
      const isGreen = (c) => c === 'GREEN';
      
      const analyses = [];
      
      let redStreak = 0;
      for (let i = 0; i < Math.min(15, colors.length); i++) {
        if (isRed(colors[i])) redStreak++;
        else break;
      }
      if (redStreak >= 2) {
        const score = Math.min(80, 45 + redStreak * 12);
        analyses.push({ type: 'reacaoVermelho', score, detail: `${redStreak} vermelhos seguidos - preto reativo`, target: 'BLACK' });
      }
      
      let blueStreak = 0;
      for (let i = 0; i < Math.min(10, colors.length); i++) {
        if (isBlue(colors[i])) blueStreak++;
        else break;
      }
      if (blueStreak >= 1) {
        const score = Math.min(75, 50 + blueStreak * 15);
        analyses.push({ type: 'reacaoAzul', score, detail: `${blueStreak} azul(es) - preto reativo`, target: 'BLACK' });
      }
      
      if (isGreen(colors[0])) {
        const greenFollowedByBlack = [];
        for (let i = 0; i < Math.min(100, colors.length - 1); i++) {
          if (isGreen(colors[i]) && i + 1 < colors.length) {
            greenFollowedByBlack.push(isBlack(colors[i + 1]));
          }
        }
        if (greenFollowedByBlack.length >= 2) {
          const blackRate = greenFollowedByBlack.filter(Boolean).length / greenFollowedByBlack.length;
          if (blackRate >= 0.5) {
            const score = Math.round(50 + blackRate * 30);
            analyses.push({ type: 'aposVerde', score, detail: `Apos verde: ${Math.round(blackRate * 100)}% preto`, target: 'BLACK' });
          }
        }
      }
      
      const last5Colors = colors.slice(0, 5);
      const nonBlackInLast5 = last5Colors.filter(c => !isBlack(c)).length;
      if (nonBlackInLast5 >= 3) {
        const score = Math.round(55 + nonBlackInLast5 * 5);
        analyses.push({ type: 'ausencia', score, detail: `${nonBlackInLast5}/5 nao-preto - revertendo`, target: 'BLACK' });
      }
      
      const valid = analyses.filter(a => a.score >= 50);
      if (valid.length === 0) {
        return { matched: false, target: 'BLACK', confidence: 0, reason: 'Nenhum padrao preto detectado' };
      }
      
      valid.sort((a, b) => b.score - a.score);
      const best = valid[0];
      const confluences = valid.filter(a => a.score >= 60).length;
      
      return {
        matched: best.score >= 55,
        target: 'BLACK',
        confidence: Math.min(90, Math.round(best.score * (1 + confluences * 0.08))),
        pattern: colors.slice(0, 5),
        reason: `${best.type.toUpperCase()}: ${best.detail}${confluences > 1 ? ` (${confluences} sinais)` : ''}`,
        analyses: valid.slice(0, 5),
        confluences,
        lastAnalysis: Date.now()
      };
    },

    cicloVermelho(history, _target, _patternSize) {
      if (history.length < 20) return { matched: false, confidence: 0, reason: 'Historico insuficiente (min 20)' };
      
      const colors = history.map(r => r.color);
      const isRed = (c) => c === 'RED';
      
      const redPositions = [];
      for (let i = 0; i < colors.length; i++) {
        if (isRed(colors[i])) redPositions.push(i);
      }
      
      if (redPositions.length < 3) {
        return { matched: false, target: 'RED', confidence: 0, reason: `Apenas ${redPositions.length} vermelho(s) encontrado(s)` };
      }
      
      const intervals = [];
      for (let i = 1; i < redPositions.length; i++) {
        intervals.push(redPositions[i] - redPositions[i - 1]);
      }
      
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const currentDelay = redPositions[0];
      const delayRatio = currentDelay / avgInterval;
      
      let confidence = 0;
      let reason = '';
      
      if (delayRatio >= 1.3) {
        confidence = Math.min(85, Math.round(55 + (delayRatio - 1) * 35));
        reason = `Vermelho atrasado: ${Math.round(currentDelay)} vs media ${Math.round(avgInterval)} (${Math.round(delayRatio * 100)}%)`;
      } else if (delayRatio >= 0.9) {
        confidence = Math.round(45 + (delayRatio - 0.5) * 25);
        reason = `Proximo do ciclo: ${Math.round(currentDelay)} vs media ${Math.round(avgInterval)}`;
      } else {
        confidence = Math.round(25 + delayRatio * 20);
        reason = `Ciclo recente: ${Math.round(currentDelay)} vs media ${Math.round(avgInterval)}`;
      }
      
      const stdDev = Math.sqrt(intervals.reduce((sum, i) => sum + Math.pow(i - avgInterval, 2), 0) / intervals.length);
      const consistency = Math.max(0, 100 - (stdDev / avgInterval) * 100);
      confidence = Math.round(confidence * (consistency / 100) * 0.3 + confidence * 0.7);
      
      return {
        matched: confidence >= 55,
        target: 'RED',
        confidence,
        pattern: redPositions.slice(0, 5),
        reason,
        analyses: [
          { type: 'ciclo', score: confidence, detail: `Media: ${Math.round(avgInterval)} | Atual: ${Math.round(currentDelay)} | Ratio: ${Math.round(delayRatio * 100)}%` }
        ],
        confluences: confidence >= 60 ? 1 : 0,
        lastAnalysis: Date.now()
      };
    },

    convergenciaVermelha(history, _target, _patternSize) {
      if (history.length < 25) return { matched: false, confidence: 0, reason: 'Historico insuficiente (min 25)' };
      
      const colors = history.map(r => r.color);
      const isRed = (c) => c === 'RED';
      const isBlack = (c) => c === 'BLACK' || c === 'GREY';
      
      const analyses = [];
      
      let blackStreak = 0;
      for (let i = 0; i < Math.min(15, colors.length); i++) {
        if (isBlack(colors[i])) blackStreak++;
        else break;
      }
      if (blackStreak >= 2) {
        const score = Math.min(80, 45 + blackStreak * 10);
        analyses.push({ type: 'reacaoPreto', score, detail: `${blackStreak} pretos seguidos - vermelho reativo`, target: 'RED' });
      }
      
      const freq = {};
      for (let i = 0; i < Math.min(50, colors.length); i++) freq[colors[i]] = (freq[colors[i]] || 0) + 1;
      const sorted = Object.entries(freq).sort((a, b) => a[1] - b[1]);
      const redCount = freq['RED'] || 0;
      const total = Math.min(50, colors.length);
      const expected = total / Object.keys(freq).length;
      const deviation = ((expected - redCount) / expected) * 100;
      
      if (deviation >= 30) {
        const score = Math.min(85, 50 + deviation);
        analyses.push({ type: 'atraso', score, detail: `Vermelho atrasado: ${redCount}x/${total} (${Math.round(deviation)}% abaixo)`, target: 'RED' });
      }
      
      let alternations = 0;
      for (let i = 0; i < Math.min(15, colors.length - 1); i++) {
        if (colors[i] !== colors[i + 1]) alternations++;
      }
      const altRate = alternations / Math.min(14, colors.length - 1);
      if (altRate >= 0.65) {
        analyses.push({ type: 'alternancia', score: Math.round(altRate * 100), detail: `Alternancia ${Math.round(altRate * 100)}%`, target: 'RED' });
      }
      
      const transitions = {};
      for (let i = 0; i < Math.min(40, colors.length - 1); i++) {
        const key = `${colors[i]}->RED`;
        transitions[key] = (transitions[key] || 0) + 1;
      }
      const blackToRed = transitions['BLACK->RED'] || 0;
      const blueToRed = transitions['BLUE->RED'] || 0;
      if (blackToRed >= 3 || blueToRed >= 2) {
        const score = Math.round(55 + (blackToRed + blueToRed) * 3);
        analyses.push({ type: 'transicao', score, detail: `Transicoes para vermelho: ${blackToRed}B->R, ${blueToRed}U->R`, target: 'RED' });
      }
      
      const valid = analyses.filter(a => a.score >= 50);
      if (valid.length === 0) {
        return { matched: false, target: 'RED', confidence: 0, reason: 'Nenhuma convergencia vermelha' };
      }
      
      valid.sort((a, b) => b.score - a.score);
      const best = valid[0];
      const confluences = valid.filter(a => a.score >= 60).length;
      
      return {
        matched: best.score >= 55,
        target: 'RED',
        confidence: Math.min(90, Math.round(best.score * (1 + confluences * 0.08))),
        pattern: colors.slice(0, 5),
        reason: `${best.type.toUpperCase()}: ${best.detail}${confluences > 1 ? ` (${confluences} convergencias)` : ''}`,
        analyses: valid.slice(0, 5),
        confluences,
        lastAnalysis: Date.now()
      };
    },

    cicloAzul(history, _target, _patternSize) {
      if (history.length < 25) return { matched: false, confidence: 0, reason: 'Historico insuficiente (min 25)' };
      
      const colors = history.map(r => r.color);
      const isBlue = (c) => c === 'BLUE';
      
      const bluePositions = [];
      for (let i = 0; i < colors.length; i++) {
        if (isBlue(colors[i])) bluePositions.push(i);
      }
      
      if (bluePositions.length < 2) {
        return { matched: false, target: 'BLUE', confidence: 0, reason: `Apenas ${bluePositions.length} azul(es) encontrado(s)` };
      }
      
      const intervals = [];
      for (let i = 1; i < bluePositions.length; i++) {
        intervals.push(bluePositions[i] - bluePositions[i - 1]);
      }
      
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const currentDelay = bluePositions[0];
      const delayRatio = currentDelay / avgInterval;
      
      let confidence = 0;
      let reason = '';
      
      if (delayRatio >= 1.4) {
        confidence = Math.min(85, Math.round(55 + (delayRatio - 1) * 30));
        reason = `Azul atrasado: ${Math.round(currentDelay)} vs media ${Math.round(avgInterval)} (${Math.round(delayRatio * 100)}%)`;
      } else if (delayRatio >= 1.0) {
        confidence = Math.round(45 + (delayRatio - 0.7) * 25);
        reason = `Proximo do ciclo: ${Math.round(currentDelay)} vs media ${Math.round(avgInterval)}`;
      } else {
        confidence = Math.round(20 + delayRatio * 20);
        reason = `Ciclo recente: ${Math.round(currentDelay)} vs media ${Math.round(avgInterval)}`;
      }
      
      const stdDev = Math.sqrt(intervals.reduce((sum, i) => sum + Math.pow(i - avgInterval, 2), 0) / intervals.length);
      const consistency = Math.max(0, 100 - (stdDev / avgInterval) * 100);
      confidence = Math.round(confidence * (consistency / 100) * 0.3 + confidence * 0.7);
      
      return {
        matched: confidence >= 55,
        target: 'BLUE',
        confidence,
        pattern: bluePositions.slice(0, 5),
        reason,
        analyses: [
          { type: 'ciclo', score: confidence, detail: `Media: ${Math.round(avgInterval)} | Atual: ${Math.round(currentDelay)} | Ratio: ${Math.round(delayRatio * 100)}%` }
        ],
        confluences: confidence >= 60 ? 1 : 0,
        lastAnalysis: Date.now()
      };
    },

    sequenciaAzul(history, _target, _patternSize) {
      if (history.length < 25) return { matched: false, confidence: 0, reason: 'Historico insuficiente (min 25)' };
      
      const colors = history.map(r => r.color);
      const numbers = history.map(r => r.number ?? r.cellIndex ?? -1);
      const isBlue = (c) => c === 'BLUE';
      const isGreen = (c) => c === 'GREEN';
      
      const analyses = [];
      
      const bluePositions = [];
      for (let i = 0; i < colors.length; i++) {
        if (isBlue(colors[i])) bluePositions.push(i);
      }
      
      if (bluePositions.length >= 2) {
        const beforeBlues = [];
        for (const pos of bluePositions) {
          if (pos >= 2) {
            beforeBlues.push([colors[pos - 1], colors[pos - 2]]);
          }
        }
        
        if (beforeBlues.length >= 2) {
          const currentPattern = colors.slice(0, 2);
          let matchCount = 0;
          for (const pattern of beforeBlues) {
            if (pattern[0] === currentPattern[0] && pattern[1] === currentPattern[1]) matchCount++;
          }
          
          if (matchCount >= 2) {
            const score = Math.min(80, 50 + matchCount * 12);
            analyses.push({ type: 'padrao', score, detail: `Padrao ${currentPattern.join('-')} precede azul: ${matchCount}x`, target: 'BLUE' });
          }
        }
      }
      
      if (isGreen(colors[0])) {
        const greenFollowedByBlue = [];
        for (let i = 0; i < Math.min(100, colors.length - 1); i++) {
          if (isGreen(colors[i]) && i + 1 < colors.length) {
            greenFollowedByBlue.push(isBlue(colors[i + 1]));
          }
        }
        if (greenFollowedByBlue.length >= 2) {
          const blueRate = greenFollowedByBlue.filter(Boolean).length / greenFollowedByBlue.length;
          if (blueRate >= 0.3) {
            const score = Math.round(50 + blueRate * 40);
            analyses.push({ type: 'aposVerde', score, detail: `Apos verde: ${Math.round(blueRate * 100)}% azul`, target: 'BLUE' });
          }
        }
      }
      
      const last10Numbers = numbers.slice(0, 10);
      const highNumbers = last10Numbers.filter(n => n >= 12);
      if (highNumbers.length >= 3) {
        const score = Math.round(55 + highNumbers.length * 5);
        analyses.push({ type: 'zonaAlta', score, detail: `Zona alta: ${highNumbers.length}/10 numeros altos (12+)`, target: 'BLUE' });
      }
      
      let consecutiveNonBlue = 0;
      for (let i = 0; i < Math.min(40, colors.length); i++) {
        if (!isBlue(colors[i])) consecutiveNonBlue++;
        else break;
      }
      
      if (consecutiveNonBlue >= 8) {
        const expectedInRow = Math.pow(1 - (2 / 14), consecutiveNonBlue);
        const probability = 1 - expectedInRow;
        const score = Math.min(75, Math.round(probability * 100));
        analyses.push({ type: 'ausencia', score, detail: `${consecutiveNonBlue} sem azul - probabilidade ${Math.round(probability * 100)}%`, target: 'BLUE' });
      }
      
      const valid = analyses.filter(a => a.score >= 50);
      if (valid.length === 0) {
        return { matched: false, target: 'BLUE', confidence: 0, reason: 'Nenhum padrao azul detectado' };
      }
      
      valid.sort((a, b) => b.score - a.score);
      const best = valid[0];
      const confluences = valid.filter(a => a.score >= 60).length;
      
      return {
        matched: best.score >= 55,
        target: 'BLUE',
        confidence: Math.min(90, Math.round(best.score * (1 + confluences * 0.08))),
        pattern: colors.slice(0, 5),
        reason: `${best.type.toUpperCase()}: ${best.detail}${confluences > 1 ? ` (${confluences} sinais)` : ''}`,
        analyses: valid.slice(0, 5),
        confluences,
        lastAnalysis: Date.now()
      };
    },

    divergenciaTemporal(history, _target, _patternSize) {
      if (history.length < 30) return { matched: false, confidence: 0, reason: 'Historico insuficiente (min 30)' };
      const colors = history.map(r => r.color);
      const calcRate = (arr, color) => arr.filter(c => c === color).length / arr.length;
      const windows = [
        { short: colors.slice(0, 5), long: colors.slice(0, 20), label: '5 vs 20' },
        { short: colors.slice(0, 10), long: colors.slice(0, 30), label: '10 vs 30' }
      ];
      const targetCandidates = ['RED', 'BLACK', 'GREEN', 'BLUE'];
      let bestScore = 0, bestTarget = 'RED', bestReason = '';
      for (const t of targetCandidates) {
        for (const w of windows) {
          const shortRate = calcRate(w.short, t);
          const longRate = calcRate(w.long, t);
          const divergencia = shortRate - longRate;
          if (Math.abs(divergencia) >= 0.15) {
            const score = Math.min(88, Math.round(50 + Math.abs(divergencia) * 150));
            const dir = divergencia > 0 ? 'fortalecendo' : ' enfraquecendo';
            if (score > bestScore) {
              bestScore = score;
              bestTarget = t;
              bestReason = `${t} ${dir}: ${Math.round(shortRate * 100)}% curto vs ${Math.round(longRate * 100)}% longo (${w.label})`;
            }
          }
        }
      }
      return {
        matched: bestScore >= 58,
        target: bestTarget,
        confidence: bestScore,
        pattern: colors.slice(0, 6),
        reason: bestScore >= 58 ? 'DIVERGENCIA: ' + bestReason : 'Sem divergencia temporal',
        analyses: [{ type: 'divergencia', score: bestScore, detail: bestReason }],
        confluences: bestScore >= 70 ? 1 : 0,
        lastAnalysis: Date.now()
      };
    },

    markovTransicao(history, _target, _patternSize) {
      if (history.length < 25) return { matched: false, confidence: 0, reason: 'Historico insuficiente (min 25)' };
      const colors = history.map(r => r.color);
      const states = ['RED', 'BLACK', 'GREEN', 'BLUE'];
      const transicoes = {};
      const totals = {};
      for (const s of states) { transicoes[s] = {}; totals[s] = 0; }
      for (let i = 0; i < colors.length - 1; i++) {
        const from = colors[i], to = colors[i + 1];
        if (!states.includes(from) || !states.includes(to)) continue;
        transicoes[from][to] = (transicoes[from][to] || 0) + 1;
        totals[from]++;
      }
      const atual = colors[0];
      if (!totals[atual] || totals[atual] < 3) {
        return { matched: false, target: 'RED', confidence: 0, reason: 'Dados insuficientes para Markov' };
      }
      let bestProb = 0, bestNext = 'RED';
      for (const next of states) {
        const prob = (transicoes[atual][next] || 0) / totals[atual];
        if (prob > bestProb) { bestProb = prob; bestNext = next; }
      }
      const baseline = 1 / states.length;
      const lift = bestProb / baseline;
      const score = Math.min(90, Math.round(45 + lift * 25));
      return {
        matched: score >= 58,
        target: bestNext,
        confidence: score,
        pattern: colors.slice(0, 5),
        reason: `Markov: P(${atual} -> ${bestNext}) = ${Math.round(bestProb * 100)}% (lift ${Math.round(lift * 100)}%)`,
        analyses: [{ type: 'markov', score, detail: `Transicao ${atual}->${bestNext}: ${Math.round(bestProb * 100)}%` }],
        confluences: score >= 70 ? 1 : 0,
        lastAnalysis: Date.now()
      };
    },

    bayesiano(history, _target, _patternSize) {
      if (history.length < 20) return { matched: false, confidence: 0, reason: 'Historico insuficiente (min 20)' };
      const colors = history.map(r => r.color);
      const prior = { RED: 0.44, BLACK: 0.44, GREEN: 0.04, BLUE: 0.08 };
      const recent = colors.slice(0, 10);
      const likelihood = {};
      for (const c of Object.keys(prior)) {
        const count = recent.filter(x => x === c).length;
        const smooth = 0.5;
        likelihood[c] = (count + smooth) / (recent.length + smooth * Object.keys(prior).length);
      }
      const posterior = {};
      let totalEvidence = 0;
      for (const c of Object.keys(prior)) {
        posterior[c] = likelihood[c] * prior[c];
        totalEvidence += posterior[c];
      }
      for (const c of Object.keys(posterior)) {
        posterior[c] = posterior[c] / totalEvidence;
      }
      let bestPost = 0, bestColor = 'RED';
      for (const [c, p] of Object.entries(posterior)) {
        if (p > bestPost) { bestPost = p; bestColor = c; }
      }
      const maxExpected = Math.max(...Object.values(prior));
      const lift = bestPost / maxExpected;
      const score = Math.min(92, Math.round(50 + lift * 30));
      const streak = [];
      let sLen = 1;
      for (let i = 1; i < Math.min(8, colors.length); i++) {
        if (colors[i] === colors[0]) sLen++; else break;
      }
      let bonus = 0;
      if (sLen >= 3) bonus = Math.min(10, sLen * 2);
      return {
        matched: (score + bonus) >= 58,
        target: bestColor,
        confidence: Math.min(95, score + bonus),
        pattern: colors.slice(0, 5),
        reason: `Bayes: P(${bestColor}) = ${Math.round(bestPost * 100)}% | Prior adj.`,
        analyses: [{ type: 'bayesiano', score: score + bonus, detail: `Posterior ${bestColor}: ${Math.round(bestPost * 100)}%` }],
        confluences: (score + bonus) >= 70 ? 1 : 0,
        lastAnalysis: Date.now()
      };
    },

    regressaoReversao(history, _target, _patternSize) {
      if (history.length < 25) return { matched: false, confidence: 0, reason: 'Historico insuficiente (min 25)' };
      const colors = history.map(r => r.color);
      const colorVal = { RED: 1, BLACK: 2, GREEN: 0, BLUE: 3 };
      const window = colors.slice(0, 20).map(c => colorVal[c] !== undefined ? colorVal[c] : 1);
      const mean = window.reduce((a, b) => a + b, 0) / window.length;
      const std = Math.sqrt(window.reduce((s, v) => s + (v - mean) ** 2, 0) / window.length);
      const current = window[0];
      const zScore = std > 0 ? (current - mean) / std : 0;
      let target = 'RED', score = 0, reason = '';
      if (zScore > 1.2) {
        const candidates = Object.entries(colorVal).filter(([k, v]) => v < current).sort((a, b) => b[1] - a[1]);
        target = candidates.length ? candidates[0][0] : 'RED';
        score = Math.min(88, Math.round(55 + Math.abs(zScore) * 15));
        reason = `Reversao para baixo: z=${zScore.toFixed(2)} (acima da media)`;
      } else if (zScore < -1.2) {
        const candidates = Object.entries(colorVal).filter(([k, v]) => v > current).sort((a, b) => a[1] - b[1]);
        target = candidates.length ? candidates[0][0] : 'BLACK';
        score = Math.min(88, Math.round(55 + Math.abs(zScore) * 15));
        reason = `Reversao para cima: z=${zScore.toFixed(2)} (abaixo da media)`;
      } else {
        const extremes = window.slice(0, 5).filter(v => Math.abs((v - mean) / (std || 1)) > 1);
        if (extremes.length >= 2) {
          score = Math.round(50 + extremes.length * 5);
          const lastIsHigh = window[0] > mean;
          target = lastIsHigh ? 'RED' : 'BLACK';
          reason = `Extremos recentes: ${extremes.length} - reversao provavel`;
        }
      }
      return {
        matched: score >= 55,
        target,
        confidence: score,
        pattern: colors.slice(0, 5),
        reason: score >= 55 ? 'REGRESSAO: ' + reason : 'Sem reversao detectada',
        analyses: [{ type: 'regressao', score, detail: `z=${zScore.toFixed(2)} | media=${mean.toFixed(2)} | std=${std.toFixed(2)}` }],
        confluences: score >= 70 ? 1 : 0,
        lastAnalysis: Date.now()
      };
    },

    suavizacaoExponencial(history, _target, _patternSize) {
      if (history.length < 20) return { matched: false, confidence: 0, reason: 'Historico insuficiente (min 20)' };
      const colors = history.map(r => r.color);
      const alpha = 0.3;
      const colorIdx = { RED: 1, BLACK: 2, GREEN: 0, BLUE: 3 };
      let smoothed = colorIdx[colors[0]] || 1;
      for (let i = 1; i < Math.min(30, colors.length); i++) {
        const val = colorIdx[colors[i]] || 1;
        smoothed = alpha * val + (1 - alpha) * smoothed;
      }
      const actual = colorIdx[colors[0]] || 1;
      const diff = smoothed - actual;
      let target = 'RED', score = 0, reason = '';
      if (Math.abs(diff) >= 0.8) {
        if (diff > 0) {
          target = 'RED';
          reason = `Suavizacao: smooth=${smoothed.toFixed(2)} > atual=${actual} - tendencia de subida`;
        } else {
          target = 'BLACK';
          reason = `Suavizacao: smooth=${smoothed.toFixed(2)} < atual=${actual} - tendencia de descida`;
        }
        score = Math.min(85, Math.round(55 + Math.abs(diff) * 20));
      }
      const recent = colors.slice(0, 5);
      const rFreq = {};
      recent.forEach(c => rFreq[c] = (rFreq[c] || 0) + 1);
      const dominant = Object.entries(rFreq).sort((a, b) => b[1] - a[1])[0];
      if (dominant && dominant[1] >= 3) {
        const others = Object.keys(rFreq).filter(c => c !== dominant[0]);
        if (others.length) {
          const altTarget = others[0];
          if (score < 60) { target = altTarget; score = Math.max(score, 55); reason = `Reversao apos dominancia ${dominant[0]} x${dominant[1]}`; }
        }
      }
      return {
        matched: score >= 55,
        target,
        confidence: score,
        pattern: colors.slice(0, 5),
        reason: score >= 55 ? 'EXP-SMOOTH: ' + reason : 'Sem sinal EXP-SMOOTH',
        analyses: [{ type: 'suavizacao', score, detail: `smooth=${smoothed.toFixed(2)} | diff=${diff.toFixed(2)}` }],
        confluences: score >= 70 ? 1 : 0,
        lastAnalysis: Date.now()
      };
    },

    detectorAnomalias(history, _target, _patternSize) {
      if (history.length < 30) return { matched: false, confidence: 0, reason: 'Historico insuficiente (min 30)' };
      const colors = history.map(r => r.color);
      const freq = {};
      colors.forEach(c => freq[c] = (freq[c] || 0) + 1);
      const total = colors.length;
      const expected = {};
      for (const c of Object.keys(freq)) expected[c] = total / Object.keys(freq).length;
      const chi2 = {};
      for (const c of Object.keys(freq)) {
        chi2[c] = Math.pow((freq[c] - expected[c]), 2) / expected[c];
      }
      const recent5 = colors.slice(0, 5);
      const recentFreq = {};
      recent5.forEach(c => recentFreq[c] = (recentFreq[c] || 0) + 1);
      let bestScore = 0, bestTarget = 'RED', bestReason = '';
      for (const c of Object.keys(freq)) {
        const overallRate = freq[c] / total;
        const recentRate = (recentFreq[c] || 0) / 5;
        const deviation = Math.abs(overallRate - recentRate);
        if (deviation >= 0.2) {
          const anomalyStrength = deviation / overallRate;
          const score = Math.min(88, Math.round(55 + anomalyStrength * 20));
          let target;
          if (recentRate > overallRate) {
            target = c === 'RED' ? 'BLACK' : c === 'BLACK' ? 'RED' : 'RED';
          } else {
            target = c;
          }
          if (score > bestScore) {
            bestScore = score;
            bestTarget = target;
            bestReason = `Anomalia ${c}: geral ${Math.round(overallRate * 100)}% vs recente ${Math.round(recentRate * 100)}% (chi2=${chi2[c].toFixed(1)})`;
          }
        }
      }
      return {
        matched: bestScore >= 58,
        target: bestTarget,
        confidence: bestScore,
        pattern: colors.slice(0, 5),
        reason: bestScore >= 58 ? 'ANOMALIA: ' + bestReason : 'Sem anomalias detectadas',
        analyses: [{ type: 'anomalia', score: bestScore, detail: bestReason }],
        confluences: bestScore >= 72 ? 1 : 0,
        lastAnalysis: Date.now()
      };
    },

    convergenciaMultiEscala(history, _target, _patternSize) {
      if (history.length < 35) return { matched: false, confidence: 0, reason: 'Historico insuficiente (min 35)' };
      const colors = history.map(r => r.color);
      const scales = [
        { start: 0, len: 5, label: '5' },
        { start: 0, len: 10, label: '10' },
        { start: 0, len: 20, label: '20' }
      ];
      const targets = ['RED', 'BLACK', 'GREEN', 'BLUE'];
      const votes = {};
      targets.forEach(t => votes[t] = 0);
      const scaleResults = [];
      for (const s of scales) {
        const slice = colors.slice(s.start, s.start + s.len);
        if (slice.length < 3) continue;
        const freq = {};
        slice.forEach(c => freq[c] = (freq[c] || 0) + 1);
        let best = 'RED', bestCount = 0;
        for (const c of Object.keys(freq)) {
          if (freq[c] > bestCount) { bestCount = freq[c]; best = c; }
        }
        votes[best]++;
        scaleResults.push({ scale: s.label, winner: best, rate: Math.round((bestCount / slice.length) * 100) });
      }
      let consensus = 'RED', maxVotes = 0;
      for (const [c, v] of Object.entries(votes)) {
        if (v > maxVotes) { maxVotes = v; consensus = c; }
      }
      const totalScales = scaleResults.length || 1;
      const agreement = maxVotes / totalScales;
      const score = Math.min(90, Math.round(50 + agreement * 35));
      const detail = scaleResults.map(s => `${s.label}: ${s.winner} ${s.rate}%`).join(' | ');
      return {
        matched: score >= 58,
        target: consensus,
        confidence: score,
        pattern: colors.slice(0, 5),
        reason: score >= 58 ? `MULTI-ESCALA: ${detail}` : 'Sem convergencia multi-escala',
        analyses: [{ type: 'multiEscala', score, detail }],
        confluences: maxVotes >= 3 ? 1 : 0,
        lastAnalysis: Date.now()
      };
    },

    predicaoCondicional(history, _target, _patternSize) {
      if (history.length < 25) return { matched: false, confidence: 0, reason: 'Historico insuficiente (min 25)' };
      const colors = history.map(r => r.color);
      const transitions = {};
      const totals = {};
      for (let i = 0; i < colors.length - 2; i++) {
        const key = `${colors[i]}-${colors[i + 1]}`;
        const next = colors[i + 2];
        if (!transitions[key]) transitions[key] = {};
        transitions[key][next] = (transitions[key][next] || 0) + 1;
        totals[key] = (totals[key] || 0) + 1;
      }
      const state = `${colors[1]}-${colors[0]}`;
      if (!totals[state] || totals[state] < 2) {
        return { matched: false, target: 'RED', confidence: 0, reason: 'Estado insuficiente: ' + state };
      }
      const trans = transitions[state];
      let bestNext = 'RED', bestProb = 0;
      for (const [next, count] of Object.entries(trans)) {
        const prob = count / totals[state];
        if (prob > bestProb) { bestProb = prob; bestNext = next; }
      }
      const baseline = 1 / 4;
      const lift = bestProb / baseline;
      const score = Math.min(92, Math.round(50 + lift * 22));
      const stateCount = totals[state];
      const sampleBonus = Math.min(5, Math.floor(stateCount / 3));
      return {
        matched: score >= 58,
        target: bestNext,
        confidence: Math.min(95, score + sampleBonus),
        pattern: colors.slice(0, 5),
        reason: `CONDICIONAL: P(${state} -> ${bestNext}) = ${Math.round(bestProb * 100)}% (n=${stateCount})`,
        analyses: [{ type: 'condicional', score: score + sampleBonus, detail: `Estado ${state}: ${Math.round(bestProb * 100)}% -> ${bestNext}` }],
        confluences: (score + sampleBonus) >= 72 ? 1 : 0,
        lastAnalysis: Date.now()
      };
    },

    entropiaAdaptativa(history, _target, _patternSize) {
      if (history.length < 25) return { matched: false, confidence: 0, reason: 'Historico insuficiente (min 25)' };
      const colors = history.map(r => r.color);
      const calcEntropy = (arr) => {
        const freq = {};
        arr.forEach(c => freq[c] = (freq[c] || 0) + 1);
        let H = 0;
        Object.values(freq).forEach(cnt => {
          const p = cnt / arr.length;
          if (p > 0) H -= p * Math.log2(p);
        });
        return H;
      };
      const entFull = calcEntropy(colors.slice(0, 30));
      const entRecent = calcEntropy(colors.slice(0, 10));
      const entDiff = entFull - entRecent;
      const maxEntropy = Math.log2(4);
      const recentSlice = colors.slice(0, 10);
      const freq = {};
      recentSlice.forEach(c => freq[c] = (freq[c] || 0) + 1);
      const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
      const dominant = sorted[0];
      const dominantRate = dominant ? dominant[1] / recentSlice.length : 0;
      let target = 'RED', score = 0, reason = '';
      if (entDiff > 0.3 && dominantRate >= 0.5) {
        const others = Object.keys(freq).filter(c => c !== dominant[0]);
        target = others.length ? others[0] : 'RED';
        score = Math.min(88, Math.round(55 + entDiff * 40 + dominantRate * 15));
        reason = `Entropia caiu: ${entFull.toFixed(2)} -> ${entRecent.toFixed(2)} | ${dominant[0]} dominante ${Math.round(dominantRate * 100)}%`;
      } else if (entDiff < -0.3) {
        const last3 = colors.slice(0, 3);
        const f3 = {};
        last3.forEach(c => f3[c] = (f3[c] || 0) + 1);
        const mostRecent = Object.entries(f3).sort((a, b) => b[1] - a[1])[0];
        if (mostRecent) {
          const others = Object.keys(freq).filter(c => c !== mostRecent[0]);
          target = others.length ? others[0] : 'BLACK';
          score = Math.min(85, Math.round(50 + Math.abs(entDiff) * 35));
          reason = `Entropia subindo: ${entFull.toFixed(2)} -> ${entRecent.toFixed(2)} | caos aumentando`;
        }
      }
      return {
        matched: score >= 58,
        target,
        confidence: score,
        pattern: colors.slice(0, 5),
        reason: score >= 58 ? 'ENTROPIA-ADAPT: ' + reason : 'Sem sinal entropia',
        analyses: [{ type: 'entropiaAdapt', score, detail: `H_full=${entFull.toFixed(2)} H_recent=${entRecent.toFixed(2)} diff=${entDiff.toFixed(2)}` }],
        confluences: score >= 72 ? 1 : 0,
        lastAnalysis: Date.now()
      };
    },

    volatilidadeAdaptativa(history, _target, _patternSize) {
      if (history.length < 25) return { matched: false, confidence: 0, reason: 'Historico insuficiente (min 25)' };
      const colors = history.map(r => r.color);
      const calcVolatility = (arr) => {
        let changes = 0;
        for (let i = 0; i < arr.length - 1; i++) {
          if (arr[i] !== arr[i + 1]) changes++;
        }
        return changes / Math.max(arr.length - 1, 1);
      };
      const vol10 = calcVolatility(colors.slice(0, 10));
      const vol20 = calcVolatility(colors.slice(0, 20));
      const volDiff = vol10 - vol20;
      const recent = colors.slice(0, 5);
      const streak = [];
      let cur = recent[0], cnt = 1;
      for (let i = 1; i < recent.length; i++) {
        if (recent[i] === cur) cnt++;
        else { streak.push({ color: cur, count: cnt }); cur = recent[i]; cnt = 1; }
      }
      streak.push({ color: cur, count: cnt });
      const longest = streak.sort((a, b) => b.count - a.count)[0];
      let target = 'RED', score = 0, reason = '';
      if (volDiff > 0.15 && longest && longest.count >= 2) {
        const others = colors.filter(c => c !== longest.color);
        const freq = {};
        others.forEach(c => freq[c] = (freq[c] || 0) + 1);
        const bestAlt = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
        target = bestAlt ? bestAlt[0] : 'RED';
        score = Math.min(85, Math.round(55 + volDiff * 80 + longest.count * 3));
        reason = `Alta volatilidade + streak ${longest.color} x${longest.count} - reversao provavel`;
      } else if (volDiff < -0.15) {
        target = longest ? (longest.color === 'RED' ? 'BLACK' : 'RED') : 'BLACK';
        score = Math.min(82, Math.round(50 + Math.abs(volDiff) * 70));
        reason = `Baixa volatilidade - continuacao de ${longest ? longest.color : '?'}`;
      } else if (longest && longest.count >= 4) {
        const others = colors.filter(c => c !== longest.color);
        const freq = {};
        others.forEach(c => freq[c] = (freq[c] || 0) + 1);
        const bestAlt = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
        target = bestAlt ? bestAlt[0] : 'RED';
        score = Math.min(80, Math.round(50 + longest.count * 5));
        reason = `Streak longo ${longest.color} x${longest.count} - reversao estatistica`;
      }
      return {
        matched: score >= 55,
        target,
        confidence: score,
        pattern: colors.slice(0, 5),
        reason: score >= 55 ? 'VOL-ADAPT: ' + reason : 'Sem sinal volatilidade',
        analyses: [{ type: 'volatilidadeAdapt', score, detail: `vol10=${Math.round(vol10 * 100)}% vol20=${Math.round(vol20 * 100)}% diff=${Math.round(volDiff * 100)}%` }],
        confluences: score >= 70 ? 1 : 0,
        lastAnalysis: Date.now()
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

    const confluences = Object.values(robot.diagnostic.patternScores || {}).filter(v => v >= 60).length;
    const recentLosses = (robot.stats?.losses || 0) > (robot.stats?.wins || 0) ? Math.min(3, (robot.stats.losses - robot.stats.wins)) : 0;
    const streak = robot.stats?.currentStreak || 0;

    let risk = 'BAIXO';
    if (recentLosses >= 2 || streak <= -3) risk = 'ALTO';
    else if (recentLosses >= 1 || streak <= -1) risk = 'MEDIO';

    let signalScore = Math.round(
      (strategyResult.confidence || 0) * 0.4 +
      (confluences / Math.max(Object.keys(robot.diagnostic.patternScores || {}).length, 1)) * 100 * 0.3 +
      Math.max(0, 100 - recentLosses * 25) * 0.2 +
      (risk === 'BAIXO' ? 90 : risk === 'MEDIO' ? 50 : 10) * 0.1
    );
    signalScore = Math.min(99, Math.max(10, signalScore));

    robot.diagnostic.confluences = confluences;
    robot.diagnostic.risk = risk;
    robot.diagnostic.signalScore = signalScore;

    if (strategyResult.matched && typeof robot.matchesLossPattern === 'function') {
      const lossMatch = robot.matchesLossPattern(strategyResult.target);
      robot.diagnostic.lossPatternMatch = lossMatch;
      if (lossMatch.match && lossMatch.score >= 85) {
        robot.diagnostic.status = 'REJECTED';
        robot.diagnostic.decision = { approved: false, reason: 'Padrao de LOSS detectado (' + lossMatch.score + '% similaridade)' };
        robot.diagnostic.signalBlocked = true;
        robot.diagnostic.blockReason = 'Padrao de LOSS detectado (' + lossMatch.score + '% similaridade)';
        robot.signalFlow = { step1: 'Padrao: ' + (robot.diagnostic.mainPattern || '--'), step2: 'Bloqueado: Padrão de LOSS (' + lossMatch.score + '%)', step3: 'Alvo ' + (lossMatch.details?.target || '--') + ' perdeu ' + (lossMatch.details?.count || 0) + 'x com contexto similar', step4: 'Aguardando proximo ciclo' };
        robot.stats.signalsRejected++;
        return null;
      }
      if (lossMatch.match && lossMatch.score >= 60) {
        const penalty = Math.round((lossMatch.score - 60) * 0.5);
        signalScore = Math.max(10, signalScore - penalty);
        robot.diagnostic.signalScore = signalScore;
      }
    }

    if (!strategyResult.matched) {
      robot.diagnostic.status = 'IDLE';
      robot.diagnostic.decision = { approved: false, reason: strategyResult.reason };
      robot.diagnostic.signalBlocked = true;
      robot.diagnostic.blockReason = strategyResult.reason;
      robot.signalFlow = { step1: 'Padrao identificado: ' + (robot.diagnostic.mainPattern || '--'), step2: 'Filtrado: ' + (strategyResult.reason || 'Sem padrao'), step3: 'Score: ' + signalScore + '/100', step4: 'Placar sera atualizado apos resultado' };
      robot.stats.signalsRejected++;
      return null;
    }

    const filterMode = robot.filterMode || 'moderado';
    const thresholds = {
      desligado: { minConf: 0, minConfluences: 0, minScore: 0 },
      conservador: { minConf: 80, minConfluences: 3, minScore: 75 },
      moderado: { minConf: 65, minConfluences: 2, minScore: 55 },
      agressivo: { minConf: 45, minConfluences: 1, minScore: 30 }
    };
    const th = thresholds[filterMode] || thresholds.moderado;
    const effectiveConf = robot.minimumConfidence !== undefined && robot.minimumConfidence !== null ? Math.max(th.minConf || 0, robot.minimumConfidence) : (th.minConf || 0);

    const filter = {
      padraoEncontrado: true,
      resultadosSuficientes: robot.history.length >= robot.resultsToAnalyze,
      confiancaMinima: strategyResult.confidence >= effectiveConf,
      confluencia: confluences >= th.minConfluences,
      scoreMinimo: signalScore >= (robot.minScore || th.minScore),
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
      robot.currentSignal = null;
      robot.stats.signalsRejected++;
      return null;
    }

    const activeFilters = robot.filters || [];
    if (activeFilters.length > 0 && typeof Filters !== 'undefined') {
      const candidate = { color: strategyResult.target, score: signalScore, confidence: strategyResult.confidence };
      const filteredCandidates = Filters.applyAll(robot, robot.history, [candidate]);
      if (filteredCandidates.length === 0) {
        robot.diagnostic.status = 'REJECTED';
        robot.diagnostic.decision = { approved: false, reason: 'Filtros de qualidade bloquearam o sinal' };
        robot.diagnostic.signalBlocked = true;
        robot.diagnostic.blockReason = 'Filtros de qualidade bloquearam o sinal';
        robot.signalFlow = { step1: 'Padrao: ' + (robot.diagnostic.mainPattern || '--'), step2: 'Bloqueado por Filtros', step3: 'Filtros ativos: ' + activeFilters.length, step4: 'Aguardando proximo ciclo' };
        robot.stats.signalsRejected++;
        return null;
      }
      strategyResult.target = filteredCandidates[0].color;
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
    else robot.status = 'offline';
    this.robots.set(robot.id, robot);
    if (robot.status === 'online') EventBus.emit('robot:started', { id: robot.id });
    return robot;
  },

  getRobot(id) { return this.robots.get(id); },
  getAllRobots() { return [...this.robots.values()]; },
  getAllStates() { return this.getAllRobots().map(r => r.getState()); },

  startRobot(id) { const r = this.robots.get(id); if (r) { r.status = 'online'; r.startedAt = Date.now(); EventBus.emit('robot:started', { id }); this.save(); } },
  stopRobot(id) { const r = this.robots.get(id); if (r) { r.status = 'offline'; r.startedAt = null; r.currentSignal = null; EventBus.emit('robot:stopped', { id }); this.save(); } },
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
        if (robot.history.length > 400) robot.history.length = 400;
        robot.diagnostic.analyzedResults = robot.history.length;
        if (robot.status === 'online') robot.analyze();
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
    return changed;
  },

  distributeResult(result) {
    const label = result.label || result.game;
    this.getAllRobots().forEach(robot => {
      if (robot.status === 'online' && robot.game === label) {
        const pendingSignal = robot.currentSignal;
        const accepted = robot.receiveResult(result);
        if (pendingSignal && accepted) robot.checkResult(result, pendingSignal);
        EventBus.emit('robot:state', robot.getState());
      }
    });
    if (document.title !== 'WS Background') this.save();
  }
};

EventBus.on('result:new', (result) => {
  RobotEngine.distributeResult(result);
  if (document.title !== 'WS Background') RobotEngine.save();
});

EventBus.on('results:history', (d) => {
  if (!d || !d.results || !d.results.length) return;
  RobotEngine.getAllRobots().forEach(robot => {
    if (robot.status === 'online' && robot.game === d.label) {
      const existingStable = new Set(robot.history
        .map(h => h.roundId ? 'round:' + h.roundId : (h.storageId ? 'stored:' + h.storageId : ''))
        .filter(Boolean));
      let addedCount = 0;
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
        addedCount++;
      });
      if (robot.history.length > 400) robot.history.length = 400;
      robot.diagnostic.analyzedResults = robot.history.length;
      if (addedCount > 0) robot.analyze();
    }
  });
  if (document.title !== 'WS Background') RobotEngine.save();
});
