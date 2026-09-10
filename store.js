const Store = {
  _debounceTimers: {},
  _latestValues: {},

  get(key, def) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : def;
    } catch { return def; }
  },

  set(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
    if (typeof FirebaseStorage !== 'undefined') {
      if (key === 'robots') {
        this._latestValues[key] = val;
        if (!this._debounceTimers[key]) {
          this._debounceTimers[key] = setTimeout(() => {
            FirebaseStorage.save(key, this._latestValues[key]);
            delete this._debounceTimers[key];
            delete this._latestValues[key];
          }, 3000);
        }
      } else {
        FirebaseStorage.save(key, val);
      }
    }
  },

  remove(key) {
    localStorage.removeItem(key);
    if (typeof FirebaseStorage !== 'undefined') {
      FirebaseStorage.remove(key);
    }
  },

  flushRobots() {
    if (this._debounceTimers['robots']) {
      clearTimeout(this._debounceTimers['robots']);
      delete this._debounceTimers['robots'];
      if (this._latestValues['robots']) {
        FirebaseStorage.save('robots', this._latestValues['robots']);
        delete this._latestValues['robots'];
      }
    }
  }
};
