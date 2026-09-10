const FirebaseStorage = {
  db: null,
  userId: null,
  initialized: false,
  syncQueue: {},
  syncTimer: null,

  COLLECTION: 'robo-data',

  async init() {
    try {
      if (typeof firebase === 'undefined' || !firebase.firestore) {
        console.log('Firebase SDK nao carregado, usando localStorage apenas');
        return false;
      }
      if (this.initialized) return true;
      if (!firebase.apps.length) {
        firebase.initializeApp(FirebaseConfig);
      }
      this.db = firebase.firestore();
      this.userId = this.getUserId();
      this.initialized = true;
      console.log('Firebase Firestore inicializado');
      await this.syncFromFirebase();
      return true;
    } catch (e) {
      console.error('Erro ao inicializar Firebase:', e);
      return false;
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

  getDocRef(key) {
    return this.db.collection(this.COLLECTION).doc(this.userId + '_' + key);
  },

  async save(key, value) {
    if (!this.initialized) return;
    try {
      await this.getDocRef(key).set({
        key: key,
        value: value,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) {
      console.error('Firebase save error:', e);
    }
  },

  async load(key, def) {
    if (!this.initialized) return def;
    try {
      const doc = await this.getDocRef(key).get();
      if (doc.exists) {
        return doc.data().value;
      }
    } catch (e) {
      console.error('Firebase load error:', e);
    }
    return def;
  },

  async remove(key) {
    if (!this.initialized) return;
    try {
      await this.getDocRef(key).delete();
    } catch (e) {
      console.error('Firebase remove error:', e);
    }
  },

  async syncFromFirebase() {
    if (!this.initialized) return;
    const keysToSync = [
      'robots', 'robot-schedules',
      'ia-inteligente-config', 'ia-inteligente-robot-configs',
      'telegram-bot-token', 'telegram-bot-token-grupos',
      'telegram-channels', 'telegram-owner-name',
      'telegram-message-templates-v1',
      'news-summary-config-v1', 'news-analysis-config-v1', 'news-global-channel-id',
      'ws-config-v1'
    ];
    for (const key of keysToSync) {
      const local = localStorage.getItem(key);
      if (!local) {
        try {
          const doc = await this.getDocRef(key).get();
          if (doc.exists) {
            localStorage.setItem(key, JSON.stringify(doc.data().value));
          }
        } catch (e) { /* skip */ }
      }
    }
  },

  async syncAllToFirebase() {
    if (!this.initialized) return;
    const keysToSync = [
      'robots', 'robot-schedules',
      'ia-inteligente-config', 'ia-inteligente-robot-configs',
      'telegram-bot-token', 'telegram-bot-token-grupos',
      'telegram-channels', 'telegram-owner-name',
      'telegram-message-templates-v1',
      'news-summary-config-v1', 'news-analysis-config-v1', 'news-global-channel-id',
      'ws-config-v1'
    ];
    for (const key of keysToSync) {
      const local = localStorage.getItem(key);
      if (local) {
        try {
          await this.getDocRef(key).set({
            key: key,
            value: JSON.parse(local),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        } catch (e) { /* skip */ }
      }
    }
  }
};
