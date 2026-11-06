/* CatchCat demo — localStorage persistence */
window.CatchStore = (() => {
  const KEY = "catchcat_demo_v1";
  const CAN_CAP = 12;
  const CAN_START = 8;
  const RECHARGE_MS = 10 * 60 * 1000; // +1 can every 10 minutes

  function defaults() {
    return {
      cats: [],
      resources: { cans: CAN_START, coins: 0, xp: 0 },
      nextSerial: 1,
      lastCanRechargeAt: Date.now(),
      todayKey: dayKey(),
      todayCount: 0
    };
  }

  function dayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  function load() {
    let data;
    try {
      data = JSON.parse(localStorage.getItem(KEY) || "null");
    } catch {
      data = null;
    }
    if (!data || typeof data !== "object") data = defaults();
    data.resources = data.resources || { cans: CAN_START, coins: 0, xp: 0 };
    data.cats = Array.isArray(data.cats) ? data.cats : [];
    data.nextSerial = data.nextSerial || 1;
    data.lastCanRechargeAt = data.lastCanRechargeAt || Date.now();
    applyRecharge(data);
    rollToday(data);
    save(data);
    return data;
  }

  function applyRecharge(data) {
    const now = Date.now();
    let last = data.lastCanRechargeAt || now;
    let gained = 0;
    while (data.resources.cans < CAN_CAP && now - last >= RECHARGE_MS) {
      data.resources.cans += 1;
      last += RECHARGE_MS;
      gained += 1;
    }
    data.lastCanRechargeAt = data.resources.cans >= CAN_CAP ? now : last;
    return gained;
  }

  function rollToday(data) {
    const k = dayKey();
    if (data.todayKey !== k) {
      data.todayKey = k;
      data.todayCount = 0;
    }
  }

  function save(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
  }

  function rarest(cats) {
    const order = ["Alley", "Garden", "Moonlit", "Velvet", "Golden"];
    let best = null;
    let bestIdx = -1;
    for (const c of cats) {
      const i = order.indexOf(c.rarity);
      if (i > bestIdx) {
        bestIdx = i;
        best = c.rarity;
      }
    }
    return best;
  }

  return { KEY, CAN_CAP, CAN_START, RECHARGE_MS, load, save, applyRecharge, rollToday, rarest, dayKey };
})();
