// mock.js —— 演示数据引擎：测点台账 / 信号生成 / 预警判定 / 历史数据
// 口径与《实施技术方案》一致：应变 388（A拱肋176 B横联44 C腹杆40 D桥面88 E吊杆32 F合龙8）、
// 吊杆索力 32、动位移 24、加速度 24、倾角 12、温湿度 8、风速 4；本演示在三维模型上挂接 106 个代表性测点。

export const TYPES = {
  strain: { label: '应变',   unit: 'με',  color: '#22d3ee', thr: [400, 600, 800],  digits: 1, base: [-20, 60] },
  cable:  { label: '索力',   unit: 'kN',  color: '#a78bfa', thr: [1.0, 1.3, 1.6],  digits: 3, base: [0.45, 0.75] },
  disp:   { label: '动位移', unit: 'mm',  color: '#fbbf24', thr: [0.8, 1.2, 1.6],  digits: 3, base: [0, 0.2] },
  acc:    { label: '加速度', unit: 'mg',  color: '#34d399', thr: [30, 50, 80],     digits: 1, base: [1, 4] },
  incl:   { label: '倾角',   unit: '″',   color: '#fb923c', thr: [8, 12, 16],      digits: 2, base: [1, 3] },
  env:    { label: '温湿度', unit: '℃',  color: '#60a5fa', thr: [45, 55, 65],     digits: 1, base: [22, 26] },
  wind:   { label: '风速',   unit: 'm/s', color: '#f472b6', thr: [8, 12, 15],      digits: 1, base: [0.8, 2.2] },
};

// 设计数量（与方案表5-2/5-3一致，用于"设备测点"页展示）
export const DESIGN_COUNTS = {
  strain: 388, cable: 32, disp: 24, acc: 24, incl: 12, env: 8, wind: 4,
};

