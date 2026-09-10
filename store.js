const Store = {
  get(key, def) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : def;
    } catch { return def; }
  },
  set(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
    if (typeof FirebaseStorage !== 'undefined' && FirebaseStorage.initialized) {
      FirebaseStorage.save(key, val).catch(() => {});
    }
  },
  remove(key) {
    localStorage.removeItem(key);
    if (typeof FirebaseStorage !== 'undefined' && FirebaseStorage.initialized) {
      FirebaseStorage.remove(key).catch(() => {});
    }
  }
};
