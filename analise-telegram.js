const AnaliseTelegramService = (() => {
  const STORAGE_KEY = 'analise-telegram-messages-v1';
  const API_BASE = 'https://api.telegram.org';
  let token = null;
  let queue = [];
  let processing = false;

  function getStorage() {
    return Store.get(STORAGE_KEY) || {};
  }

  function setStorage(data) {
    Store.set(STORAGE_KEY, data);
  }

  function saveMessageId(botId, messageId) {
    const bots = Store.get('analise-bots-v1') || {};
    if (bots[botId]) {
      bots[botId].messageId = messageId;
      Store.set('analise-bots-v1', bots);
    }
  }

  function getToken() {
    if (token) return token;
    token = localStorage.getItem('telegram-bot-token') || null;
    return token;
  }

  function setToken(t) {
    token = t;
  }

  async function apiCall(method, body) {
    const tk = getToken();
    if (!tk) return { ok: false, description: 'Token não configurado' };
    try {
      const resp = await fetch(`${API_BASE}/bot${tk}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return await resp.json();
    } catch (e) {
      return { ok: false, description: e.message };
    }
  }

  async function sendMessage(chatId, text) {
    return apiCall('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
  }

  async function editMessage(chatId, messageId, text) {
    return apiCall('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
  }

  async function deleteMessage(chatId, messageId) {
    return apiCall('deleteMessage', {
      chat_id: chatId,
      message_id: messageId
    });
  }

  function formatarRelatorio(relatorio, analises, cfg, analiseOrder) {
    const { botName, game, historico, estatistica, padroes, temporal, previsao, probabilidade, tendencia, sequencia, predAvancada, anomalias, confluenciaIA, matrizTransicao, entropia, algoritmoGenetico, multidimensional, combinada, timestamp } = relatorio;
    const horario = new Date(timestamp).toLocaleTimeString('pt-BR');
    const jogoLabel = game === 'wheel' ? 'WHEEL' : 'DOUBLE';
    const allAnalises = ['historico','estatistica','padroes','previsao','temporal','probabilidade','tendencia','sequencia','predAvancada','anomalias','confluenciaIA','matrizTransicao','entropia','algoritmoGenetico','multidimensional'];
    const selBase = Array.isArray(analises) ? analises : allAnalises;
    const order = Array.isArray(analiseOrder) ? analiseOrder : selBase;
    const sel = order.filter(id => selBase.includes(id));
    cfg = cfg || {};

    let msg = '';

    const sectionRenderers = {
      historico: () => {
        if (!historico) return '';
        const epl = (cfg.historico && cfg.historico.emojisPerLine) || 13;
        const emojis = historico.emojis;
        let s = '';
        for (let i = 0; i < emojis.length; i += epl) {
          s += emojis.slice(i, i + epl).join('') + '\n';
        }
        s += `🎡 <b>HISTÓRICO RECENTE ${jogoLabel}</b>\n`;
        s += `━━━━━━━━━━━━━━━━━━━━\n`;
        return s;
      },
      estatistica: () => {
        if (!estatistica) return '';
        const ec = cfg.estatistica || {};
        let s = `📈 <b>Estatísticas</b> (últimos ${estatistica.total})\n━━━━━━━━━━━━━━━━━━━━\n`;
        if (ec.showDistribution !== false) {
          estatistica.distribution.forEach(d => {
            s += `${d.label}: ${d.count} (${d.percent}%)\n<code>  ${d.bar}</code>\n`;
          });
        }
        if (ec.showStreak !== false) {
          const sc = estatistica.streak.color ? (AnaliseEngine.COLOR_LABELS[estatistica.streak.color] || estatistica.streak.color) : 'N/A';
          s += `🔥 Streak: ${sc} x${estatistica.streak.length}\n`;
        }
        if (ec.showMaxStreaks !== false) {
          const maxN = ec.maxStreakEntries || 3;
          const ms = Object.entries(estatistica.maxStreaks).sort((a, b) => b[1] - a[1]).slice(0, maxN);
          if (ms.length > 0) s += `🏆 Maior: ${ms.map(([c, l]) => `${AnaliseEngine.COLOR_LABELS[c] || c} x${l}`).join(', ')}\n`;
        }
        if (ec.showMostDelayed !== false && estatistica.mostDelayed.length > 0) {
          s += `⏳ Atrasada: ${estatistica.mostDelayed[0].label} (${estatistica.mostDelayed[0].gap}rd)\n`;
        }
        if (ec.showChi2 !== false || ec.showStdDev !== false) {
          const parts = [];
          if (ec.showChi2 !== false) parts.push(`χ²: ${estatistica.chi2}`);
          if (ec.showStdDev !== false) parts.push(`σ: ${estatistica.stdDev}`);
          s += `📐 ${parts.join(' | ')}\n`;
        }
        return s + '\n';
      },
      padroes: () => {
        if (!padroes || !padroes.patterns) return '';
        const pc = cfg.padroes || {};
        let s = `🔄 <b>Padrões</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
        padroes.patterns.forEach(p => { s += `${p.detected ? '✅' : '❌'} ${p.name}: ${p.confidence}%\n`; });
        if (pc.showCorrelations !== false && padroes.correlations) {
          s += `📊 ${padroes.correlations.map(c => `L${c.lag}:${c.correlation}%`).join(' ')}\n`;
        }
        return s + '\n';
      },
      temporal: () => {
        if (!temporal) return '';
        const tc = cfg.temporal || {};
        let s = `⏰ <b>Temporal</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
        if (tc.showVolatility !== false) s += `📊 Volatilidade: ${temporal.volatility}%\n`;
        if (tc.showCycles !== false && temporal.cycles.length > 0) {
          temporal.cycles.forEach(c => { s += `🔄 Ciclo ${c.label}: a cada ${c.avgInterval}rd (${c.regular ? 'Reg' : 'Irreg'})\n`; });
        }
        if (tc.showPeriods !== false && temporal.periods.length > 0) {
          s += `📋 Períodos:\n`;
          temporal.periods.forEach(p => { s += `  ${p.start}-${p.end}: ${p.label} (${p.count}/${p.total})\n`; });
        }
        return s + '\n';
      },
      previsao: () => {
        if (!previsao || !previsao.predictions) return '';
        const prc = cfg.previsao || {};
        let s = `🧠 <b>Previsão IA</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
        previsao.predictions.forEach((p, i) => {
          s += `${i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'} ${p.label}: ${p.probability}%\n`;
        });
        if (prc.showConfidence !== false) s += `🎯 Confiança: <b>${previsao.confidence}</b> (${previsao.score}/100)\n`;
        if (prc.showStreakInfluence !== false && previsao.streak && previsao.streak.length >= 3) {
          s += `⚡ ${previsao.streak.length}x ${AnaliseEngine.COLOR_LABELS[previsao.streak.color] || previsao.streak.color} pode influenciar\n`;
        }
        return s + '\n';
      },
      probabilidade: () => {
        if (!probabilidade || !probabilidade.colors) return '';
        const pc = cfg.probabilidade || {};
        let s = `🔢 <b>Probabilidade</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
        probabilidade.colors.forEach(c => {
          s += `${c.label}\n  Obs: ${c.observed}% | Esp: ${c.expected}% | Δ: ${c.deviation}%\n  ${c.signal} | Atraso: ${c.gap}rd\n`;
        });
        if (pc.showEdge !== false) s += `📊 Edge total: ${probabilidade.edge}%\n`;
        if (pc.showRecomendacao !== false) s += `💡 ${probabilidade.recomendacao}\n`;
        return s + '\n';
      },
      tendencia: () => {
        if (!tendencia || !tendencia.trends) return '';
        const tc = cfg.tendencia || {};
        let s = `📊 <b>Tendência</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
        tendencia.trends.forEach(t => {
          s += `${t.label}: ${t.direction} (${t.change > 0 ? '+' : ''}${t.change}%)\n<code>  ${'━'.repeat(10)}</code>\n`;
        });
        if (tc.showPeriods !== false && tendencia.periods.length > 0) {
          s += `📋 Períodos (${tendencia.periodSize}rd):\n`;
          tendencia.periods.forEach(p => {
            const dist = Object.entries(p.distribution).map(([c, d]) => `${AnaliseEngine.COLOR_LABELS[c] || c}: ${d.percent}%`).join(' | ');
            s += `  ${p.start}-${p.end}: ${dist}\n`;
          });
        }
        s += `📝 ${tendencia.summary}\n`;
        return s + '\n';
      },
      sequencia: () => {
        if (!sequencia || !sequencia.pairs) return '';
        const sc = cfg.sequencia || {};
        let s = `🔗 <b>Sequências</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
        if (sequencia.pairs.length > 0) {
          s += `🔀 Pares frequentes:\n`;
          sequencia.pairs.forEach(p => { s += `  ${p.fromLabel}→${p.toLabel}: ${p.count}x (${p.percent}%)\n`; });
        }
        if (sc.showTriplets !== false && sequencia.triplets.length > 0) {
          s += `🎲 Tripletos:\n`;
          sequencia.triplets.forEach(t => { s += `  ${t.parts.map(p => AnaliseEngine.COLOR_LABELS[p] || p).join('')}: ${t.count}x (${t.percent}%)\n`; });
        }
        if (sc.showAfterRules !== false && sequencia.afterRules.length > 0) {
          s += `📐 Regras "após":\n`;
          sequencia.afterRules.slice(0, 5).forEach(r => { s += `  Após ${r.afterLabel} → ${r.nextLabel}: ${r.percent}%\n`; });
        }
        s += `📝 ${sequencia.summary}\n`;
        return s + '\n';
      },
      predAvancada: () => {
        if (!predAvancada || !predAvancada.predictions) return '';
        const pc = cfg.predAvancada || {};
        let s = `🧮 <b>Predição Avançada</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
        predAvancada.predictions.forEach((p, i) => {
          s += `${i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'} ${p.label}: ${p.finalProb}%\n<code>  Bayes:${p.bayes} Markov:${p.markov} Reg:${p.regression}</code>\n`;
        });
        if (pc.showModels !== false) s += `📊 Modelos: B:${predAvancada.models.bayes} M:${predAvancada.models.markov} R:${predAvancada.models.regression}\n`;
        if (pc.showConfidence !== false) s += `🎯 Confiança: <b>${predAvancada.confidence}</b> (${predAvancada.score}/100)\n`;
        return s + '\n';
      },
      anomalias: () => {
        if (!anomalias || !anomalias.anomalies) return '';
        const ac = cfg.anomalias || {};
        let s = `🔍 <b>Anomalias</b> (${anomalias.score}/100)\n━━━━━━━━━━━━━━━━━━━━\n`;
        if (anomalias.anomalies.length > 0) {
          anomalias.anomalies.forEach(a => { s += `${a.severity === 'Alta' ? '🔴' : '🟡'} ${a.type}\n  ${a.description}\n`; });
        } else { s += `🟢 Nenhuma anomalia detectada\n`; }
        if (ac.showSummary !== false) s += `📝 ${anomalias.summary}\n`;
        return s + '\n';
      },
      confluenciaIA: () => {
        if (!confluenciaIA || !confluenciaIA.factors) return '';
        const cic = cfg.confluenciaIA || {};
        let s = `🎯 <b>Confluência IA</b> (${confluenciaIA.totalScore}/100)\n━━━━━━━━━━━━━━━━━━━━\n`;
        confluenciaIA.factors.forEach(f => {
          s += `${f.name}: ${f.score} <code>${'█'.repeat(Math.round(f.score / 10)) + '░'.repeat(10 - Math.round(f.score / 10))}</code>\n`;
        });
        if (cic.showRecommendation !== false) s += `📌 ${confluenciaIA.recommendation}\n`;
        if (cic.showTopFactor !== false) s += `🏆 Maior impacto: ${confluenciaIA.topFactor}\n`;
        return s + '\n';
      },
      matrizTransicao: () => {
        if (!matrizTransicao || !matrizTransicao.matrixViz) return '';
        const mc = cfg.matrizTransicao || {};
        let s = `🔲 <b>Matriz de Transição</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
        s += `📊 Entropia: ${matrizTransicao.entropy}% | Max: ${matrizTransicao.maxEntropy}%\n\n`;
        const header = ['🔴', '⚫', '🔵', '🟢'].slice(0, matrizTransicao.matrixViz.length).join('  ');
        s += `<code>  ${header}</code>\n`;
        const rowLabels = ['🔴', '⚫', '🔵', '🟢'];
        matrizTransicao.matrixViz.forEach((row, i) => { s += `<code>${rowLabels[i]} ${row}</code>\n`; });
        s += '\n';
        if (matrizTransicao.flows.length > 0) {
          s += `🔀 Fluxos fortes:\n`;
          matrizTransicao.flows.slice(0, 4).forEach(f => { s += `  ${f.fromLabel} → ${f.toLabel}: ${f.percent}% (${f.strength})\n`; });
        }
        if (mc.showPrediction !== false && matrizTransicao.predictions) {
          s += `\n🎯 Após ${matrizTransicao.lastColorLabel}:\n`;
          matrizTransicao.predictions.forEach(p => { s += `  ${p.label}: ${p.probability}%\n`; });
        }
        return s + '\n';
      },
      entropia: () => {
        if (!entropia || !entropia.visBar) return '';
        const ec = cfg.entropia || {};
        let s = `🌀 <b>Entropia</b> (${entropia.score}/100)\n━━━━━━━━━━━━━━━━━━━━\n`;
        s += `📐 Shannon: ${entropia.shannon} / ${entropia.maxShannon}\n`;
        s += `🗜️ Compressão: ${entropia.compressionRatio}%\n`;
        s += `🔣 Símbolos únicos: ${entropia.uniqueSymbols}\n\n`;
        if (ec.showDistribution !== false) {
          s += `📊 Distribuição:\n`;
          entropia.visBar.forEach(bar => { s += `<code>  ${bar}</code>\n`; });
        }
        if (entropia.patterns.length > 0) {
          s += `\n🔍 Padrões detectados:\n`;
          entropia.patterns.forEach(p => {
            if (p.name === 'Sequência Longa') s += `  ⚠️ ${p.name}: ${p.maxRun}x consecutivas\n`;
            else if (p.name === 'Par Dominante') s += `  ⚠️ ${p.name}: ${p.pair} (${p.count}x)\n`;
            else if (p.name === 'Tripleto Frequente') s += `  ⚠️ ${p.name}: ${p.triplet} (${p.count}x)\n`;
            else s += `  ⚠️ ${p.name}: ${p.rate}%\n`;
          });
        }
        if (ec.showAssessment !== false) s += `\n📝 ${entropia.assessment}\n`;
        return s + '\n';
      },
      algoritmoGenetico: () => {
        if (!algoritmoGenetico || !algoritmoGenetico.bestRule) return '';
        const agc = cfg.algoritmoGenetico || {};
        let s = `🧬 <b>Algoritmo Genético</b> (${algoritmoGenetico.fitness}%)\n━━━━━━━━━━━━━━━━━━━━\n`;
        s += `🏆 Melhor regra:\n<code>  ${algoritmoGenetico.bestRule.ruleStr}</code>\n`;
        s += `  → ${algoritmoGenetico.bestRule.predictionLabel}\n`;
        s += `  Fitness: ${algoritmoGenetico.bestRule.fitness}% | Confiança: ${algoritmoGenetico.confianca}\n\n`;
        if (agc.showHistory !== false) {
          s += `📈 Evolução (15 gerações):\n`;
          algoritmoGenetico.historyViz.forEach(line => { s += `<code>  ${line}</code>\n`; });
        }
        if (agc.showTopRules !== false && algoritmoGenetico.topRules.length > 1) {
          s += `\n🥈 Top regras:\n`;
          algoritmoGenetico.topRules.slice(1).forEach((r, i) => {
            s += `  ${i === 2 ? '🥉' : '🥈'} ${r.fitness}% → ${r.prediction}\n<code>    ${r.conditions}</code>\n`;
          });
        }
        return s + '\n';
      },
      multidimensional: () => {
        if (!multidimensional || !multidimensional.radar) return '';
        const mdc = cfg.multidimensional || {};
        let s = `🎯 <b>Multidimensional</b> (${multidimensional.score}/100)\n━━━━━━━━━━━━━━━━━━━━\n`;
        multidimensional.radar.forEach(line => { s += `<code>  ${line}</code>\n`; });
        s += '\n';
        if (mdc.showTopFactor !== false) s += `🏆 Maior: ${multidimensional.topFactor}\n`;
        if (mdc.showLowFactor !== false) s += `⚠️ Menor: ${multidimensional.lowFactor}\n`;
        if (mdc.showRecommendation !== false) s += `📌 ${multidimensional.recommendation}\n`;
        return s + '\n';
      }
    };

    sel.forEach(key => {
      if (sectionRenderers[key]) {
        const rendered = sectionRenderers[key]();
        if (rendered) msg += rendered;
      }
    });

    if (combinada) {
      const cc = cfg.combinada || {};
      if (cc.showScore !== false) {
        msg += `💡 <b>Score: ${combinada.score}/100</b>\n`;
      }
      if (cc.showRecomendacao !== false) {
        msg += `📌 ${combinada.recomendacao}\n`;
      }
    }

    msg += `🕕 ${horario}\n`;

    return msg;
  }

  function escapeMarkdown(text) {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
  }

  async function enviarRelatorio(botId, relatorio) {
    const bot = AnaliseEngine.getBot(botId);
    if (!bot || !bot.telegramEnabled || !bot.telegramChannel) {
      console.log('[AnaliseTelegram] Bot nao configurado para Telegram:', botId);
      return;
    }

    const chatId = bot.telegramChannel;
    const text = formatarRelatorio(relatorio, bot.analises, bot.config, bot.analiseOrder);
    const storage = getStorage();

    console.log('[AnaliseTelegram] Enviando para chat:', chatId);

    if (bot.messageId) {
      const result = await editMessage(chatId, bot.messageId, text);
      if (result.ok) {
        if (typeof recordSend === 'function') recordSend(chatId, bot.name);
        return;
      }
      if (result.description && result.description.includes('message is not modified')) return;
      if (result.description && (result.description.includes('message to edit not found') || result.description.includes('MESSAGE_TO_EDIT_NOT_FOUND'))) {
        bot.messageId = null;
        saveMessageId(botId, null);
      }
      console.log('[AnaliseTelegram] Edit falhou, enviando nova mensagem:', result.description);
    }

    const result = await sendMessage(chatId, text);
    console.log('[AnaliseTelegram] Resultado envio:', result);
    if (result.ok && result.result) {
      bot.messageId = result.result.message_id;
      saveMessageId(botId, bot.messageId);
      storage[botId] = { messageId: bot.messageId, chatId };
      setStorage(storage);
      if (typeof recordSend === 'function') recordSend(chatId, bot.name);
    } else {
      console.error('[AnaliseTelegram] Erro ao enviar:', result.description, result.parameters);
    }
  }

  async function removerMensagem(botId) {
    const bot = AnaliseEngine.getBot(botId);
    if (!bot) return;

    const storage = getStorage();
    const msgData = storage[botId];
    if (msgData && msgData.messageId && msgData.chatId) {
      await deleteMessage(msgData.chatId, msgData.messageId);
      delete storage[botId];
      setStorage(storage);
    }

    bot.messageId = null;
    saveMessageId(botId, null);
  }

  function processQueue() {
    if (processing || queue.length === 0) return;
    processing = true;
    const { botId, relatorio } = queue.shift();
    enviarRelatorio(botId, relatorio)
      .catch(e => console.error('[AnaliseTelegram]', e))
      .finally(() => {
        processing = false;
        setTimeout(processQueue, 50);
      });
  }

  function queueRelatorio(botId, relatorio) {
    queue = queue.filter(q => q.botId !== botId);
    queue.push({ botId, relatorio });
    processQueue();
  }

  function init() {
    if (!document.title.includes('WS Background')) return;

    EventBus.on('analisebot:updated', (data) => {
      const bot = AnaliseEngine.getBot(data.botId);
      if (!bot || !bot.lastReport) return;
      queueRelatorio(data.botId, bot.lastReport);
    });

    EventBus.on('analisebot:stopped', (data) => {
      removerMensagem(data.botId).catch(e => console.error('[AnaliseTelegram]', e));
    });

    EventBus.on('analisebot:deleted', (data) => {
      removerMensagem(data.botId).catch(e => console.error('[AnaliseTelegram]', e));
    });
  }

  init();

  return {
    setToken,
    getToken,
    enviarRelatorio,
    removerMensagem,
    formatarRelatorio,
    sendMessage,
    editMessage,
    deleteMessage,
    apiCall,
    async testConnection() {
      const tk = getToken();
      if (!tk) return { ok: false, description: 'Token nao configurado' };
      return apiCall('getMe', {});
    }
  };
})();
