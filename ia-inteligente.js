const IAConfig = {
  _key: 'ia-inteligente-config',
  _listeners: [],

  weights: {
    confidence: 35,
    confluences: 20,
    winRate: 30,
    matched: 15
  },

  settings: {
    reavaliationInterval: 30000,
    minHistoryRequired: 50,
    minConfidenceToAct: 60,
    maxEvaluations: 20,
    windowSize: 30,
    enableMultiplierBoost: true,
    enablePenalty: true,
    enableWinStreakBoost: true
  },

  penalty: {
    onLoss: 5,
    onRejection: 3,
    maxPenalty: 50,
    decayPerWin: 2,
    resetOnStrategyChange: true
  },

  boost: {
    onWinStreak: 10,
    streakThreshold: 3,
    maxBoost: 30,
    confidenceAbove80: 5,
    confidenceAbove90: 10
  },

  rules: [
    { id: 1, name: 'WinRate Baixo', enabled: true, condition: 'winRate < 40', action: 'penalty', value: 20, description: 'Penaliza quando winRate cai abaixo de 40%' },
    { id: 2, name: 'Confiança Alta', enabled: true, condition: 'confidence > 85', action: 'boost', value: 15, description: 'Boost quando confiança supera 85%' },
    { id: 3, name: 'Proteção Verde', enabled: true, condition: 'target == "GREEN"', action: 'multiplier', value: 2, description: 'Dobra peso para sinais GREEN' },
    { id: 4, name: 'Streak Longo', enabled: false, condition: 'streak > 5', action: 'ignore', value: 0, description: 'Ignora regras quando streak > 5' }
  ],

  customFunctions: {
    evaluate: `// Função de avaliação customizada
// Parâmetros: evaluation = { strategy, confidence, confluences, winRate, matched, target, multiplier }
// Retornar: score ajustado (número)
function customEvaluate(evaluation) {
  let score = evaluation.score;
  
  // Exemplo: Boost para estratégias de ciclo
  if (evaluation.strategy.startsWith('ciclo')) {
    score += 5;
  }
  
  // Exemplo: Reduzir score se confiança muito baixa
  if (evaluation.confidence < 40) {
    score -= 10;
  }
  
  return Math.max(0, Math.min(100, score));
}`,
    filter: `// Função de filtro customizada
// Parâmetros: signal = { target, confidence, strategy, multiplier }
// Retornar: true para aceitar, false para rejeitar
function customFilter(signal) {
  // Exemplo: Rejeitar sinais com confiança abaixo de 50
  if (signal.confidence < 50) {
    return false;
  }
  
  // Exemplo: Aceitar apenas estratégias de ciclo ou convergência
  const allowed = ['cicloVerde', 'cicloPreto', 'cicloVermelho', 'convergencia', 'convergenciaVermelha'];
  if (!allowed.includes(signal.strategy)) {
    return false;
  }
  
  return true;
}`,
    prioritize: `// Função de priorização customizada
// Parâmetros: evaluations = array de evaluations
// Retornar: evaluations ordenadas (maior prioridade primeiro)
function customPrioritize(evaluations) {
  // Exemplo: Priorizar por winRate, depois por confiança
  return evaluations.sort((a, b) => {
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    return b.confidence - a.confidence;
  });
}`,
    onWin: `// Função chamada após cada WIN
// Parâmetros: result = { strategy, target, gale, confidence }
function onWin(result) {
  // Exemplo: Log customizado
  console.log('WIN na estratégia:', result.strategy, 'alvo:', result.target);
  
  // Exemplo: Ajustar penalidade baseado no gale
  if (result.gale > 0) {
    IAConfig.penalty.onLoss = Math.max(2, IAConfig.penalty.onLoss - 1);
  }
}`,
    onLoss: `// Função chamada após cada LOSS
// Parâmetros: result = { strategy, target, gale, confidence }
function onLoss(result) {
  // Exemplo: Log customizado
  console.log('LOSS na estratégia:', result.strategy, 'alvo:', result.target);
  
  // Exemplo: Aumentar penalidade após perdas consecutivas
  if (result.gale >= 2) {
    IAConfig.penalty.onLoss = Math.min(15, IAConfig.penalty.onLoss + 2);
  }
}`
  },

  decisionLog: [],
  _maxLogSize: 100,

  init() {
    const saved = this.load();
    if (saved) {
      if (saved.weights) Object.assign(this.weights, saved.weights);
      if (saved.settings) Object.assign(this.settings, saved.settings);
      if (saved.penalty) Object.assign(this.penalty, saved.penalty);
      if (saved.boost) Object.assign(this.boost, saved.boost);
      if (saved.rules) this.rules = saved.rules;
      if (saved.customFunctions) Object.assign(this.customFunctions, saved.customFunctions);
      if (saved.decisionLog) this.decisionLog = saved.decisionLog;
    }
    return this;
  },

  save() {
    try {
      const data = {
        weights: { ...this.weights },
        settings: { ...this.settings },
        penalty: { ...this.penalty },
        boost: { ...this.boost },
        rules: this.rules.map(r => ({ ...r })),
        customFunctions: { ...this.customFunctions },
        decisionLog: this.decisionLog.slice(-this._maxLogSize),
        savedAt: Date.now()
      };
      localStorage.setItem(this._key, JSON.stringify(data));
      return true;
    } catch (e) {
      console.error('Erro ao salvar IAConfig:', e);
      return false;
    }
  },

  load() {
    try {
      const raw = localStorage.getItem(this._key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error('Erro ao carregar IAConfig:', e);
      return null;
    }
  },

  reset() {
    this.weights = { confidence: 35, confluences: 20, winRate: 30, matched: 15 };
    this.settings = { reavaliationInterval: 30000, minHistoryRequired: 50, minConfidenceToAct: 60, maxEvaluations: 20, windowSize: 30, enableMultiplierBoost: true, enablePenalty: true, enableWinStreakBoost: true };
    this.penalty = { onLoss: 5, onRejection: 3, maxPenalty: 50, decayPerWin: 2, resetOnStrategyChange: true };
    this.boost = { onWinStreak: 10, streakThreshold: 3, maxBoost: 30, confidenceAbove80: 5, confidenceAbove90: 10 };
    this.rules = [];
    this.customFunctions = { evaluate: '', filter: '', prioritize: '', onWin: '', onLoss: '' };
    this.decisionLog = [];
    this.save();
    this._emit('reset');
  },

  addRule(rule) {
    const id = Date.now();
    this.rules.push({ id, enabled: true, ...rule });
    this.save();
    this._emit('ruleAdded', rule);
    return id;
  },

  updateRule(id, updates) {
    const idx = this.rules.findIndex(r => r.id === id);
    if (idx !== -1) {
      Object.assign(this.rules[idx], updates);
      this.save();
      this._emit('ruleUpdated', this.rules[idx]);
    }
  },

  removeRule(id) {
    this.rules = this.rules.filter(r => r.id !== id);
    this.save();
    this._emit('ruleRemoved', id);
  },

  toggleRule(id) {
    const rule = this.rules.find(r => r.id === id);
    if (rule) {
      rule.enabled = !rule.enabled;
      this.save();
      this._emit('ruleToggled', rule);
    }
  },

  addDecisionLog(entry) {
    this.decisionLog.push({ ...entry, timestamp: Date.now() });
    if (this.decisionLog.length > this._maxLogSize) {
      this.decisionLog = this.decisionLog.slice(-this._maxLogSize);
    }
    this.save();
    this._emit('decisionLogged', entry);
  },

  normalizeWeights() {
    const total = this.weights.confidence + this.weights.confluences + this.weights.winRate + this.weights.matched;
    if (total === 0) return;
    const factor = 100 / total;
    this.weights.confidence = Math.round(this.weights.confidence * factor);
    this.weights.confluences = Math.round(this.weights.confluences * factor);
    this.weights.winRate = Math.round(this.weights.winRate * factor);
    this.weights.matched = 100 - this.weights.confidence - this.weights.confluences - this.weights.winRate;
    this.save();
  },

  evaluateScore(data) {
    const w = this.weights;
    let score = 0;
    score += (data.confidence || 0) * (w.confidence / 100);
    score += (data.confluences || 0) * 8 * (w.confluences / 100);
    score += (data.winRate || 0) * (w.winRate / 100);
    score += ((data.matched ? 15 : 0)) * (w.matched / 100);
    if (this.settings.enableMultiplierBoost && data.multiplier) {
      score = Math.round(score * (data.multiplier / 50));
    }
    if (this.settings.enablePenalty && data.penalty) {
      score = Math.max(0, score - data.penalty);
    }
    if (this.settings.enableWinStreakBoost && data.winStreak) {
      const streakBonus = Math.min(this.boost.maxBoost, Math.floor(data.winStreak / this.boost.streakThreshold) * this.boost.onWinStreak);
      score += streakBonus;
    }
    if (data.confidence >= 90) score += this.boost.confidenceAbove90;
    else if (data.confidence >= 80) score += this.boost.confidenceAbove80;
    return Math.round(Math.max(0, Math.min(100, score)));
  },

  applyRules(evaluation, robotState) {
    let result = { ...evaluation, penalty: evaluation.penalty || 0, boost: evaluation.boost || 0, ignored: false, appliedRules: [] };
    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      try {
        const condFn = new Function('evaluation', 'robotState', 'IAConfig',
          `with(Math){with(Math.round){return (${rule.condition})}}`
        );
        if (condFn(result, robotState, this)) {
          result.appliedRules.push(rule.name);
          switch (rule.action) {
            case 'penalty': result.penalty += rule.value; break;
            case 'boost': result.boost += rule.value; break;
            case 'multiplier': result.multiplier = (result.multiplier || 1) * rule.value; break;
            case 'ignore': result.ignored = true; break;
            case 'setConfidence': result.confidence = rule.value; break;
            case 'setTarget': result.target = rule.value; break;
          }
        }
      } catch (e) { /* skip rule error */ }
    }
    return result;
  },

  runCustomEvaluate(evaluation) {
    try {
      const fn = new Function('evaluation', 'IAConfig', this.customFunctions.evaluate + '\nreturn customEvaluate(evaluation);');
      return fn(evaluation, this) || evaluation.score;
    } catch (e) {
      return evaluation.score;
    }
  },

  runCustomFilter(signal) {
    try {
      const fn = new Function('signal', 'IAConfig', this.customFunctions.filter + '\nreturn customFilter(signal);');
      return fn(signal, this);
    } catch (e) {
      return true;
    }
  },

  runCustomPrioritize(evaluations) {
    try {
      const fn = new Function('evaluations', 'IAConfig', this.customFunctions.prioritize + '\nreturn customPrioritize(evaluations);');
      return fn(evaluations, this) || evaluations;
    } catch (e) {
      return evaluations;
    }
  },

  runOnWin(result) {
    try {
      const fn = new Function('result', 'IAConfig', this.customFunctions.onWin);
      fn(result, this);
    } catch (e) { /* skip */ }
  },

  runOnLoss(result) {
    try {
      const fn = new Function('result', 'IAConfig', this.customFunctions.onLoss);
      fn(result, this);
    } catch (e) { /* skip */ }
  },

  getNormalizedWeights() {
    const total = this.weights.confidence + this.weights.confluences + this.weights.winRate + this.weights.matched;
    if (total === 0) return { confidence: 25, confluences: 25, winRate: 25, matched: 25 };
    return {
      confidence: Math.round((this.weights.confidence / total) * 100),
      confluences: Math.round((this.weights.confluences / total) * 100),
      winRate: Math.round((this.weights.winRate / total) * 100),
      matched: 100 - Math.round((this.weights.confidence / total) * 100) - Math.round((this.weights.confluences / total) * 100) - Math.round((this.weights.winRate / total) * 100)
    };
  },

  exportConfig() {
    return JSON.stringify({
      weights: { ...this.weights },
      settings: { ...this.settings },
      penalty: { ...this.penalty },
      boost: { ...this.boost },
      rules: this.rules.map(r => ({ ...r })),
      customFunctions: { ...this.customFunctions }
    }, null, 2);
  },

  importConfig(jsonStr) {
    try {
      const data = JSON.parse(jsonStr);
      if (data.weights) Object.assign(this.weights, data.weights);
      if (data.settings) Object.assign(this.settings, data.settings);
      if (data.penalty) Object.assign(this.penalty, data.penalty);
      if (data.boost) Object.assign(this.boost, data.boost);
      if (data.rules) this.rules = data.rules;
      if (data.customFunctions) Object.assign(this.customFunctions, data.customFunctions);
      this.save();
      return true;
    } catch (e) {
      return false;
    }
  },

  on(event, fn) {
    this._listeners.push({ event, fn });
  },

  off(event, fn) {
    this._listeners = this._listeners.filter(l => !(l.event === event && l.fn === fn));
  },

  _emit(event, data) {
    this._listeners.filter(l => l.event === event).forEach(l => {
      try { l.fn(data); } catch (e) { /* skip */ }
    });
  }
};

IAConfig.init();
