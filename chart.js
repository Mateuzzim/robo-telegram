const ChartService = (() => {
  const CHART_INTERVAL = 30 * 1000;
  const CHART_STORAGE_KEY = 'news-chart-config-v1';
  let chartTimer = null;
  let canvas = null;
  let ctx = null;

  function init() {
    canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 500;
    ctx = canvas.getContext('2d');
    startChartTimer();
  }

  function startChartTimer() {
    if (chartTimer) clearInterval(chartTimer);
    const config = getChartConfig();
    if (!config.enabled || !config.channelId) return;
    chartTimer = setInterval(() => sendChart(), CHART_INTERVAL);
  }

  function getChartConfig() {
    try {
      return JSON.parse(localStorage.getItem(CHART_STORAGE_KEY) || '{}');
    } catch { return {}; }
  }

  function saveChartConfig(config) {
    localStorage.setItem(CHART_STORAGE_KEY, JSON.stringify(config));
    startChartTimer();
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

  function colorToHex(color) {
    const map = {
      RED: '#ff4a55',
      BLACK: '#2a2e3a',
      GREY: '#2a2e3a',
      GRAY: '#2a2e3a',
      GREEN: '#29d978',
      BLUE: '#2368ff',
      WHITE: '#e8eaf0'
    };
    return map[color] || '#6b7280';
  }

  function colorLabel(color) {
    const map = { RED: 'VERMELHO', BLACK: 'PRETO', GREY: 'PRETO', GRAY: 'PRETO', GREEN: 'VERDE', BLUE: 'AZUL' };
    return map[color] || color || '--';
  }

  function drawRoundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function generateChart() {
    const robots = RobotEngine.getAllRobots().filter(r => r.status === 'online');
    const wheelResults = loadHistory('wheel');
    const doubleResults = loadHistory('double');
    const now = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const robotsHeight = robots.length * 40 + 60;
    const statsHeight = 160;
    const chartsHeight = 200;
    const totalHeight = Math.max(500, statsHeight + robotsHeight + chartsHeight + 40);

    canvas.height = totalHeight;
    ctx.fillStyle = '#0b0d12';
    ctx.fillRect(0, 0, 800, totalHeight);

    ctx.fillStyle = '#12151c';
    drawRoundRect(15, 15, 770, 60, 10);
    ctx.fill();

    ctx.fillStyle = '#29d978';
    ctx.font = 'bold 18px Segoe UI, sans-serif';
    ctx.fillText('📊 DESEMPENHO DOS ROBÔS', 30, 42);
    ctx.fillStyle = '#6b7280';
    ctx.font = '12px Segoe UI, sans-serif';
    ctx.fillText(now, 700, 42);

    const totalWins = robots.reduce((s, r) => s + (r.stats?.wins || 0), 0);
    const totalLosses = robots.reduce((s, r) => s + (r.stats?.losses || 0), 0);
    const totalRate = (totalWins + totalLosses) > 0 ? Math.round((totalWins / (totalWins + totalLosses)) * 100) : 0;

    const statsY = 90;
    const statItems = [
      { label: 'ROBÔS', value: robots.length, color: '#2368ff' },
      { label: 'WINS', value: totalWins, color: '#29d978' },
      { label: 'LOSSES', value: totalLosses, color: '#ff4a55' },
      { label: 'APROVEIT.', value: totalRate + '%', color: '#e0c540' }
    ];

    statItems.forEach((item, i) => {
      const x = 30 + i * 195;
      ctx.fillStyle = '#1a1e28';
      drawRoundRect(x, statsY, 180, 55, 8);
      ctx.fill();
      ctx.fillStyle = item.color;
      ctx.font = 'bold 24px Segoe UI, sans-serif';
      ctx.fillText(item.value, x + 15, statsY + 35);
      ctx.fillStyle = '#6b7280';
      ctx.font = '10px Segoe UI, sans-serif';
      ctx.fillText(item.label, x + 15, statsY + 50);
    });

    const robotsY = 165;
    ctx.fillStyle = '#1a1e28';
    drawRoundRect(15, robotsY, 770, robots.length * 40 + 40, 10);
    ctx.fill();

    ctx.fillStyle = '#e8eaf0';
    ctx.font = 'bold 13px Segoe UI, sans-serif';
    ctx.fillText('📋 ROBÔS ATIVOS', 30, robotsY + 25);

    robots.forEach((robot, i) => {
      const y = robotsY + 40 + i * 40;
      const stats = robot.stats || {};
      const wins = stats.wins || 0;
      const losses = stats.losses || 0;
      const rate = (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;
      const gameIcon = robot.game === 'wheel' ? '🎡' : '🎲';

      ctx.fillStyle = '#222733';
      drawRoundRect(30, y, 740, 35, 6);
      ctx.fill();

      ctx.fillStyle = '#29d978';
      ctx.beginPath();
      ctx.arc(50, y + 18, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#e8eaf0';
      ctx.font = '12px Segoe UI, sans-serif';
      ctx.fillText(gameIcon + ' ' + (robot.name || 'Robô'), 62, y + 22);

      ctx.fillStyle = '#29d978';
      ctx.font = '11px Segoe UI, sans-serif';
      ctx.fillText('✅' + wins, 250, y + 22);

      ctx.fillStyle = '#ff4a55';
      ctx.fillText('❌' + losses, 320, y + 22);

      ctx.fillStyle = rate >= 60 ? '#29d978' : rate >= 40 ? '#e0c540' : '#ff4a55';
      ctx.fillText('📊' + rate + '%', 390, y + 22);

      const barX = 460;
      const barW = 280;
      const filled = Math.round((rate / 100) * barW);
      ctx.fillStyle = '#0b0d12';
      drawRoundRect(barX, y + 8, barW, 16, 4);
      ctx.fill();
      ctx.fillStyle = rate >= 60 ? '#29d978' : rate >= 40 ? '#e0c540' : '#ff4a55';
      if (filled > 0) {
        drawRoundRect(barX, y + 8, Math.max(filled, 4), 16, 4);
        ctx.fill();
      }

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 9px Segoe UI, sans-serif';
      ctx.fillText(rate + '%', barX + barW / 2 - 12, y + 20);
    });

    if (robots.length === 0) {
      ctx.fillStyle = '#6b7280';
      ctx.font = '13px Segoe UI, sans-serif';
      ctx.fillText('Nenhum robô ativo no momento', 300, robotsY + 65);
    }

    const chartY = robotsY + robots.length * 40 + 60;
    const remainingH = totalHeight - chartY - 20;
    if (remainingH > 100) {
      ctx.fillStyle = '#1a1e28';
      drawRoundRect(15, chartY, 380, remainingH, 10);
      ctx.fill();

      ctx.fillStyle = '#e8eaf0';
      ctx.font = 'bold 13px Segoe UI, sans-serif';
      ctx.fillText('🎡 WHEEL - Últimos 20', 30, chartY + 25);

      const wheel20 = wheelResults.slice(0, 20);
      const wheelCounts = {};
      wheel20.forEach(r => { const c = getColor(r); wheelCounts[c] = (wheelCounts[c] || 0) + 1; });
      const wheelColors = ['RED', 'BLACK', 'BLUE', 'GREEN'];
      let wx = 30;
      wheel20.forEach((r, i) => {
        const c = getColor(r);
        ctx.fillStyle = colorToHex(c);
        ctx.beginPath();
        ctx.arc(wx + i * 17, chartY + 50, 6, 0, Math.PI * 2);
        ctx.fill();
      });

      let wy = chartY + 75;
      wheelColors.forEach(c => {
        if (wheelCounts[c]) {
          ctx.fillStyle = colorToHex(c);
          ctx.beginPath();
          ctx.arc(40, wy, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#a0a6b8';
          ctx.font = '11px Segoe UI, sans-serif';
          ctx.fillText(colorLabel(c) + ': ' + wheelCounts[c] + 'x', 52, wy + 4);
          wy += 18;
        }
      });

      ctx.fillStyle = '#1a1e28';
      drawRoundRect(405, chartY, 380, remainingH, 10);
      ctx.fill();

      ctx.fillStyle = '#e8eaf0';
      ctx.font = 'bold 13px Segoe UI, sans-serif';
      ctx.fillText('🎲 DOUBLE - Últimos 20', 420, chartY + 25);

      const double20 = doubleResults.slice(0, 20);
      const doubleCounts = {};
      double20.forEach(r => { const c = getColor(r); doubleCounts[c] = (doubleCounts[c] || 0) + 1; });
      const doubleColors = ['RED', 'BLACK', 'GREEN'];
      let dx = 420;
      double20.forEach((r, i) => {
        const c = getColor(r);
        ctx.fillStyle = colorToHex(c);
        ctx.beginPath();
        ctx.arc(dx + i * 17, chartY + 50, 6, 0, Math.PI * 2);
        ctx.fill();
      });

      let dy = chartY + 75;
      doubleColors.forEach(c => {
        if (doubleCounts[c]) {
          ctx.fillStyle = colorToHex(c);
          ctx.beginPath();
          ctx.arc(430, dy, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#a0a6b8';
          ctx.font = '11px Segoe UI, sans-serif';
          ctx.fillText(colorLabel(c) + ': ' + doubleCounts[c] + 'x', 442, dy + 4);
          dy += 18;
        }
      });
    }

    return canvas;
  }

  async function sendChart() {
    const config = getChartConfig();
    if (!config.enabled || !config.channelId) {
      console.log('[ChartService] Desabilitado ou sem channelId. config:', config);
      return;
    }

    const token = TelegramService.getToken();
    if (!token) {
      console.warn('[ChartService] Sem token do Telegram');
      return;
    }

    generateChart();
    console.log('[ChartService] Canvas gerado, convertendo para blob...');

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
      console.warn('[ChartService] Falha ao gerar blob do canvas');
      return;
    }
    console.log('[ChartService] Blob gerado, tamanho:', blob.size, 'bytes');

    const formData = new FormData();
    formData.append('chat_id', config.channelId);
    formData.append('photo', blob, 'chart.png');
    if (config.caption) {
      const now = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      formData.append('caption', '📊 Gráfico de Desempenho - ' + now);
    }

    try {
      console.log('[ChartService] Enviando para chat_id:', config.channelId);
      const resp = await fetch('https://api.telegram.org/bot' + token + '/sendPhoto', {
        method: 'POST',
        body: formData
      });
      const data = await resp.json();
      if (!data.ok) {
        console.warn('[ChartService] Erro ao enviar:', data.description, '| chat_id:', config.channelId);
      } else {
        console.log('[ChartService] Enviado com sucesso!');
      }
      return data;
    } catch(e) {
      console.warn('[ChartService] Erro:', e.message);
    }
  }

  function generateChartImage() {
    generateChart();
    return canvas.toDataURL('image/png');
  }

  function setEnabled(val) {
    const config = getChartConfig();
    config.enabled = !!val;
    saveChartConfig(config);
  }

  function setChannelId(id) {
    const config = getChartConfig();
    config.channelId = id;
    saveChartConfig(config);
  }

  function setCaption(val) {
    const config = getChartConfig();
    config.caption = !!val;
    saveChartConfig(config);
  }

  return {
    init, sendChart, getChartConfig, saveChartConfig, startChartTimer,
    generateChartImage, setEnabled, setChannelId, setCaption
  };
})();
