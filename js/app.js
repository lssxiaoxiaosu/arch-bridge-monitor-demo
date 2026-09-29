// app.js —— 原型入口：视图切换 / 全局心跳 / 加载工况 / 自动化自检钩子
import { Mock } from './mock.js';
import { Twin } from './view3d.js';
import { Hoist } from './hoisting.js';
import { Panels } from './panels.js';

window.__checks = { modelLoaded: false, charts: false, errors: [], ready: false };
window.onerror = (msg, src, line) => {
  window.__checks.errors.push(String(msg));
  const t = document.createElement('div');
  t.className = 'toast alarm';
  t.textContent = '脚本错误：' + String(msg).slice(0, 80);
  document.getElementById('toast').appendChild(t);
  setTimeout(() => t.remove(), 6000);
};

window.toast = (msg, kind = '') => {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  document.getElementById('toast').appendChild(t);
  setTimeout(() => t.remove(), 5000);
};

const $ = (id) => document.getElementById(id);

/* ---------- 初始化 ---------- */
Panels.init();          // 数据引擎 + 大屏/曲线/预警/设备
Twin.init();            // 三维数字孪生（默认视图，开始加载 GLB）

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const view = btn.dataset.view;
    $('view-' + view).classList.add('active');
    Twin.active = view === 'twin';
    if (view === 'hoist') Hoist.onShow(); else Hoist.onHide();
    Panels.onShow(view);
  });
});

/* ---------- 模拟加载工况 ---------- */
$('btnLoadEvent').addEventListener('click', () => {
  if (Mock.loadEvent.active) return;
  Mock.startLoadEvent();
  window.toast('已触发模拟加载工况：拱顶分级加载，历时约 2 分钟（60s 加载 + 60s 卸载），观察应变响应与预警联动', 'warn');
  const btn = $('btnLoadEvent');
  btn.disabled = true;
  const iv = setInterval(() => {
    if (!Mock.loadEvent.active) { btn.disabled = false; clearInterval(iv); window.toast('加载工况结束，测点数值回落', 'ok'); }
  }, 3000);
});

/* ---------- 时钟与状态 ---------- */
setInterval(() => {
  $('clock').textContent = new Date().toLocaleString('zh-CN', { hour12: false });
}, 1000);
$('clock').textContent = new Date().toLocaleString('zh-CN', { hour12: false });

/* ---------- 全局数据心跳（2s） ---------- */
let firstTick = true;
setInterval(() => {
  const now = Date.now();
  Mock.tickOnce(now);
  Twin.onTick(now);
  Panels.onTick(now);
  if (firstTick) {
    firstTick = false;
    window.__checks.ready = true;
    window.__checks.charts = !!(Panels.chStrain && Panels.chCable);
    window.toast('演示数据引擎已启动（模拟数据，非实测）', 'ok');
  }
}, 2000);

/* ---------- 自检暴露 ---------- */
window.__demo = { Twin, Hoist, Panels, Mock };
window.__getChecks = () => ({
  ...window.__checks,
  twinReady: Twin.ready,
  markers: Twin.markers.size,
  sensors: Mock.sensors.length,
  alarms: Mock.alarms.length,
});
