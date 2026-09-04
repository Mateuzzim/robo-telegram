const NewsService = (() => {
  const CHANNEL_NAME = 'robot-news';
  const SUMMARY_INTERVAL = 4 * 60 * 1000;
  const ANALYSIS_INTERVAL = 20 * 1000;
  const SUMMARY_STORAGE_KEY = 'news-summary-config-v1';
  const ANALYSIS_STORAGE_KEY = 'news-analysis-config-v1';
  let channel = null;
  let enabled = true;
  let summaryTimer = null;
  let analysisTimer = null;
  let newsItems = [];

  function init() {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (e) => handleChannelMessage(e.data);
    } catch(e) {
      console.warn('[News] BroadcastChannel não suportado');
    }

    EventBus.on('robot:started', (d) => handleRobotStarted(d));
    EventBus.on('robot:stopped', (d) => handleRobotStopped(d));

    loadSummaryConfig();
    setTimeout(() => startSummaryTimer(), 4 * 60 * 1000);
    loadAnalysisConfig();
    setTimeout(() => startAnalysisTimer(), 20000);
  }

  function handleChannelMessage(data) {
    if (data.type === 'news' && data.item) {
      newsItems.unshift(data.item);
      if (newsItems.length > 500) newsItems = newsItems.slice(0, 500);
    }
  }

  function emit(item) {
    if (!enabled || !channel) return;
    item.time = Date.now();
    newsItems.unshift(item);
    if (newsItems.length > 500) newsItems = newsItems.slice(0, 500);
    try {
      channel.postMessage({ type: 'news', item });
    } catch(e) {}
  }

  function emitAnalysis(game, message) {
    const title = message.match(/<b>(.*?)<\/b>/)?.[1] || 'Análise';
    const plainText = message.replace(/<[^>]*>/g, '').substring(0, 200);
    emit({
      robotId: 'analysis-' + game,
      robotName: title,
      robotStatus: 'online',
      game: game,
      type: 'analysis',
      message: plainText,
      isAnalysis: true
    });
  }

  function startSummaryTimer() {
    if (summaryTimer) clearInterval(summaryTimer);
    const config = getSummaryConfig();
    if (!config.enabled || !config.channelId) return;
    summaryTimer = setInterval(() => sendSummary(), SUMMARY_INTERVAL);
  }

  function startAnalysisTimer() {
    if (analysisTimer) clearInterval(analysisTimer);
    const config = getAnalysisConfig();
    if (!config.enabled) return;
    analysisTimer = setInterval(() => sendAllAnalysis(), ANALYSIS_INTERVAL);
  }

  function getSummaryConfig() {
    try {
      return JSON.parse(localStorage.getItem(SUMMARY_STORAGE_KEY) || '{}');
    } catch { return {}; }
  }

  function saveSummaryConfig(config) {
    localStorage.setItem(SUMMARY_STORAGE_KEY, JSON.stringify(config));
    loadSummaryConfig();
    startSummaryTimer();
  }

  function loadSummaryConfig() {
    const config = getSummaryConfig();
    enabled = config.enabled !== false;
  }

  function getAnalysisConfig() {
    try {
      return JSON.parse(localStorage.getItem(ANALYSIS_STORAGE_KEY) || '{}');
    } catch { return {}; }
  }

  function saveAnalysisConfig(config) {
    localStorage.setItem(ANALYSIS_STORAGE_KEY, JSON.stringify(config));
    loadAnalysisConfig();
    startAnalysisTimer();
  }

  function loadAnalysisConfig() {
    const config = getAnalysisConfig();
    if (config.enabled === false) return;
  }

  function loadHistory(game) {
    const key = game === 'wheel' ? 'historico-wheel-v1' : 'historico-double-v1';
    try {
      const data = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(data) ? data : [];
    } catch { return []; }
  }

  function getColor(result) {
    return String(result?.color || result?.cellColor || '').toUpperCase();
  }

  function countColors(results, game) {
    const counts = {};
    results.forEach(r => {
      const c = getColor(r);
      if (c) counts[c] = (counts[c] || 0) + 1;
    });
    return counts;
  }

  function getPercent(count, total) {
    return total > 0 ? Math.round((count / total) * 100) : 0;
  }

  function formatBar(count, total, size) {
    size = size || 10;
    const filled = total > 0 ? Math.round((count / total) * size) : 0;
    return '🟩'.repeat(filled) + '⬛️'.repeat(size - filled);
  }

  function colorEmoji(color) {
    const c = String(color || '').toUpperCase();
    if (c === 'RED') return '🔴';
    if (c === 'BLACK' || c === 'GREY' || c === 'GRAY') return '⚫️';
    if (c === 'GREEN') return '🟢';
    if (c === 'BLUE') return '🔵';
    return '⚪️';
  }

  function colorLabel(color) {
    const c = String(color || '').toUpperCase();
    const map = { RED: 'VERMELHO', BLACK: 'PRETO', GREY: 'PRETO', GRAY: 'PRETO', GREEN: 'VERDE', BLUE: 'AZUL' };
    return map[c] || c || '--';
  }

  async function sendToTelegram(text) {
    const config = getSummaryConfig();
    const token = TelegramService.getToken();
    const chatId = config.channelId;
    if (!token || !chatId) return;
    const result = await TelegramService.api(token, 'sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
    if (!result.ok) {
      console.warn('[News] Erro Telegram:', result.description, '| chat_id:', chatId);
    }
    return result;
  }

  async function sendAllAnalysis() {
    const config = getAnalysisConfig();
    const hasChannel = config.enabled && config.channelId;

    if (config.wheel !== false) {
      const results = loadHistory('wheel');
      if (results.length >= 10) {
        const allMessages = generateWheelAnalysis(results);
        const selected = pickRandom(allMessages, 3);
        for (const msg of selected) {
          emitAnalysis('wheel', msg);
          if (hasChannel) await sendToTelegram(msg);
          await delay(randomDelay(2000, 5000));
        }
      }
    }

    await delay(randomDelay(3000, 7000));

    if (config.double !== false) {
      const results = loadHistory('double');
      if (results.length >= 10) {
        const allMessages = generateDoubleAnalysis(results);
        const selected = pickRandom(allMessages, 3);
        for (const msg of selected) {
          emitAnalysis('double', msg);
          if (hasChannel) await sendToTelegram(msg);
          await delay(randomDelay(2000, 5000));
        }
      }
    }
  }

  function pickRandom(arr, count) {
    const shuffled = [...arr].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, shuffled.length));
  }

  function randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function generateWheelAnalysis(results) {
    const messages = [];
    const now = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (results.length < 5) return messages;

    const analysis = buildAnalysis(results, 'wheel');

    // 1. Alerta de Streak
    if (analysis.streak.length >= 3) {
      messages.push(
        `🔥 <b>ALERTA DE STREAK WHEEL - ${now}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${colorEmoji(analysis.streak.color)} <b>${colorLabel(analysis.streak.color)}</b> apareceu <b>${analysis.streak.length}x seguidas!</b>\n\n` +
        `Probabilidade de continuar: <b>${estimateStreakProb(analysis.streak.length)}</b>\n` +
        `Recomendação: ${analysis.streak.length >= 5 ? '⚠️ Não apostar contra a streak' : '📊 Streak forte, aguarde'}`
      );
    }

    // 2. Cor Quente/Fria
    const hot = analysis.sorted[0];
    const cold = analysis.sorted[analysis.sorted.length - 1];
    if (hot && cold && hot.color !== cold.color) {
      messages.push(
        `🌡️ <b>COR QUENTE/FRIA WHEEL - ${now}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🔥 <b>QUENTE:</b> ${colorEmoji(hot.color)} ${colorLabel(hot.color)} - ${hot.count}x (${hot.percent}%)\n` +
        `${formatBar(hot.count, analysis.total, 10)}\n\n` +
        `❄️ <b>FRÍA:</b> ${colorEmoji(cold.color)} ${colorLabel(cold.color)} - ${cold.count}x (${cold.percent}%)\n` +
        `${formatBar(cold.count, analysis.total, 10)}`
      );
    }

    // 3. Atraso Máximo
    const maxDelay = analysis.sorted.reduce((max, s) => analysis.gaps[s.color] > max.delay ? { color: s.color, delay: analysis.gaps[s.color] } : max, { color: '', delay: 0 });
    if (maxDelay.delay >= 5) {
      messages.push(
        `⏰ <b>ATRASO MÁXIMO WHEEL - ${now}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${colorEmoji(maxDelay.color)} <b>${colorLabel(maxDelay.color)}</b> não sai há <b>${maxDelay.delay} rodadas!</b>\n\n` +
        `Atrasos:\n` +
        analysis.colors.map(c => `${colorEmoji(c)} ${colorLabel(c)}: ${analysis.gaps[c]}rd`).join('\n') + '\n\n' +
        `📈 Quanto maior o atraso, maior a chance estatística de sair`
      );
    }

    // 4. Padrão Detectado
    const pattern = detectAdvancedPattern(results);
    if (pattern) {
      messages.push(
        `🔄 <b>PADRÃO DETECTADO WHEEL - ${now}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${pattern}\n\n` +
        `📋 Últimos 10: ${results.slice(0, 10).map(r => colorEmoji(getColor(r))).join(' ')}`
      );
    }

    // 5. Hora do Green
    const greenInterval = calcGreenInterval(results);
    if (greenInterval.avg > 0) {
      const lastGreenIdx = results.findIndex(r => getColor(r) === 'GREEN');
      const roundsSinceGreen = lastGreenIdx >= 0 ? lastGreenIdx : analysis.total;
      const expected = Math.round(greenInterval.avg - roundsSinceGreen);
      messages.push(
        `🟢 <b>HORA DO GREEN WHEEL - ${now}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📊 Intervalo médio entre Greens: <b>${greenInterval.avg} rodadas</b>\n` +
        `🎯 Último Green: <b>${roundsSinceGreen}rd atrás</b>\n` +
        `⏳ Próximo esperado em: <b>${Math.max(0, expected)} rodadas</b>\n\n` +
        `📈 Greens nos últimos 100: <b>${greenInterval.count}x</b>\n` +
        `${expected <= 0 ? '🟢 <b>PODE SER HORA!</b>' : '⏰ Aguarde...'}`
      );
    }

    // 8. Distribuição Estatística
    messages.push(
      `📊 <b>DISTRIBUIÇÃO ESTATÍSTICA WHEEL - ${now}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Resultado esperado vs atual (${analysis.total} rodadas):\n\n` +
      analysis.sorted.map(s => {
        const expected = Math.round((s.expected / 100) * analysis.total);
        const diff = s.count - expected;
        const arrow = diff > 0 ? '📈' : diff < 0 ? '📉' : '➡️';
        return `${colorEmoji(s.color)} ${colorLabel(s.color)}: ${s.count}x (esperado: ${expected}x) ${arrow} ${diff > 0 ? '+' : ''}${diff}`;
      }).join('\n') +
      `\n\n📝 Valores positivos = acima do esperado\n📝 Valores negativos = abaixo do esperado`
    );

    // 10. Previsão Próxima Rodada
    const prediction = predictNext(results, analysis);
    messages.push(
      `🔮 <b>PREVISÃO PRÓXIMA RODADA WHEEL - ${now}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📊 Tendência atual: <b>${prediction.trend}</b>\n` +
      `🎯 Cor sugerida: ${colorEmoji(prediction.suggested)} <b>${colorLabel(prediction.suggested)}</b>\n` +
      `📈 Confiança: <b>${prediction.confidence}%</b>\n\n` +
      `📋 Padrão recente: ${results.slice(0, 5).map(r => colorEmoji(getColor(r))).join(' ')}\n\n` +
      `⚠️ <i>Previsão baseada em tendência, não garante resultado</i>`
    );

    // 11. Desvio Padrão
    const stdDev = calcStdDev(results, 'wheel');
    if (stdDev !== null) {
      const level = stdDev < 0.05 ? '🟢 Muito Estável' : stdDev < 0.15 ? '🟡 Estável' : stdDev < 0.25 ? '🟠 Moderado' : '🔴 Instável';
      messages.push(
        `📐 <b>DESVIO PADRÃO WHEEL - ${now}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📊 Valor: <b>${stdDev.toFixed(4)}</b>\n` +
        `📏 Classificação: <b>${level}</b>\n\n` +
        `📝 Desvio baixo = distribuição estável\n` +
        `📝 Desvio alto = distribuição imprevisível`
      );
    }

    // 12. Z-Score
    const zScores = calcZScore(results, 'wheel');
    if (zScores) {
      const alerts = Object.entries(zScores).filter(([_, v]) => Math.abs(v) > 2);
      messages.push(
        `🎯 <b>Z-SCORE WHEEL - ${now}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        Object.entries(zScores).map(([c, v]) => {
          const flag = Math.abs(v) > 2 ? ' ⚠️ ANOMALIA' : Math.abs(v) > 1.5 ? ' 📊 Moderado' : '';
          return `${colorEmoji(c)} ${colorLabel(c)}: <b>${v > 0 ? '+' : ''}${v.toFixed(2)}</b>${flag}`;
        }).join('\n') +
        `\n\n📝 Z > 2 = Acima do esperado\n📝 Z < -2 = Abaixo do esperado\n📝 Entre -2 e +2 = Normal` +
        (alerts.length > 0 ? `\n\n🚨 <b>${alerts.length} cor(es) com anomalia!</b>` : '\n\n✅ Distribuição dentro do esperado')
      );
    }

    // 13. Entropia de Shannon
    const entropy = calcShannonEntropy(results);
    if (entropy !== null) {
      const level = entropy > 0.9 ? '🔴 Muito Caótico' : entropy > 0.7 ? '🟠 Caótico' : entropy > 0.5 ? '🟡 Moderado' : '🟢 Previsível';
      messages.push(
        `🧠 <b>ENTROPIA DE SHANNON WHEEL - ${now}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📊 Entropia: <b>${(entropy * 100).toFixed(1)}%</b>\n` +
        `📏 Classificação: <b>${level}</b>\n\n` +
        `📝 0% = Totalmente previsível\n` +
        `📝 100% = Totalmente aleatório\n` +
        `📝 Atual: ${level.split(' ')[1]}`
      );
    }

    // 14. Probabilidade Condicional
    const condProb = calcConditionalProb(results, 'wheel');
    if (condProb) {
      const sorted = Object.entries(condProb.probs).sort((a, b) => b[1] - a[1]);
      messages.push(
        `🔗 <b>PROB. CONDICIONAL WHEEL - ${now}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📋 Após sair ${colorEmoji(condProb.lastColor)} ${colorLabel(condProb.lastColor)}:\n\n` +
        sorted.map(([c, p]) => `${colorEmoji(c)} ${colorLabel(c)}: <b>${p}%</b> ${formatBar(p, 100, 5)}`).join('\n') +
        `\n\n📝 Baseado nas últimas transições do histórico`
      );
    }

    // 15. Cadeia de Markov
    const markov = calcMarkovMatrix(results, 'wheel');
    if (markov) {
      const lastColor = getColor(results[0]);
      const probs = markov[lastColor] || {};
      const sorted = Object.entries(probs).sort((a, b) => b[1] - a[1]);
      messages.push(
        `⛓️ <b>CADEIA DE MARKOV WHEEL - ${now}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📋 Matriz de transição (após ${colorEmoji(lastColor)} ${colorLabel(lastColor)}):\n\n` +
        sorted.map(([c, p]) => `${colorEmoji(c)} ${colorLabel(c)}: <b>${p}%</b>`).join('\n') +
        `\n\n📝 Probabilidade de transição de cor em cor`
      );
    }

    // 16. Correlação entre Cores
    const corr = calcCorrelation(results, 'wheel');
    if (corr) {
      const sorted = Object.entries(corr).sort((a, b) => b[1] - a[1]);
      messages.push(
        `🔀 <b>CORRELAÇÃO ENTRE CORES WHEEL - ${now}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        sorted.map(([pair, val]) => {
          const [a, b] = pair.split('+');
          const level = val > 30 ? '🔗 Forte' : val > 15 ? '📊 Moderada' : '⚪ Fraca';
          return `${colorEmoji(a)}↔${colorEmoji(b)}: <b>${val}%</b> ${level}`;
        }).join('\n') +
        `\n\n📝 Correlação = frequência que uma cor aparece após a outra`
      );
    }

    // 17. Chi-Quadrado
    const chiSq = calcChiSquared(results, 'wheel');
    if (chiSq) {
      messages.push(
        `🧮 <b>CHI-QUADRADO WHEEL - ${now}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📊 Valor χ²: <b>${chiSq.chiSq}</b>\n` +
        `📏 Graus de liberdade: <b>${chiSq.df}</b>\n` +
        `🎯 Resultado: <b>${chiSq.isRandom ? '🟢 ALEATÓRIO' : '🔴 NÃO-ALEATÓRIO'}</b>\n\n` +
        `📝 χ² < 7.815 = Resultado é aleatório\n` +
        `📝 χ² ≥ 7.815 = Padrão detectado\n\n` +
        `💡 ${chiSq.isRandom ? 'Distribuição segue padrão esperado' : 'Há indícios de padrão na distribuição'}`
      );
    }

    // 18. Média Móvel Ponderada
    const wma = calcWeightedMA(results, 'wheel');
    if (wma) {
      messages.push(
        `📉 <b>MÉDIA MÓVEL PONDERADA WHEEL - ${now}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📋 Pesos maiores nos últimos resultados:\n\n` +
        wma.map(w => `${colorEmoji(w.color)} ${colorLabel(w.color)}: <b>${w.score}%</b> ${formatBar(w.score, 100, 8)}`).join('\n') +
        `\n\n📝 Resultados recentes têm mais influência`
      );
    }

    // 19. Índice de Estabilidade
    const stability = calcStabilityIndex(results, 'wheel');
    if (stability) {
      const entries = Object.entries(stability).sort((a, b) => b[1] - a[1]);
      messages.push(
        `📊 <b>ÍNDICE DE ESTABILIDADE WHEEL - ${now}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        entries.map(([c, v]) => {
          const level = v > 80 ? '🟢 Muito Estável' : v > 60 ? '🟡 Estável' : v > 40 ? '🟠 Moderado' : '🔴 Instável';
          return `${colorEmoji(c)} ${colorLabel(c)}: <b>${v}%</b> ${level}`;
        }).join('\n') +
        `\n\n📝 Mede consistência ao longo do tempo\n` +
        `📝 100% = Perfeitamente estável`
      );
    }

    // 20. Previsão Bayesiana
    const bayes = calcBayesian(results, 'wheel');
    if (bayes) {
      messages.push(
        `🎲 <b>PREVISÃO BAYESIANA WHEEL - ${now}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📋 Probabilidades atualizadas (Bayes):\n\n` +
        bayes.map(b => `${colorEmoji(b.color)} ${colorLabel(b.color)}: <b>${b.prob}%</b> ${formatBar(b.prob, 100, 8)}`).join('\n') +
        `\n\n📝 Combina probabilidade a priori com dados recentes\n` +
        `🎯 Maior probabilidade = ${colorEmoji(bayes[0].color)} ${colorLabel(bayes[0].color)}`
      );
    }

    return messages;
  }

  function generateDoubleAnalysis(results) {
    const messages = [];
    const now = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (results.length < 5) return messages;

    const analysis = buildAnalysis(results, 'double');

    // 1. Alerta de Streak
    if (analysis.streak.length >= 3) {
      messages.push(
        `🔥 <b>ALERTA DE STREAK DOUBLE - ${now}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${colorEmoji(analysis.streak.color)} <b>${colorLabel(analysis.streak.color)}</b> apareceu <b>${analysis.streak.length}x seguidas!</b>\n\n` +
        `Probabilidade de continuar: <b>${estimateStreakProb(analysis.streak.length)}</b>\n` +
        `Recomendação: ${analysis.streak.length >= 5 ? '⚠️ Não apostar contra a streak' : '📊 Streak forte, aguarde'}`
      );
    }

    // 2. Cor Quente/Fria
    const hot = analysis.sorted[0];
    const cold = analysis.sorted[analysis.sorted.length - 1];
    if (hot && cold && hot.color !== cold.color) {
      messages.push(
        `🌡️ <b>COR QUENTE/FRIA DOUBLE - ${now}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🔥 <b>QUENTE:</b> ${colorEmoji(hot.color)} ${colorLabel(hot.color)} - ${hot.count}x (${hot.percent}%)\n` +
        `${formatBar(hot.count, analysis.total, 10)}\n\n` +
        `❄️ <b>FRÍA:</b> ${colorEmoji(cold.color)} ${colorLabel(cold.color)} - ${cold.count}x (${cold.percent}%)\n` +
        `${formatBar(cold.count, analysis.total, 10)}`
      );
    }

    // 3. Atraso Máximo
    const maxDelay = analysis.sorted.reduce((max, s) => analysis.gaps[s.color] > max.delay ? { color: s.color, delay: analysis.gaps[s.color] } : max, { color: '', delay: 0 });
    if (maxDelay.delay >= 5) {
      messages.push(
        `⏰ <b>ATRASO MÁXIMO DOUBLE - ${now}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${colorEmoji(maxDelay.color)} <b>${colorLabel(maxDelay.color)}</b> não sai há <b>${maxDelay.delay} rodadas!</b>\n\n` +
        `Atrasos:\n` +
        analysis.colors.map(c => `${colorEmoji(c)} ${colorLabel(c)}: ${analysis.gaps[c]}rd`).join('\n') + '\n\n' +
        `📈 Quanto maior o atraso, maior a chance estatística de sair`
      );
    }

    // 4. Padrão Detectado
    const pattern = detectAdvancedPattern(results);
    if (pattern) {
      messages.push(
        `🔄 <b>PADRÃO DETECTADO DOUBLE - ${now}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${pattern}\n\n` +
        `📋 Últimos 10: ${results.slice(0, 10).map(r => colorEmoji(getColor(r))).join(' ')}`
      );
    }

    // 5. Hora do Green
    const greenInterval = calcGreenInterval(results);
    if (greenInterval.avg > 0) {
      const lastGreenIdx = results.findIndex(r => getColor(r) === 'GREEN');
      const roundsSinceGreen = lastGreenIdx >= 0 ? lastGreenIdx : analysis.total;
      const expected = Math.round(greenInterval.avg - roundsSinceGreen);
      messages.push(
        `🟢 <b>HORA DO GREEN DOUBLE - ${now}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📊 Intervalo médio entre Greens: <b>${greenInterval.avg} rodadas</b>\n` +
        `🎯 Último Green: <b>${roundsSinceGreen}rd atrás</b>\n` +
        `⏳ Próximo esperado em: <b>${Math.max(0, expected)} rodadas</b>\n\n` +
        `📈 Greens nos últimos 100: <b>${greenInterval.count}x</b>\n` +
        `${expected <= 0 ? '🟢 <b>PODE SER HORA!</b>' : '⏰ Aguarde...'}`
      );
    }

    // 6. Alerta Martingale
    const robots = typeof RobotEngine !== 'undefined' ? RobotEngine.getAllRobots().filter(r => r.game === 'double' && r.status === 'online') : [];
    robots.forEach(robot => {
      const stats = robot.stats || {};
      const losses = stats.losses || 0;
      const wins = stats.wins || 0;
      const currentStreak = stats.currentStreak || 0;
      const galeMax = robot.gale?.max || 0;
      if (currentStreak >= galeMax - 1 && galeMax > 0) {
        messages.push(
          `🚨 <b>ALERTA MARTINGALE DOUBLE - ${now}</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n\n` +
          `🤖 <b>${escapeHtml(robot.name)}</b>\n` +
          `📉 Losses consecutivos: <b>${currentStreak}</b>\n` +
          `⚡️ Gale máximo: <b>G${galeMax}</b>\n` +
          `⚠️ <b>PRÓXIMO DO LIMITE!</b>\n\n` +
          `📊 Win Rate: ${stats.wins || 0}W / ${stats.losses || 0}L (${(wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 100) : 0}%)\n` +
          `🔴 Risco alto de loss grande se atingir G${galeMax}`
        );
      }
    });

    // 7. Ranking de Robôs
    if (robots.length > 0) {
      const ranked = robots.map(r => {
        const s = r.stats || {};
        const w = s.wins || 0;
        const l = s.losses || 0;
        return { name: r.name, wins: w, losses: l, rate: (w + l) > 0 ? Math.round((w / (w + l)) * 100) : 0, signals: s.signals || 0 };
      }).sort((a, b) => b.rate - a.rate);
      messages.push(
        `🏆 <b>RANKING DE ROBÔS DOUBLE - ${now}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        ranked.map((r, i) => {
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '▫️';
          return `${medal} <b>${escapeHtml(r.name)}</b>\n   ✅ ${r.wins}W | ❌ ${r.losses}L | 📊 ${r.rate}% | 📨 ${r.signals}`;
        }).join('\n\n')
      );
    }

    // 8. Distribuição Estatística
    messages.push(
      `📊 <b>DISTRIBUIÇÃO ESTATÍSTICA DOUBLE - ${now}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Resultado esperado vs atual (${analysis.total} rodadas):\n\n` +
      analysis.sorted.map(s => {
        const expected = Math.round((s.expected / 100) * analysis.total);
        const diff = s.count - expected;
        const arrow = diff > 0 ? '📈' : diff < 0 ? '📉' : '➡️';
        return `${colorEmoji(s.color)} ${colorLabel(s.color)}: ${s.count}x (esperado: ${expected}x) ${arrow} ${diff > 0 ? '+' : ''}${diff}`;
      }).join('\n') +
      `\n\n📝 Valores positivos = acima do esperado\n📝 Valores negativos = abaixo do esperado`
    );

    // 9. Resumo Últimos 5 Min
    const recentResults = results.filter(r => (Date.now() - (r.timestamp || r.time || 0)) < 5 * 60 * 1000);
    if (recentResults.length > 0) {
      const rc = countColors(recentResults, 'double');
      const rw = recentResults.filter(r => getColor(r) === 'RED' || getColor(r) === 'BLACK').length;
      const rg = recentResults.filter(r => getColor(r) === 'GREEN').length;
      messages.push(
        `⏱️ <b>RESUMO ÚLTIMOS 5 MIN DOUBLE - ${now}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📊 Rodadas: <b>${recentResults.length}</b>\n\n` +
        Object.keys(rc).map(c => `${colorEmoji(c)} ${colorLabel(c)}: ${rc[c]}x (${getPercent(rc[c], recentResults.length)}%)`).join('\n') +
        `\n\n🔴⚫ Não-Green: <b>${rw}x</b>\n🟢 Green: <b>${rg}x</b>` +
        `\n📈 Seq: ${recentResults.slice(0, 10).map(r => colorEmoji(getColor(r))).join(' ')}`
      );
    }

    // 10. Previsão Próxima Rodada
    const prediction = predictNext(results, analysis);
    messages.push(
      `🔮 <b>PREVISÃO PRÓXIMA RODADA DOUBLE - ${now}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📊 Tendência atual: <b>${prediction.trend}</b>\n` +
      `🎯 Cor sugerida: ${colorEmoji(prediction.suggested)} <b>${colorLabel(prediction.suggested)}</b>\n` +
      `📈 Confiança: <b>${prediction.confidence}%</b>\n\n` +
      `📋 Padrão recente: ${results.slice(0, 5).map(r => colorEmoji(getColor(r))).join(' ')}\n\n` +
      `⚠️ <i>Previsão baseada em tendência, não garante resultado</i>`
    );

    // 11. Desvio Padrão
    const stdDev = calcStdDev(results, 'double');
    if (stdDev !== null) {
      const level = stdDev < 0.05 ? '🟢 Muito Estável' : stdDev < 0.15 ? '🟡 Estável' : stdDev < 0.25 ? '🟠 Moderado' : '🔴 Instável';
      messages.push(
        `📐 <b>DESVIO PADRÃO DOUBLE - ${now}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📊 Valor: <b>${stdDev.toFixed(4)}</b>\n` +
        `📏 Classificação: <b>${level}</b>\n\n` +
        `📝 Desvio baixo = distribuição estável\n` +
        `📝 Desvio alto = distribuição imprevisível`
      );
    }

    // 12. Z-Score
    const zScores = calcZScore(results, 'double');
    if (zScores) {
      const alerts = Object.entries(zScores).filter(([_, v]) => Math.abs(v) > 2);
      messages.push(
        `🎯 <b>Z-SCORE DOUBLE - ${now}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        Object.entries(zScores).map(([c, v]) => {
          const flag = Math.abs(v) > 2 ? ' ⚠️ ANOMALIA' : Math.abs(v) > 1.5 ? ' 📊 Moderado' : '';
          return `${colorEmoji(c)} ${colorLabel(c)}: <b>${v > 0 ? '+' : ''}${v.toFixed(2)}</b>${flag}`;
        }).join('\n') +
        `\n\n📝 Z > 2 = Acima do esperado\n📝 Z < -2 = Abaixo do esperado\n📝 Entre -2 e +2 = Normal` +
        (alerts.length > 0 ? `\n\n🚨 <b>${alerts.length} cor(es) com anomalia!</b>` : '\n\n✅ Distribuição dentro do esperado')
      );
    }

    // 13. Entropia de Shannon
    const entropy = calcShannonEntropy(results);
    if (entropy !== null) {
      const level = entropy > 0.9 ? '🔴 Muito Caótico' : entropy > 0.7 ? '🟠 Caótico' : entropy > 0.5 ? '🟡 Moderado' : '🟢 Previsível';
      messages.push(
        `🧠 <b>ENTROPIA DE SHANNON DOUBLE - ${now}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📊 Entropia: <b>${(entropy * 100).toFixed(1)}%</b>\n` +
        `📏 Classificação: <b>${level}</b>\n\n` +
        `📝 0% = Totalmente previsível\n` +
        `📝 100% = Totalmente aleatório\n` +
        `📝 Atual: ${level.split(' ')[1]}`
      );
    }

    // 14. Probabilidade Condicional
    const condProb = calcConditionalProb(results, 'double');
    if (condProb) {
      const sorted = Object.entries(condProb.probs).sort((a, b) => b[1] - a[1]);
      messages.push(
        `🔗 <b>PROB. CONDICIONAL DOUBLE - ${now}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📋 Após sair ${colorEmoji(condProb.lastColor)} ${colorLabel(condProb.lastColor)}:\n\n` +
        sorted.map(([c, p]) => `${colorEmoji(c)} ${colorLabel(c)}: <b>${p}%</b> ${formatBar(p, 100, 5)}`).join('\n') +
        `\n\n📝 Baseado nas últimas transições do histórico`
      );
    }

    // 15. Cadeia de Markov
    const markov = calcMarkovMatrix(results, 'double');
    if (markov) {
      const lastColor = getColor(results[0]);
      const probs = markov[lastColor] || {};
      const sorted = Object.entries(probs).sort((a, b) => b[1] - a[1]);
      messages.push(
        `⛓️ <b>CADEIA DE MARKOV DOUBLE - ${now}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📋 Matriz de transição (após ${colorEmoji(lastColor)} ${colorLabel(lastColor)}):\n\n` +
        sorted.map(([c, p]) => `${colorEmoji(c)} ${colorLabel(c)}: <b>${p}%</b>`).join('\n') +
        `\n\n📝 Probabilidade de transição de cor em cor`
      );
    }

    // 16. Correlação entre Cores
    const corr = calcCorrelation(results, 'double');
    if (corr) {
      const sorted = Object.entries(corr).sort((a, b) => b[1] - a[1]);
      messages.push(
        `🔀 <b>CORRELAÇÃO ENTRE CORES DOUBLE - ${now}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        sorted.map(([pair, val]) => {
          const [a, b] = pair.split('+');
          const level = val > 30 ? '🔗 Forte' : val > 15 ? '📊 Moderada' : '⚪ Fraca';
          return `${colorEmoji(a)}↔${colorEmoji(b)}: <b>${val}%</b> ${level}`;
        }).join('\n') +
        `\n\n📝 Correlação = frequência que uma cor aparece após a outra`
      );
    }

    // 17. Chi-Quadrado
    const chiSq = calcChiSquared(results, 'double');
    if (chiSq) {
      messages.push(
        `🧮 <b>CHI-QUADRADO DOUBLE - ${now}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📊 Valor χ²: <b>${chiSq.chiSq}</b>\n` +
        `📏 Graus de liberdade: <b>${chiSq.df}</b>\n` +
        `🎯 Resultado: <b>${chiSq.isRandom ? '🟢 ALEATÓRIO' : '🔴 NÃO-ALEATÓRIO'}</b>\n\n` +
        `📝 χ² < 7.815 = Resultado é aleatório\n` +
        `📝 χ² ≥ 7.815 = Padrão detectado\n\n` +
        `💡 ${chiSq.isRandom ? 'Distribuição segue padrão esperado' : 'Há indícios de padrão na distribuição'}`
      );
    }

    // 18. Média Móvel Ponderada
    const wma = calcWeightedMA(results, 'double');
    if (wma) {
      messages.push(
        `📉 <b>MÉDIA MÓVEL PONDERADA DOUBLE - ${now}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📋 Pesos maiores nos últimos resultados:\n\n` +
        wma.map(w => `${colorEmoji(w.color)} ${colorLabel(w.color)}: <b>${w.score}%</b> ${formatBar(w.score, 100, 8)}`).join('\n') +
        `\n\n📝 Resultados recentes têm mais influência`
      );
    }

    // 19. Índice de Estabilidade
    const stability = calcStabilityIndex(results, 'double');
    if (stability) {
      const entries = Object.entries(stability).sort((a, b) => b[1] - a[1]);
      messages.push(
        `📊 <b>ÍNDICE DE ESTABILIDADE DOUBLE - ${now}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        entries.map(([c, v]) => {
          const level = v > 80 ? '🟢 Muito Estável' : v > 60 ? '🟡 Estável' : v > 40 ? '🟠 Moderado' : '🔴 Instável';
          return `${colorEmoji(c)} ${colorLabel(c)}: <b>${v}%</b> ${level}`;
        }).join('\n') +
        `\n\n📝 Mede consistência ao longo do tempo\n` +
        `📝 100% = Perfeitamente estável`
      );
    }

    // 20. Previsão Bayesiana
    const bayes = calcBayesian(results, 'double');
    if (bayes) {
      messages.push(
        `🎲 <b>PREVISÃO BAYESIANA DOUBLE - ${now}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📋 Probabilidades atualizadas (Bayes):\n\n` +
        bayes.map(b => `${colorEmoji(b.color)} ${colorLabel(b.color)}: <b>${b.prob}%</b> ${formatBar(b.prob, 100, 8)}`).join('\n') +
        `\n\n📝 Combina probabilidade a priori com dados recentes\n` +
        `🎯 Maior probabilidade = ${colorEmoji(bayes[0].color)} ${colorLabel(bayes[0].color)}`
      );
    }

    return messages;
  }

  function buildAnalysis(results, game) {
    const n = results.length;
    const counts = countColors(results, game);
    const colors = game === 'wheel' ? ['RED', 'BLACK', 'BLUE', 'GREEN'] : ['RED', 'BLACK', 'GREEN'];
    const expected = { RED: 33, BLACK: 33, GREEN: 1, BLUE: 33 };
    if (game === 'double') { expected.RED = 48.6; expected.BLACK = 48.6; expected.GREEN = 2.8; }

    const sorted = colors.map(c => ({
      color: c,
      count: counts[c] || 0,
      percent: getPercent(counts[c] || 0, n),
      expected: expected[c] || 33
    })).sort((a, b) => b.count - a.count);

    const gaps = {};
    colors.forEach(c => { gaps[c] = 0; });
    for (let i = 0; i < results.length; i++) {
      const c = getColor(results[i]);
      if (gaps[c] === 0) gaps[c] = i;
    }

    const streak = { color: '', length: 0 };
    if (results.length > 0) {
      streak.color = getColor(results[0]);
      streak.length = 1;
      for (let i = 1; i < results.length; i++) {
        if (getColor(results[i]) === streak.color) streak.length++;
        else break;
      }
    }

    return { total: n, counts, colors, sorted, gaps, streak };
  }

  function estimateStreakProb(len) {
    if (len >= 7) return '~5%';
    if (len >= 5) return '~10%';
    if (len >= 4) return '~20%';
    return '~35%';
  }

  function calcGreenInterval(results) {
    const greenIdxs = [];
    results.forEach((r, i) => { if (getColor(r) === 'GREEN') greenIdxs.push(i); });
    if (greenIdxs.length < 2) return { avg: 0, count: greenIdxs.length };
    let sum = 0;
    for (let i = 1; i < greenIdxs.length; i++) sum += greenIdxs[i - 1] - greenIdxs[i];
    return { avg: Math.round(Math.abs(sum / (greenIdxs.length - 1))), count: greenIdxs.length };
  }

  function detectAdvancedPattern(results) {
    if (results.length < 8) return null;
    const colors = results.slice(0, 12).map(r => getColor(r));

    let altCount = 0;
    for (let i = 0; i < colors.length - 1; i++) {
      if (colors[i] !== colors[i + 1]) altCount++;
    }
    const altRate = altCount / (colors.length - 1);
    if (altRate > 0.75) return `⚡️ <b>Alternância forte</b> (${Math.round(altRate * 100)}%) - cores se alternam constantemente`;

    let repCount = 1;
    for (let i = 1; i < colors.length; i++) {
      if (colors[i] === colors[0]) repCount++;
      else break;
    }
    if (repCount >= 3) return `🔁 <b>Repetição</b> de ${colorLabel(colors[0])} detectada (${repCount}x seguidas)`;

    const pairs = [];
    for (let i = 0; i < colors.length - 1; i += 2) {
      pairs.push(colors[i] + '+' + colors[i + 1]);
    }
    const pairCounts = {};
    pairs.forEach(p => { pairCounts[p] = (pairCounts[p] || 0) + 1; });
    const topPair = Object.entries(pairCounts).sort((a, b) => b[1] - a[1])[0];
    if (topPair && topPair[1] >= 3) {
      const [a, b] = topPair[0].split('+');
      return `🔗 <b>Par repetido</b>: ${colorEmoji(a)}+${colorEmoji(b)} (${topPair[1]}x)`;
    }

    if (colors.length >= 6) {
      const half1 = colors.slice(0, 3).join('');
      const half2 = colors.slice(3, 6).join('');
      if (half1 === half2) return `🪞 <b>Espelhamento</b> detectado: ${colors.slice(0, 6).map(c => colorEmoji(c)).join(' ')}`;
    }

    return null;
  }

  function predictNext(results, analysis) {
    const last5 = results.slice(0, 5).map(r => getColor(r));
    const lastColor = last5[0];
    const dominated = last5.filter(c => c === lastColor).length;

    let trend = 'Neutro';
    let suggested = analysis.sorted[0].color;
    let confidence = 40;

    if (dominated >= 4) {
      trend = `Tendência de ${colorLabel(lastColor)}`;
      const others = analysis.colors.filter(c => c !== lastColor);
      suggested = others[0] || 'RED';
      confidence = 55;
    } else if (dominated <= 1) {
      trend = 'Alternância detectada';
      suggested = lastColor;
      confidence = 50;
    } else {
      trend = 'Sem tendência clara';
      const least = analysis.sorted[analysis.sorted.length - 1];
      suggested = least.color;
      confidence = 35;
    }

    if (analysis.streak.length >= 4) {
      trend = `Streak de ${colorLabel(analysis.streak.color)}`;
      suggested = analysis.colors.filter(c => c !== analysis.streak.color)[0] || 'RED';
      confidence = 60;
    }

    return { trend, suggested, confidence };
  }

  // === FUNÇÕES MATEMÁTICAS AVANÇADAS ===

  function calcStdDev(results, game) {
    const n = results.length;
    if (n < 5) return null;
    const colors = game === 'wheel' ? ['RED', 'BLACK', 'BLUE', 'GREEN'] : ['RED', 'BLACK', 'GREEN'];
    const expected = game === 'wheel'
      ? { RED: 0.33, BLACK: 0.33, GREEN: 0.01, BLUE: 0.33 }
      : { RED: 0.486, BLACK: 0.486, GREEN: 0.028 };
    const counts = countColors(results, game);
    let sumSq = 0;
    colors.forEach(c => {
      const obs = (counts[c] || 0) / n;
      const exp = expected[c] || 0.33;
      sumSq += Math.pow(obs - exp, 2);
    });
    return Math.sqrt(sumSq / colors.length);
  }

  function calcZScore(results, game) {
    const n = results.length;
    if (n < 10) return null;
    const colors = game === 'wheel' ? ['RED', 'BLACK', 'BLUE', 'GREEN'] : ['RED', 'BLACK', 'GREEN'];
    const expected = game === 'wheel'
      ? { RED: 0.33, BLACK: 0.33, GREEN: 0.01, BLUE: 0.33 }
      : { RED: 0.486, BLACK: 0.486, GREEN: 0.028 };
    const counts = countColors(results, game);
    const scores = {};
    colors.forEach(c => {
      const p = expected[c] || 0.33;
      const pHat = (counts[c] || 0) / n;
      const se = Math.sqrt((p * (1 - p)) / n);
      scores[c] = se > 0 ? ((pHat - p) / se) : 0;
    });
    return scores;
  }

  function calcShannonEntropy(results) {
    const n = results.length;
    if (n < 5) return null;
    const counts = countColors(results, 'wheel');
    let entropy = 0;
    Object.values(counts).forEach(c => {
      if (c > 0) {
        const p = c / n;
        entropy -= p * Math.log2(p);
      }
    });
    const maxEntropy = Math.log2(Object.keys(counts).length || 1);
    return maxEntropy > 0 ? entropy / maxEntropy : 0;
  }

  function calcConditionalProb(results, game) {
    const n = results.length;
    if (n < 10) return null;
    const colors = game === 'wheel' ? ['RED', 'BLACK', 'BLUE', 'GREEN'] : ['RED', 'BLACK', 'GREEN'];
    const trans = {};
    colors.forEach(c => { trans[c] = {}; colors.forEach(d => { trans[c][d] = 0; }); });
    for (let i = 0; i < n - 1; i++) {
      const from = getColor(results[i]);
      const to = getColor(results[i + 1]);
      if (trans[from] && trans[from][to] !== undefined) trans[from][to]++;
    }
    const lastColor = getColor(results[0]);
    const probs = {};
    const total = Object.values(trans[lastColor] || {}).reduce((s, v) => s + v, 0);
    colors.forEach(c => {
      probs[c] = total > 0 ? Math.round(((trans[lastColor][c] || 0) / total) * 100) : 0;
    });
    return { lastColor, probs };
  }

  function calcMarkovMatrix(results, game) {
    const n = results.length;
    if (n < 15) return null;
    const colors = game === 'wheel' ? ['RED', 'BLACK', 'BLUE', 'GREEN'] : ['RED', 'BLACK', 'GREEN'];
    const trans = {};
    colors.forEach(c => { trans[c] = {}; colors.forEach(d => { trans[c][d] = 0; }); });
    for (let i = 0; i < n - 1; i++) {
      const from = getColor(results[i]);
      const to = getColor(results[i + 1]);
      if (trans[from] && trans[from][to] !== undefined) trans[from][to]++;
    }
    const matrix = {};
    colors.forEach(from => {
      const total = Object.values(trans[from]).reduce((s, v) => s + v, 0);
      matrix[from] = {};
      colors.forEach(to => {
        matrix[from][to] = total > 0 ? Math.round((trans[from][to] / total) * 100) : 0;
      });
    });
    return matrix;
  }

  function calcCorrelation(results, game) {
    const n = results.length;
    if (n < 10) return null;
    const colors = game === 'wheel' ? ['RED', 'BLACK', 'BLUE', 'GREEN'] : ['RED', 'BLACK', 'GREEN'];
    const corr = {};
    colors.forEach(a => {
      colors.forEach(b => {
        if (a >= b) return;
        let both = 0;
        let aCount = 0;
        let bCount = 0;
        for (let i = 0; i < n; i++) {
          const c = getColor(results[i]);
          if (c === a) aCount++;
          if (c === b) bCount++;
          if (c === a && i > 0 && getColor(results[i - 1]) === b) both++;
          if (c === b && i > 0 && getColor(results[i - 1]) === a) both++;
        }
        const r = (aCount + bCount) > 0 ? Math.round((both / (aCount + bCount)) * 100) : 0;
        corr[a + '+' + b] = r;
      });
    });
    return corr;
  }

  function calcChiSquared(results, game) {
    const n = results.length;
    if (n < 20) return null;
    const colors = game === 'wheel' ? ['RED', 'BLACK', 'BLUE', 'GREEN'] : ['RED', 'BLACK', 'GREEN'];
    const expected = game === 'wheel'
      ? { RED: 0.33, BLACK: 0.33, GREEN: 0.01, BLUE: 0.33 }
      : { RED: 0.486, BLACK: 0.486, GREEN: 0.028 };
    const counts = countColors(results, game);
    let chiSq = 0;
    colors.forEach(c => {
      const obs = counts[c] || 0;
      const exp = (expected[c] || 0.33) * n;
      if (exp > 0) chiSq += Math.pow(obs - exp, 2) / exp;
    });
    const df = colors.length - 1;
    const isRandom = chiSq < 7.815;
    return { chiSq: Math.round(chiSq * 100) / 100, df, isRandom };
  }

  function calcWeightedMA(results, game) {
    const last20 = results.slice(0, 20);
    if (last20.length < 5) return null;
    const colors = game === 'wheel' ? ['RED', 'BLACK', 'BLUE', 'GREEN'] : ['RED', 'BLACK', 'GREEN'];
    const weights = {};
    colors.forEach(c => { weights[c] = 0; });
    last20.forEach((r, i) => {
      const c = getColor(r);
      const weight = last20.length - i;
      weights[c] = (weights[c] || 0) + weight;
    });
    const totalWeight = Object.values(weights).reduce((s, v) => s + v, 0);
    const result = colors.map(c => ({
      color: c,
      score: totalWeight > 0 ? Math.round((weights[c] / totalWeight) * 100) : 0
    })).sort((a, b) => b.score - a.score);
    return result;
  }

  function calcStabilityIndex(results, game) {
    const n = results.length;
    if (n < 20) return null;
    const colors = game === 'wheel' ? ['RED', 'BLACK', 'BLUE', 'GREEN'] : ['RED', 'BLACK', 'GREEN'];
    const chunkSize = Math.floor(n / 4);
    const chunks = [];
    for (let i = 0; i < 4; i++) {
      const chunk = results.slice(i * chunkSize, (i + 1) * chunkSize);
      chunks.push(countColors(chunk, game));
    }
    const stability = {};
    colors.forEach(c => {
      const vals = chunks.map(ch => ch[c] || 0);
      const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
      const variance = vals.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / vals.length;
      const cv = avg > 0 ? Math.sqrt(variance) / avg : 0;
      stability[c] = Math.round((1 - Math.min(cv, 1)) * 100);
    });
    return stability;
  }

  function calcBayesian(results, game) {
    const n = results.length;
    if (n < 10) return null;
    const colors = game === 'wheel' ? ['RED', 'BLACK', 'BLUE', 'GREEN'] : ['RED', 'BLACK', 'GREEN'];
    const prior = game === 'wheel'
      ? { RED: 0.33, BLACK: 0.33, GREEN: 0.01, BLUE: 0.33 }
      : { RED: 0.486, BLACK: 0.486, GREEN: 0.028 };
    const last5 = results.slice(0, 5);
    const recentCounts = countColors(last5, game);
    const posteriors = {};
    let totalPost = 0;
    colors.forEach(c => {
      const likelihood = ((recentCounts[c] || 0) + 0.5) / (5 + colors.length * 0.5);
      posteriors[c] = prior[c] * likelihood;
      totalPost += posteriors[c];
    });
    colors.forEach(c => {
      posteriors[c] = totalPost > 0 ? Math.round((posteriors[c] / totalPost) * 100) : 0;
    });
    const sorted = colors.map(c => ({ color: c, prob: posteriors[c] })).sort((a, b) => b.prob - a.prob);
    return sorted;
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function sendSummary() {
    const config = getSummaryConfig();
    const token = TelegramService.getToken();
    const chatId = config.channelId;
    if (!token || !chatId) return;

    const robots = RobotEngine.getAllRobots();
    const activeRobots = robots.filter(r => r.status === 'online');

    let totalWins = 0;
    let totalLosses = 0;
    let totalSignals = 0;
    const robotStats = [];

    activeRobots.forEach(robot => {
      const stats = robot.stats || {};
      const wins = stats.wins || 0;
      const losses = stats.losses || 0;
      const signals = stats.signals || 0;
      totalWins += wins;
      totalLosses += losses;
      totalSignals += signals;
      robotStats.push({
        name: robot.name,
        game: robot.game,
        wins,
        losses,
        signals,
        rate: (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 100) : 0
      });
    });

    const totalResolved = totalWins + totalLosses;
    const totalRate = totalResolved > 0 ? Math.round((totalWins / totalResolved) * 100) : 0;
    const now = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    robotStats.sort((a, b) => b.rate - a.rate);

    const lines = [
      '📊 <b>PLACAR GERAL - ' + now + '</b>',
      '━━━━━━━━━━━━━━━━━━━━',
      '',
      '🤖 Robôs Ativos: <b>' + activeRobots.length + '</b>',
      '',
      '✅ Wins: <b>' + totalWins + '</b>  |  ❌ Losses: <b>' + totalLosses + '</b>',
      '📈 Aproveitamento: <b>' + totalRate + '%</b>',
      '📨 Sinais Enviados: <b>' + totalSignals + '</b>',
      '',
      '━━━━━━━━━━━━━━━━━━━━',
      '<b>📋 DETALHES POR ROBÔ</b>',
      '━━━━━━━━━━━━━━━━━━━━'
    ];

    robotStats.forEach(rs => {
      const gameIcon = rs.game === 'wheel' ? '🎡' : '🎲';
      const bar = formatRateBar(rs.rate);
      lines.push('');
      lines.push(gameIcon + ' <b>' + escapeHtml(rs.name) + '</b>');
      lines.push('✅ ' + rs.wins + 'W  |  ❌ ' + rs.losses + 'L  |  📊 ' + rs.rate + '%');
      lines.push(bar);
    });

    lines.push('');
    lines.push('━━━━━━━━━━━━━━━━━━━━');
    lines.push('🤖 Sistema de Robos');

    const text = lines.join('\n');

    await TelegramService.api(token, 'sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
  }

  function formatRateBar(rate) {
    const filled = Math.round((rate / 100) * 8);
    const empty = 8 - filled;
    return '🟩'.repeat(filled) + '⬛️'.repeat(empty);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function handleRobotStarted(d) {
    const robot = RobotEngine.getRobot(d?.id);
    if (!robot) return;
    emit({
      robotId: robot.id,
      robotName: robot.name,
      robotStatus: 'online',
      game: robot.game,
      type: 'started',
      message: `🚀 Robô iniciado | Estratégia: ${formatStrategy(robot.strategy)}`
    });
  }

  function handleRobotStopped(d) {
    const robot = RobotEngine.getRobot(d?.id);
    if (!robot) return;
    emit({
      robotId: robot.id,
      robotName: robot.name,
      robotStatus: 'offline',
      game: robot.game,
      type: 'stopped',
      message: '🛑 Robô parado'
    });
  }

  function getGaleMax(robot, targetColor) {
    if (robot.game === 'wheel') {
      const galeByColor = robot.galeByColor || {};
      const colorKey = { RED: 'red', BLACK: 'grey', GREY: 'grey', BLUE: 'blue' };
      const key = colorKey[targetColor?.toUpperCase()] || 'grey';
      return galeByColor[key] ?? 1;
    }
    return robot.gale?.max || 0;
  }

  function getStats(robot) {
    const stats = robot.stats || {};
    const wins = stats.wins || 0;
    const losses = stats.losses || 0;
    const rate = (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;
    return { wins, losses, rate };
  }

  function formatStrategy(strategy) {
    const map = {
      alternancia: 'Alternância', repeticao: 'Repetição', frequencia: 'Frequência',
      tendencia: 'Tendência', espelhamento: 'Espelhamento', diagonal: 'Diagonal'
    };
    return map[strategy] || strategy || '--';
  }

  function colorLabelBackup(color) {
    const c = String(color || '').toUpperCase();
    if (c === 'RED') return 'VERMELHO';
    if (c === 'BLACK' || c === 'GREY' || c === 'GRAY') return 'PRETO';
    if (c === 'GREEN') return 'VERDE';
    if (c === 'BLUE') return 'AZUL';
    return c || '--';
  }

  function colorEmojiBackup(color) {
    const c = String(color || '').toUpperCase();
    if (c === 'RED') return '🔴';
    if (c === 'BLACK' || c === 'GREY' || c === 'GRAY') return '⚫️';
    if (c === 'GREEN') return '🟢';
    if (c === 'BLUE') return '🔵';
    return '⚪️';
  }

  function setEnabled(val) { enabled = !!val; }
  function isEnabled() { return enabled; }

  return {
    init, setEnabled, isEnabled,
    sendSummary, getSummaryConfig, saveSummaryConfig, startSummaryTimer,
    sendAllAnalysis, getAnalysisConfig, saveAnalysisConfig, startAnalysisTimer
  };
})();
