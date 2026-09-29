// panels.js —— 监测总览 / 曲线查询 / 预警管理 / 设备测点
import { TYPES, DESIGN_COUNTS, Mock, sensorShow } from './mock.js';

const $ = (id) => document.getElementById(id);
const ZONE_TXT = { A: '拱肋', B: '横联', C: '腹杆', D: '桥面系', E: '吊杆', F: '合龙段' };
const LV_TXT = { 1: '一级', 2: '二级', 3: '三级' };
const LV_CLS = { 1: 'lv1', 2: 'lv2', 3: 'lv3' };
const fmtT = (t) => new Date(t).toLocaleTimeString('zh-CN', { hour12: false });
const axStyle = {
  axisLine: { lineStyle: { color: '#2a4368' } },
  axisLabel: { color: '#7f9cbd', fontSize: 10 },
  splitLine: { lineStyle: { color: '#16283f' } },
};

export const Panels = {
  inited: false, activeView: 'twin',
  _histInited: false, _devInited: false,
  _strainKeys: ['A-2U', 'A-8U', 'A-11U', 'A-11D', 'F-01'],

  init() {
    if (this.inited) return;
    this.inited = true;
    Mock.init();
    // 预置滚动历史，使曲线首屏不空
    for (const s of Mock.sensors) {
      const h = Mock.history(s, 1).slice(-40);
      s.hist.push(...h.map(([t, v]) => [t, v]));
      if (s.type === 'env') {
        s.rhHist = h.map(([t]) => {
          const day = (t % 86400e3) / 86400e3;
          return [t, +(70 - 8 * Math.sin(2 * Math.PI * (day - 0.3))).toFixed(0)];
        });
      }
    }
    this._initDash();
    this._initHistory();
    this._initAlarm();
    this._renderDev();
    this.onTick(Date.now());
  },

  /* ================= 监测总览 ================= */
  _initDash() {
    const mk = (id) => echarts.init($(id));
    this.chStrain = mk('chStrain'); this.chCable = mk('chCable');
    this.chDisp = mk('chDisp'); this.chEnv = mk('chEnv');

    const names = { 'A-2U': '拱脚上游', 'A-8U': '1/4跨上游', 'A-11U': '拱顶上游', 'A-11D': '拱顶下游', 'F-01': '合龙段' };
    const COLORS = ['#22d3ee', '#3aa0ff', '#17e6c8', '#a78bfa', '#fbbf24'];
    this.chStrain.setOption({
      color: COLORS, tooltip: { trigger: 'axis' },
      legend: { top: 2, textStyle: { color: '#9db8d8', fontSize: 10 }, itemWidth: 14, itemHeight: 8 },
      grid: { left: 46, right: 12, top: 28, bottom: 24 },
      xAxis: { type: 'time', axisLabel: { color: '#7f9cbd', fontSize: 10, hideOverlap: true }, splitLine: { show: false } },
      yAxis: { type: 'value', name: 'με', nameTextStyle: { color: '#7f9cbd' }, scale: true, ...axStyle },
      series: this._strainKeys.map(id => ({
        name: names[id], type: 'line', showSymbol: false, smooth: true,
        lineStyle: { width: 1.6 }, data: [],
      })),
    });
    this.chCable.setOption({
      tooltip: { trigger: 'axis' },
      grid: { left: 42, right: 12, top: 14, bottom: 24 },
      xAxis: { type: 'category', data: [], ...axStyle, axisLabel: { color: '#7f9cbd', fontSize: 9 } },
      yAxis: { type: 'value', name: 'kN', nameTextStyle: { color: '#7f9cbd' }, scale: true, ...axStyle },
      series: [{ type: 'bar', barWidth: '55%', itemStyle: { color: '#7c6ce0', borderRadius: [3, 3, 0, 0] }, data: [] }],
    });
    this.chDisp.setOption({
      color: ['#fbbf24', '#ff9f43', '#ffe08a', '#f6c344'], tooltip: { trigger: 'axis' },
      legend: { top: 2, textStyle: { color: '#9db8d8', fontSize: 10 }, itemWidth: 14, itemHeight: 8 },
      grid: { left: 46, right: 12, top: 28, bottom: 24 },
      xAxis: { type: 'time', axisLabel: { color: '#7f9cbd', fontSize: 10, hideOverlap: true }, splitLine: { show: false } },
      yAxis: { type: 'value', name: 'mm', nameTextStyle: { color: '#7f9cbd' }, scale: true, ...axStyle },
      series: [1, 2, 3, 4].map(i => ({
        name: `W-0${i}`, type: 'line', showSymbol: false, smooth: true, lineStyle: { width: 1.4 }, data: [],
      })),
    });
    this.chEnv.setOption({
      color: ['#60a5fa', '#93c5fd', '#f472b6'], tooltip: { trigger: 'axis' },
      legend: { top: 2, textStyle: { color: '#9db8d8', fontSize: 10 }, itemWidth: 14, itemHeight: 8 },
      grid: { left: 40, right: 40, top: 28, bottom: 24 },
      xAxis: { type: 'time', axisLabel: { color: '#7f9cbd', fontSize: 10, hideOverlap: true }, splitLine: { show: false } },
      yAxis: [
        { type: 'value', name: '℃/%', min: 0, max: 100, interval: 25, nameTextStyle: { color: '#7f9cbd' }, ...axStyle },
        { type: 'value', name: 'm/s', min: 0, max: 6, nameTextStyle: { color: '#7f9cbd' }, splitLine: { show: false }, ...axStyle },
      ],
      series: [
        { name: '温度', type: 'line', showSymbol: false, smooth: true, data: [] },
        { name: '湿度', type: 'line', showSymbol: false, smooth: true, data: [] },
        { name: '风速', type: 'line', showSymbol: false, smooth: true, yAxisIndex: 1, data: [] },
      ],
    });
    this._kpi();
  },

  _kpi() {
    const st = Mock.stats();
    const kpi = [
      { k: '在线测点', v: st.online, unit: '', cls: 'ok' },
      { k: '数据采集单元', v: st.devices, unit: '', cls: 'ok' },
      { k: '今日预警', v: st.alarmToday, unit: '条', cls: st.alarmToday ? 'warn' : '' },
      { k: '最大实时应变', v: st.maxStrain.v.toFixed(1), unit: 'με', sub: st.maxStrain.s ? st.maxStrain.s.id : '', cls: '' },
      { k: '最大索力', v: st.maxCable.v.toFixed(3), unit: 'kN', sub: st.maxCable.s ? st.maxCable.s.id : '', cls: '' },
      { k: '实时风速', v: st.wind ? st.wind.value.toFixed(1) : '-', unit: 'm/s', cls: '' },
    ];
    $('kpiRow').innerHTML = kpi.map(x =>
      `<div class="kpi ${x.cls}"><div class="k">${x.k}</div><div class="v">${x.v}<small>${x.unit}</small>${x.sub ? `<small style="margin-left:8px">${x.sub}</small>` : ''}</div></div>`).join('');
  },

  _dashTick() {
    this._kpi();
    const byId = (id) => Mock.sensors.find(s => s.id === id);
    this.chStrain.setOption({
      series: this._strainKeys.map((id, i) => ({ data: byId(id).hist.slice(-90) })),
    });
    const pairs = [];
    for (let h = 1; h <= 16; h++) {
      const a = byId(`E-${String(h * 2 - 1).padStart(2, '0')}`), b = byId(`E-${String(h * 2).padStart(2, '0')}`);
      pairs.push(+(((a.value + b.value) / 2).toFixed(3)));
    }
    this.chCable.setOption({
      xAxis: { data: pairs.map((_, i) => `S${i + 1}`) },
      series: [{ data: pairs }],
    });
    this.chDisp.setOption({ series: [1, 2, 3, 4].map(i => ({ data: byId(`W-0${i}`).hist.slice(-90) })) });
    const env = byId('ENV-01'), wind = byId('WS-01');
    this.chEnv.setOption({
      series: [
        { data: env.hist.slice(-90).map(([t, v]) => [t, v]) },
        { data: (env.rhHist && env.rhHist.length ? env.rhHist : env.hist.map(([t, v]) => [t, +(env.rh ?? 70).toFixed(0)])).slice(-90) },
        { data: wind.hist.slice(-90) },
      ],
    });
    // 右侧预警列表
    const list = Mock.alarms.slice(0, 30);
    $('dashAlarms').innerHTML = list.length ? list.map(a => `
      <div class="mini-al"><span class="lv ${LV_CLS[a.level]}">${LV_TXT[a.level]}</span>
      ${a.name}<div class="tm">${fmtT(a.time)} · ${a.value}${a.unit} ≥ ${a.threshold}${a.unit}</div></div>`).join('')
      : '<div class="mini-none">暂无预警，系统运行正常</div>';
  },

  /* ================= 曲线查询 ================= */
  _initHistory() {
    const tSel = $('hsType'), sSel = $('hsSensor');
    tSel.innerHTML = Object.entries(TYPES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join('');
    const fillSensors = () => {
      const list = Mock.sensors.filter(s => s.type === tSel.value);
      sSel.innerHTML = list.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    };
    fillSensors();
    tSel.addEventListener('change', fillSensors);
    $('btnHsQuery').addEventListener('click', () => this._queryHistory());
    $('btnHsCsv').addEventListener('click', () => {
      const s = Mock.sensors.find(v => v.id === sSel.value);
      if (!s) return;
      const blob = new Blob(['\uFEFF' + Mock.csv(s, +$('hsRange').value)], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${s.id}_history_${$('hsRange').value}h.csv`;
      a.click(); URL.revokeObjectURL(a.href);
      window.toast && window.toast('CSV 已导出', 'ok');
    });
    this._histInited = true;
    this._queryHistory();
  },

  _queryHistory() {
    const s = Mock.sensors.find(v => v.id === $('hsSensor').value);
    if (!s) return;
    const hours = +$('hsRange').value;
    const data = Mock.history(s, hours);
    $('hsTitle').textContent = `${s.name} · 近 ${hours >= 24 ? hours / 24 + ' 天' : hours + ' 小时'}（${TYPES[s.type].unit}）`;
    if (!this.chHist) {
      this.chHist = echarts.init($('chHistory'));
      window.addEventListener('resize', () => this.chHist && this.chHist.resize());
    }
    this.chHist.setOption({
      grid: { left: 56, right: 20, top: 30, bottom: 56 },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'time', axisLabel: { color: '#7f9cbd', fontSize: 10, hideOverlap: true }, splitLine: { show: false } },
      yAxis: { type: 'value', scale: true, name: TYPES[s.type].unit, nameTextStyle: { color: '#7f9cbd' }, ...axStyle },
      dataZoom: [
        { type: 'inside' },
        { type: 'slider', height: 20, bottom: 10, borderColor: '#22395a', backgroundColor: '#0e1c31', fillerColor: 'rgba(23,230,200,0.12)', handleStyle: { color: '#17e6c8' }, textStyle: { color: '#7f9cbd' } },
      ],
      series: [{
        type: 'line', showSymbol: false, smooth: true, data,
        lineStyle: { color: TYPES[s.type].color, width: 1.6 },
        areaStyle: { color: 'rgba(23,230,200,0.06)' },
        markLine: {
          silent: true, symbol: 'none', lineStyle: { type: 'dashed', color: '#a03040' },
          data: [{ yAxis: TYPES[s.type].thr[2], label: { formatter: `一级阈值 ${TYPES[s.type].thr[2]}`, color: '#ff9ea4', fontSize: 10 } }],
        },
      }],
    }, true);
  },

  /* ================= 预警管理 ================= */
  _initAlarm() {
    $('almLevel').addEventListener('change', () => this._renderAlarms());
    $('almStatus').addEventListener('change', () => this._renderAlarms());
  },

  _renderAlarms() {
    const lv = $('almLevel').value, stt = $('almStatus').value;
    const rows = Mock.alarms.filter(a => (!lv || a.level === +lv) && (!stt || a.status === stt)).slice(0, 120);
    $('alarmEmpty').style.display = rows.length ? 'none' : '';
    $('alarmTable').querySelector('tbody').innerHTML = rows.map((a, i) => `
      <tr>
        <td>${new Date(a.time).toLocaleString('zh-CN', { hour12: false })}</td>
        <td>${a.name}</td><td>${ZONE_TXT[a.type === 'cable' ? 'E' : 'A'] || '—'}</td>
        <td>${TYPES[a.type].label}</td>
        <td style="color:${a.level === 1 ? '#ff7a81' : '#ffb454'}">${a.value} ${a.unit}</td>
        <td>${a.threshold} ${a.unit}</td>
        <td><span class="st ${LV_CLS[a.level]}">${LV_TXT[a.level]}</span></td>
        <td><span class="st ${a.status === '未确认' ? 'st-un' : a.status === '已确认' ? 'st-ok' : 'st-done'}">${a.status}</span></td>
        <td>${a.status === '未确认' ? `<button class="rowbtn" data-ack="${Mock.alarms.indexOf(a)}">确认</button>` : '—'}</td>
      </tr>`).join('');
    $('alarmTable').querySelectorAll('[data-ack]').forEach(b => b.addEventListener('click', () => {
      Mock.alarms[+b.dataset.ack].status = '已确认';
      window.toast && window.toast('预警已确认', 'ok');
      this._renderAlarms(); this._alarmStats();
    }));
    this._alarmStats();
  },

  _alarmStats() {
    const all = Mock.alarms;
    const c = (f) => all.filter(f).length;
    const items = [
      { k: '一级预警（未恢复）', v: c(a => a.level === 1 && a.status !== '已恢复'), cls: 'alarm' },
      { k: '二级预警（未恢复）', v: c(a => a.level === 2 && a.status !== '已恢复'), cls: 'warn' },
      { k: '三级预警（未恢复）', v: c(a => a.level === 3 && a.status !== '已恢复'), cls: '' },
      { k: '未确认', v: c(a => a.status === '未确认'), cls: 'warn' },
      { k: '今日累计', v: all.length, cls: '' },
    ];
    $('alarmStats').innerHTML = items.map(x =>
      `<div class="kpi ${x.cls}"><div class="k">${x.k}</div><div class="v">${x.v}<small>条</small></div></div>`).join('');
    const badge = $('navAlarmBadge');
    const un = c(a => a.status === '未确认');
    badge.hidden = !un;
    badge.textContent = un > 99 ? '99+' : un;
  },

  /* ================= 设备测点 ================= */
  _renderDev() {
    if (this._devInited) return;
    this._devInited = true;
    const hb = () => '刚刚';
    const rows = [];
    for (let i = 1; i <= 13; i++) {
      const n = i <= 12 ? 32 : 4;
      rows.push(['DAQ-S' + String(i).padStart(2, '0'), '32通道应变采集模块', 32, n, '10 Hz']);
    }
    rows.push(['DAQ-S14', '32通道应变采集模块（备机）', 32, 0, '—']);
    const cUnits = [
      ['DAQ-C01', '综合采集单元（索力）', 32, 32, '1 Hz'],
      ['DAQ-C02', '综合采集单元（动位移）', 8, 24, '50 Hz'],
      ['DAQ-C03', '综合采集单元（加速度）', 8, 24, '100 Hz'],
      ['DAQ-C04', '综合采集单元（倾角）', 4, 12, '10 Hz'],
      ['DAQ-C05', '综合采集单元（温湿度）', 2, 8, '1/60 Hz'],
      ['DAQ-C06', '综合采集单元（风速风向）', 2, 4, '1 Hz'],
      ['DAQ-C07', '综合采集单元（备用）', 8, 0, '—'],
      ['DAQ-C08', '边缘网关 / 数据汇聚', '—', '—', '—'],
    ];
    $('devTable').querySelector('tbody').innerHTML = [...rows, ...cUnits].map(r => `
      <tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td>
      <td><span class="dot-on"></span> 在线</td><td>${r[0] === 'DAQ-C08' ? hb() : hb()}</td></tr>`).join('');

    const zones = [['A', '拱肋', 176, 44], ['B', '横联', 44, 0], ['C', '腹杆', 40, 0], ['D', '桥面系', 88, 8], ['E', '吊杆（应变）', 32, 0], ['F', '合龙段', 8, 2]];
    $('zoneTable').querySelector('tbody').innerHTML = zones.map(z =>
      `<tr><td>${z[0]} 区</td><td>${z[1]}</td><td>${z[2]}</td><td>${z[3]}</td></tr>`).join('');

    const demoCnt = {};
    for (const s of Mock.sensors) demoCnt[s.type] = (demoCnt[s.type] || 0) + 1;
    $('sensTable').querySelector('tbody').innerHTML = Object.entries(DESIGN_COUNTS).map(([k, n]) => `
      <tr><td style="color:${TYPES[k].color}">${TYPES[k].label}</td><td>${n}</td><td>${demoCnt[k] || 0}</td><td>100%</td></tr>`).join('');
  },

  /* ================= 全局心跳 ================= */
  onTick(now) {
    if (this.activeView === 'dash') this._dashTick();
    if (this.activeView === 'alarm') this._renderAlarms();
    if (this.activeView === 'devices') { /* 静态表 + 心跳列已示意为"刚刚" */ }
    // KPI 与导航角标任何视图下都轻量刷新
    if (this.activeView === 'twin') this._alarmStats();
  },

  onShow(view) {
    this.activeView = view;
    setTimeout(() => {
      ['chStrain', 'chCable', 'chDisp', 'chEnv'].forEach(k => this[k] && this[k].resize());
      if (view === 'dash') this._dashTick();
      if (view === 'alarm') this._renderAlarms();
      if (view === 'history' && this.chHist) this.chHist.resize();
    }, 30);
  },
};
