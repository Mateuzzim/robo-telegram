const Scheduler = {
  _timer: null,
  _checkInterval: 15000,

  init() {
    this.resetDailyEntries();
    this.check();
    this._timer = setInterval(() => {
      this.resetDailyEntries();
      this.check();
    }, this._checkInterval);
  },

  getSchedules() {
    return Store.get('robot-schedules', []);
  },

  saveSchedules(list) {
    Store.set('robot-schedules', list);
  },

  timeToMinutes(t) {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  },

  isScheduleActive(schedule) {
    if (!schedule.enabled) return false;
    const now = new Date();
    const currentDay = now.getDay();
    if (!(schedule.days || []).includes(currentDay)) return false;
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const startMins = this.timeToMinutes(schedule.startTime);
    const repeatInterval = schedule.repeatInterval || 0;

    if (repeatInterval > 0) {
      const intervalMins = repeatInterval * 60;
      const elapsed = ((nowMins - startMins) % (intervalMins * 2) + intervalMins * 2) % (intervalMins * 2);
      return elapsed < intervalMins;
    }

    const endMins = this.timeToMinutes(schedule.endTime);
    if (startMins <= endMins) {
      return nowMins >= startMins && nowMins < endMins;
    } else {
      return nowMins >= startMins || nowMins < endMins;
    }
  },

  getEntriesUsed(schedule) {
    const now = new Date();
    const today = now.toDateString();
    const lastReset = schedule.lastReset ? new Date(schedule.lastReset).toDateString() : '';
    if (lastReset !== today) return 0;
    return schedule.currentEntries || 0;
  },

  resetDailyEntries() {
    const schedules = this.getSchedules();
    const now = new Date();
    const today = now.toDateString();
    let changed = false;
    schedules.forEach(s => {
      const lastReset = s.lastReset ? new Date(s.lastReset).toDateString() : '';
      if (lastReset !== today) {
        s.currentEntries = 0;
        s.lastReset = now.getTime();
        changed = true;
      }
    });
    if (changed) this.saveSchedules(schedules);
  },

  incrementEntry(robotId) {
    const schedules = this.getSchedules();
    const now = new Date();
    const today = now.toDateString();
    schedules.forEach(s => {
      if (s.robotId !== robotId) return;
      const lastReset = s.lastReset ? new Date(s.lastReset).toDateString() : '';
      if (lastReset !== today) {
        s.currentEntries = 0;
        s.lastReset = now.getTime();
      }
      s.currentEntries = (s.currentEntries || 0) + 1;
    });
    this.saveSchedules(schedules);
  },

  check() {
    const schedules = this.getSchedules();
    schedules.forEach(s => {
      if (!s.enabled) return;
      const active = this.isScheduleActive(s);
      const robot = RobotEngine.getRobot(s.robotId);
      if (!robot) return;

      const entries = this.getEntriesUsed(s);
      const maxReached = s.maxEntries > 0 && entries >= s.maxEntries;

      if (active && !maxReached && robot.status === 'offline') {
        robot.currentSignal = null;
        robot.galeCount = 0;
        robot.usedPatterns = { RED: [], BLACK: [], GREY: [] };
        if (typeof TelegramService !== 'undefined') TelegramService.clearAllMessages(robot);
        RobotEngine.startRobot(s.robotId);
      } else if ((!active || maxReached) && robot.status === 'online') {
        RobotEngine.stopRobot(s.robotId);
      }
    });
  },

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
};