const rnd = (a, b) => a + Math.random() * (b - a);
const gauss = () => { // Box-Muller
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

export const Mock = {
  sensors: [],
  alarms: [],
  tick: 0,
  loadEvent: { active: false, t0: 0, dur: 120 }, // 加载工况：60s 加载 + 60s 卸载
  listeners: [],
  _histCache: new Map(),

  init() {
    const S = this.sensors;
    const add = (o) => S.push(Object.assign({
      pos: null, value: 0, status: 'ok', hist: [], phase: rnd(0, 6.28), ar: 0, alarmLvl: 0,
    }, o));
    // A 区：拱肋应变 22 节段 × 两侧（上游/下游）
    for (let seg = 1; seg <= 22; seg++) {
      for (const side of ['上游', '下游']) {
        add({ id: `A-${seg}${side === '上游' ? 'U' : 'D'}`, name: `拱肋应变 A-${seg}（${side}）`,
          type: 'strain', zone: 'A', seg, side });
      }
    }
    // F 区：合龙段应变
    for (let i = 1; i <= 2; i++) add({ id: `F-0${i}`, name: `合龙段应变 F-0${i}`, type: 'strain', zone: 'F', seg: 23 });
    // D 区：桥面应变（示意挂接 8）
    for (let i = 1; i <= 8; i++) add({ id: `D-0${i}`, name: `桥面应变 D-0${i}`, type: 'strain', zone: 'D' });
    // E 区：吊杆索力 32（16 对）
    for (let i = 1; i <= 32; i++) {
      const side = i % 2 ? '上游' : '下游';
      add({ id: `E-${String(i).padStart(2, '0')}`, name: `${side}吊杆索力 E-${String(i).padStart(2, '0')}`,
        type: 'cable', zone: 'E', side, hang: Math.ceil(i / 2) });
    }
    // 动位移 / 加速度 / 倾角 / 温湿度 / 风速
    for (let i = 1; i <= 4; i++) add({ id: `W-0${i}`, name: `桥面动位移 W-0${i}`, type: 'disp' });
    for (let i = 1; i <= 8; i++) add({ id: `AC-0${i}`, name: `振动加速度 AC-0${i}`, type: 'acc' });
    for (let i = 1; i <= 4; i++) add({ id: `QJ-0${i}`, name: `结构倾角 QJ-0${i}`, type: 'incl' });
    for (let i = 1; i <= 2; i++) add({ id: `ENV-0${i}`, name: `大气环境温湿度 ENV-0${i}`, type: 'env' });
    for (let i = 1; i <= 2; i++) add({ id: `WS-0${i}`, name: `风速风向 WS-0${i}`, type: 'wind' });

    for (const s of S) {
      const t = TYPES[s.type];
      s.base = s.type === 'env' ? rnd(22, 26) : rnd(t.base[0], t.base[1]);
      if (s.type === 'strain') { // 拱顶与拱脚弯矩大，基值略高
        const crownF = s.zone === 'F' ? 1.6 : 1 - Math.abs((s.seg || 11) - 11.5) / 11.5;
        s.base += crownF * rnd(10, 40);
      }
      s.value = s.base;
    }
  },

  on(fn) { this.listeners.push(fn); },

  // 模拟加载工况：拱肋应变抬升（拱顶最大），索力、动位移小幅联动
  startLoadEvent() {
    if (this.loadEvent.active) return;
    this.loadEvent.active = true;
    this.loadEvent.t0 = this.tick;
  },
  loadFactor() { // 0→1→0 三角形包络
    if (!this.loadEvent.active) return 0;
    const dt = this.tick - this.loadEvent.t0;
    const { dur } = this.loadEvent;
    if (dt > dur) { this.loadEvent.active = false; return 0; }
    return dt < dur / 2 ? dt / (dur / 2) : 1 - (dt - dur / 2) / (dur / 2);
  },

  tickOnce(now) {
    this.tick++;
    const lf = this.loadFactor();
    for (const s of this.sensors) {
      const t = this.tick * 2 / 86400; // 2s 一步，按天为周期的日变化
      s.ar = s.ar * 0.92 + gauss() * 0.35; // AR(1) 缓慢漂移
      let v;
      switch (s.type) {
        case 'strain':
          v = s.base + 12 * Math.sin(2 * Math.PI * t + s.phase) + s.ar * 6 + gauss() * 1.5;
          if (s.zone === 'A' || s.zone === 'F') {
            const crownF = s.zone === 'F' ? 1.5 : 1 - Math.abs((s.seg || 11) - 11.5) / 11.5;
            v += lf * 620 * (0.35 + 0.85 * crownF); // 加载工况：拱顶响应最大
          } else if (s.zone === 'D') {
            v += lf * 60;
          }
          break;
        case 'cable':
          v = s.base + 0.06 * Math.sin(2 * Math.PI * t * 3 + s.phase) + s.ar * 0.02 + gauss() * 0.004 + lf * 0.18;
          break;
        case 'disp':
          v = s.base + 0.1 * Math.sin(2 * Math.PI * t * 8 + s.phase) + s.ar * 0.02 + gauss() * 0.012 + lf * 0.5;
          if (Math.random() < 0.03) v += gauss() * 0.25; // 车辆/人行激励
          break;
        case 'acc':
          v = Math.abs(s.base + s.ar * 2 + gauss() * 1.2 + (lf > 0.3 ? lf * 12 : 0));
          if (Math.random() < 0.04) v += rnd(8, 22); // 激励突峰
          break;
        case 'incl':
          v = s.base + s.ar * 0.4 + gauss() * 0.15 + lf * 2.4;
          break;
        case 'env':
          v = s.base + 3.2 * Math.sin(2 * Math.PI * t - 1.2) + s.ar * 0.15 + gauss() * 0.05;
          s.rh = 70 - 8 * Math.sin(2 * Math.PI * t - 1.2) + gauss() * 0.6;
          s.rhHist = s.rhHist || [];
          s.rhHist.push([now, +s.rh.toFixed(0)]);
          if (s.rhHist.length > 150) s.rhHist.shift();
          break;
        case 'wind':
          v = Math.max(0, s.base + s.ar * 0.8 + gauss() * 0.3);
          if (Math.random() < 0.02) v += rnd(1.5, 4); // 阵风
          break;
      }
      s.value = v;
      s.hist.push([now, +v.toFixed(TYPES[s.type].digits)]);
      if (s.hist.length > 150) s.hist.shift();
      this.checkAlarm(s, now);
    }
    // 预警自动恢复判定
    for (const a of this.alarms) {
      if (a.status === '已恢复') continue;
      const s = this.sensors.find(x => x.id === a.sid);
      const rec = s && Math.abs(s.value) < TYPES[s.type].thr[0] * 0.9;
      if (rec) { a.status = '已恢复'; a.recoverTime = now; }
    }
    for (const fn of this.listeners) fn(now);
  },

  checkAlarm(s, now) {
    const thr = TYPES[s.type].thr; // [三级, 二级, 一级]
    const v = Math.abs(s.value);
    let lvl = 0;
    if (v >= thr[2]) lvl = 1; else if (v >= thr[1]) lvl = 2; else if (v >= thr[0]) lvl = 3;
    if (lvl > 0 && lvl > s.alarmLvl) {
      this.alarms.unshift({
        sid: s.id, name: s.name, type: s.type, level: lvl, value: +v.toFixed(TYPES[s.type].digits),
        threshold: thr[3 - lvl], unit: TYPES[s.type].unit, time: now, status: '未确认',
      });
      if (this.alarms.length > 300) this.alarms.pop();
      s.status = 'alarm';
    } else if (lvl === 0) {
      s.status = 'ok';
    } else {
      s.status = lvl < s.alarmLvl ? 'warn' : s.status;
      if (lvl === 2 && s.status === 'ok') s.status = 'warn';
    }
    s.alarmLvl = lvl;
    if (s.status === 'ok' && lvl > 0) s.status = 'warn';
  },

  stats() {
    let maxStrain = { v: -1 }, maxCable = { v: -1 };
    for (const s of this.sensors) {
      if (s.type === 'strain' && Math.abs(s.value) > maxStrain.v) maxStrain = { v: Math.abs(s.value), s };
      if (s.type === 'cable' && s.value > maxCable.v) maxCable = { v: s.value, s };
    }
    const wind = this.sensors.find(s => s.type === 'wind');
    const un = this.alarms.filter(a => a.status === '未确认').length;
    const today = this.alarms.length;
    const lvl1 = this.alarms.filter(a => a.level === 1 && a.status !== '已恢复').length;
    return {
      online: `${this.sensors.length}/${this.sensors.length}`,
      devices: '8/8',
      maxStrain, maxCable, wind,
      alarmUn: un, alarmToday: today, lvl1,
      throughput: (this.sensors.length * 8 + 520).toFixed(0), // 演示吞吐（点/秒）
    };
  },

  // 历史数据：按传感器特性生成确定性曲线（种子随机游走 + 日周期），带缓存
  history(s, hours) {
    const key = `${s.id}@${hours}`;
    if (this._histCache.has(key)) return this._histCache.get(key);
    const step = hours <= 1 ? 10 / 3600 : hours <= 24 ? 2 / 24 : 2 / 24 * 6; // 小时
    const n = Math.round(hours / step);
    const out = [];
    let seed = [...s.id].reduce((a, c) => a + c.charCodeAt(0), 0);
    const prand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    let ar = 0;
    const end = Date.now();
    for (let i = n; i >= 0; i--) {
      const t = end - i * step * 3600e3;
      const day = (t % 86400e3) / 86400e3; // 0~1
      ar = ar * 0.9 + (prand() - 0.5) * 2;
      let v;
      switch (s.type) {
        case 'strain': v = s.base + 12 * Math.sin(2 * Math.PI * (day - 0.3)) + ar * 5; break;
        case 'cable': v = s.base + 0.05 * Math.sin(2 * Math.PI * day * 3) + ar * 0.015; break;
        case 'disp': v = s.base + 0.08 * Math.sin(2 * Math.PI * day * 8) + ar * 0.02; break;
        case 'acc': v = Math.abs(s.base + ar * 1.5); break;
        case 'incl': v = s.base + ar * 0.3; break;
        case 'env': v = s.base + 3.2 * Math.sin(2 * Math.PI * (day - 0.3)); break;
        case 'wind': v = Math.max(0, s.base + ar * 0.7); break;
      }
      out.push([t, +v.toFixed(TYPES[s.type].digits)]);
    }
    this._histCache.set(key, out);
    return out;
  },

  csv(s, hours) {
    const data = this.history(s, hours);
    const head = `测点编号,测点名称,类型,时间,数值(${TYPES[s.type].unit})\n`;
    const body = data.map(([t, v]) => `${s.id},"${s.name}",${TYPES[s.type].label},${new Date(t).toLocaleString('zh-CN')},${v}`).join('\n');
    return head + body;
  },
};

// 传感器的环境湿度展示辅助
export function sensorShow(s) {
  const d = TYPES[s.type].digits;
  if (s.type === 'env') return `${s.value.toFixed(d)}℃ / ${(s.rh ?? 70).toFixed(0)}%RH`;
  return `${s.value.toFixed(d)} ${TYPES[s.type].unit}`;
}
