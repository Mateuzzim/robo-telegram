const FirebaseStorage = {
  db: null,
  userId: null,
  initialized: false,
  _pendingSaves: [],
  COLLECTION: 'robo-data',

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
    } catch (e) {
      console.error('[Firebase] Erro init:', e);
    }
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
    pending.forEach(({ key, value }) => this.save(key, value));
  },

  save(key, value) {
    if (!this.initialized) {
      this._pendingSaves.push({ key, value });
      return;
    }
    this._docRef(key).set({
      key,
      value,
      ts: Date.now()
    }).catch(e => console.error('[Firebase] save:', e));
  },

  remove(key) {
    if (!this.initialized) return;
    this._docRef(key).delete().catch(e => console.error('[Firebase] remove:', e));
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
          localStorage.setItem(key, JSON.stringify(doc.data().value));
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
