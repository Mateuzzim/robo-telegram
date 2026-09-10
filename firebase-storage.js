const FirebaseStorage = {
  db: null,
  userId: null,
  initialized: false,
  _pendingSaves: [],
  _pullTimer: null,
  COLLECTION: 'robo-data',
  _lastPullTs: {},

  init() {
    try {
      if (typeof firebase === 'undefined' || !firebase.firestore) {
        console.log('[Firebase] SDK nao carregado');
        return;
      }
      if (this.initialized) return;
      if (!firebase.apps.length) {
        firebase.initializeApp(FirebaseConfig);
      }
      this.db = firebase.firestore();
      this.userId = this.getUserId();
      this.initialized = true;
      console.log('[Firebase] Inicializado OK');
      this._flushPending();
      this.syncFromFirebase();
      this._startPullSync();
    } catch (e) {
      console.error('[Firebase] Erro init:', e);
    }
  },

  _startPullSync() {
    if (this._pullTimer) return;
    this._pullTimer = setInterval(() => this._pullRemoteChanges(), 60000);
    window.addEventListener('beforeunload', () => this._flushPending());
  },

  _pullRemoteChanges() {
    if (!this.initialized) return;
    const keys = [
      'robots', 'robot-schedules',
      'ia-inteligente-config', 'ia-inteligente-robot-configs',
      'telegram-bot-token', 'telegram-bot-token-grupos',
      'telegram-channels', 'telegram-owner-name',
      'telegram-message-templates-v1',
      'news-summary-config-v1', 'news-analysis-config-v1', 'news-global-channel-id',
      'ws-config-v1'
    ];
    keys.forEach(key => {
      this._docRef(key).get().then(doc => {
        if (doc.exists) {
          const data = doc.data();
          if (data.ts && (!this._lastPullTs[key] || data.ts > this._lastPullTs[key])) {
            this._lastPullTs[key] = data.ts;
            const localRaw = localStorage.getItem(key);
            const localData = localRaw ? JSON.parse(localRaw) : null;
            if (JSON.stringify(localData) !== JSON.stringify(data.value)) {
              localStorage.setItem(key, JSON.stringify(data.value));
              console.log('[Firebase] Pull atualizado:', key);
            }
          }
        }
      }).catch(() => {});
    });
  },

  getUserId() {
    let uid = localStorage.getItem('firebase-user-id');
    if (!uid) {
      uid = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('firebase-user-id', uid);
    }
    return uid;
  },

  _docRef(key) {
    return this.db.collection(this.COLLECTION).doc(this.userId + '_' + key);
  },

  _flushPending() {
    const pending = [...this._pendingSaves];
    this._pendingSaves = [];
    pending.forEach(({ key, value, attempt }) => this.save(key, value, attempt));
  },

  save(key, value, attempt = 0) {
    if (!this.initialized) {
      this._pendingSaves.push({ key, value, attempt: 0 });
      return;
    }
    this._docRef(key).set({
      key,
      value,
      ts: Date.now()
    }).catch(e => {
      console.error('[Firebase] save (tentativa ' + (attempt + 1) + '):', e.message);
      if (attempt < 3) {
        setTimeout(() => this.save(key, value, attempt + 1), 1000 * Math.pow(2, attempt));
      }
    });
  },

  remove(key) {
    if (!this.initialized) return;
    this._docRef(key).delete().catch(e => console.error('[Firebase] remove:', e.message));
  },

  syncFromFirebase() {
    if (!this.initialized) return;
    const keys = [
      'robots', 'robot-schedules',
      'ia-inteligente-config', 'ia-inteligente-robot-configs',
      'telegram-bot-token', 'telegram-bot-token-grupos',
      'telegram-channels', 'telegram-owner-name',
      'telegram-message-templates-v1',
      'news-summary-config-v1', 'news-analysis-config-v1', 'news-global-channel-id',
      'ws-config-v1'
    ];
    keys.forEach(key => {
      if (localStorage.getItem(key)) return;
      this._docRef(key).get().then(doc => {
        if (doc.exists) {
          const data = doc.data();
          localStorage.setItem(key, JSON.stringify(data.value));
          if (data.ts) this._lastPullTs[key] = data.ts;
          console.log('[Firebase] Restaurado:', key);
        }
      }).catch(() => {});
    });
  },

  syncAllToFirebase() {
    if (!this.initialized) return;
    const keys = [
      'robots', 'robot-schedules',
      'ia-inteligente-config', 'ia-inteligente-robot-configs',
      'telegram-bot-token', 'telegram-bot-token-grupos',
      'telegram-channels', 'telegram-owner-name',
      'telegram-message-templates-v1',
      'news-summary-config-v1', 'news-analysis-config-v1', 'news-global-channel-id',
      'ws-config-v1'
    ];
    keys.forEach(key => {
      const raw = localStorage.getItem(key);
      if (raw) this.save(key, JSON.parse(raw));
    });
  }
};
