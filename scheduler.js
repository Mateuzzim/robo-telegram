const Scheduler = {
  _timer: null,
  _checkInterval: 15000,
  _signalHandler: null,

  init() {
    if (this._timer) clearInterval(this._timer);
    this.resetDailyEntries();
    this.check();
    if (!this._signalHandler && typeof EventBus !== 'undefined') {
      this._signalHandler = (data) => {
        if (data && data.robotId) this.incrementEntry(data.robotId);
      };
      EventBus.on('signal:created', this._signalHandler);
    }
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
    if (typeof EventBus !== 'undefined') EventBus.emit('schedules:changed');
  },

  timeToMinutes(t) {
    const [h, m] = String(t || '00:00').split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
    return h * 60 + m;
  },

  isScheduleActive(schedule) {
    if (!schedule.enabled) return false;
    const now = new Date();
    const currentDay = now.getDay();
    const days = (schedule.days || []).map(Number);
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const startMins = this.timeToMinutes(schedule.startTime);
    const endMins = this.timeToMinutes(schedule.endTime);
    const repeatInterval = schedule.repeatInterval || 0;
    const previousDay = (currentDay + 6) % 7;

    if (repeatInterval > 0) {
      const cycleStartDay = nowMins < startMins ? previousDay : currentDay;
      if (!days.includes(cycleStartDay)) return false;
      const intervalMins = repeatInterval * 60;
      const elapsedMins = (nowMins < startMins ? nowMins + 1440 : nowMins) - startMins;
      const elapsed = elapsedMins % (intervalMins * 2);
      return elapsed < intervalMins;
    }

    if (startMins <= endMins) {
      if (!days.includes(currentDay)) return false;
      return nowMins >= startMins && nowMins < endMins;
    }

    if (nowMins >= startMins) return days.includes(currentDay);
    if (nowMins < endMins) return days.includes(previousDay);
    return false;
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
        s._maxNotified = false;
        changed = true;
      }
    });
    if (changed) this.saveSchedules(schedules);
  },

  incrementEntry(robotId) {
    const schedules = this.getSchedules();
    const now = new Date();
    const today = now.toDateString();
    let changed = false;
    schedules.forEach(s => {
      if (s.robotId !== robotId) return;
      if (!s.enabled || !this.isScheduleActive(s)) return;
      const lastReset = s.lastReset ? new Date(s.lastReset).toDateString() : '';
      if (lastReset !== today) {
        s.currentEntries = 0;
        s.lastReset = now.getTime();
      }
      if (s.maxEntries > 0 && (s.currentEntries || 0) >= s.maxEntries) {
        const robot = RobotEngine.getRobot(robotId);
        if (robot && robot.status === 'online') {
          RobotEngine.stopRobot(robotId);
          if (!s._maxNotified) {
            s._maxNotified = true;
            this.notifyMaxEntriesReached(s);
          }
        }
        return;
      }
      s.currentEntries = (s.currentEntries || 0) + 1;
      changed = true;
      if (s.maxEntries > 0 && s.currentEntries >= s.maxEntries) {
        const robot = RobotEngine.getRobot(robotId);
        if (robot && robot.status === 'online') {
          RobotEngine.stopRobot(robotId);
          s._maxNotified = true;
          this.notifyMaxEntriesReached(s);
        }
      }
    });
    if (changed) this.saveSchedules(schedules);
  },

  getNextExecutionTime(schedule) {
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const startMins = this.timeToMinutes(schedule.startTime);

    if (schedule.repeatInterval > 0) {
      const intervalMins = schedule.repeatInterval * 60;
      const elapsed = ((nowMins - startMins) % (intervalMins * 2) + intervalMins * 2) % (intervalMins * 2);
      const nextStart = nowMins + (intervalMins * 2 - elapsed);
      const h = Math.floor(nextStart / 60) % 24;
      const m = nextStart % 60;
      return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    }
    return schedule.startTime + ' (amanha)';
  },

  notifyMaxEntriesReached(schedule) {
    if (typeof TelegramService === 'undefined') return;
    const robot = RobotEngine.getRobot(schedule.robotId);
    if (!robot) return;
    const gameLabel = robot.game === 'wheel' ? 'Wheel' : 'Double';
    const nextTime = this.getNextExecutionTime(schedule);
    const now = new Date();
    const timeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const text = [
      '━━ 🚨 <b>AGENDAMENTO CONCLUIDO</b> 🚨 ━━',
      '🤖 <b>ROBO:</b> ' + robot.name,
      '🔰 <b>Jogo:</b> ' + gameLabel,
      '',
      '📊 <b>Entradas:</b> ' + schedule.currentEntries + ' / ' + schedule.maxEntries,
      '✅ Todas as entradas realizadas!',
      '',
      '🔄 <b>Proxima execucao:</b> ' + nextTime,
      '━━━━━━━━━━━━━━━━━━━━',
      '🕐 <b>' + timeStr + '</b>',
      '━━━━━━━━━━━━━━━━━━━━'
    ].join('\n');
    const destinations = (schedule.destinations && schedule.destinations.length) ? schedule.destinations : TelegramService.getDestinations(robot);
    destinations.forEach(dest => {
      if (!dest.channelId) return;
      const token = TelegramService.getTokenForChat(dest.channelId);
      if (!token) return;
      const payload = {
        chat_id: dest.channelId,
        text: TelegramService.prepareTelegramText(text),
        parse_mode: 'HTML',
        disable_web_page_preview: true
      };
      if (dest.threadId) payload.message_thread_id = dest.threadId;
      TelegramService.api(token, 'sendMessage', payload).catch(() => {});
    });
  },

  check() {
    const schedules = this.getSchedules();
    let changed = false;
    schedules.forEach(s => {
      if (!s.enabled) return;
      const active = this.isScheduleActive(s);
      const robot = RobotEngine.getRobot(s.robotId);
      if (!robot) return;

      const entries = this.getEntriesUsed(s);
      const maxReached = s.maxEntries > 0 && entries >= s.maxEntries;
      const wasMaxReached = s._maxNotified === true;

      if (active && !maxReached && robot.status === 'offline') {
        robot.currentSignal = null;
        robot.galeCount = 0;
        robot.usedPatterns = { RED: [], BLACK: [], GREY: [], GREEN: [], BLUE: [] };
        if (typeof TelegramService !== 'undefined') TelegramService.clearAllMessages(robot);
        RobotEngine.startRobot(s.robotId);
        if (s._maxNotified) {
          s._maxNotified = false;
          changed = true;
        }
      } else if ((!active || maxReached) && robot.status === 'online') {
        RobotEngine.stopRobot(s.robotId);
      }

      if (maxReached && !wasMaxReached) {
        s._maxNotified = true;
        changed = true;
        this.notifyMaxEntriesReached(s);
      }
    });
    if (changed) this.saveSchedules(schedules);
  },

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    if (this._signalHandler && typeof EventBus !== 'undefined') {
      EventBus.off('signal:created', this._signalHandler);
      this._signalHandler = null;
    }
  }
};
