// hoisting.js —— 斜拉扣挂缆索吊装 · 参数化工艺模拟（22 节段 + 可拆卸合龙段）
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = (id) => document.getElementById(id);
const HS = 3, Y0 = 0.42, RISE = 1.18;                 // 半跨 / 拱脚高 / 矢高
const DECK_Y = 0.95, SEGW = (HS - 0.27) / 11;         // 桥面高 / 每半跨节段宽
const TWX = 4.05, TW_TOP = 2.83, SAG = 0.42;          // 塔位 / 塔顶高 / 主索垂度
const archY = (x) => Y0 + RISE * (1 - (x / HS) ** 2);
const cableY = (x) => TW_TOP + 0.02 - SAG * (1 - (x / TWX) ** 2);
const PHASES = ['起吊', '走行', '就位', '临时连接', '张拉扣索', '松钩'];
const PH_DUR = [1.2, 2.0, 1.0, 0.7, 1.4, 0.8];

export const Hoist = {
  inited: false, active: false, playing: false, speed: 1,
  idx: 0, phase: 0, pt: 0, done: false,

  init() {
    if (this.inited) return;
    this.inited = true;
    const cv = $('hoistCanvas');
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(cv.clientWidth || 800, cv.clientHeight || 600);
    cv.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a1220);
    this.scene.fog = new THREE.Fog(0x0a1220, 12, 26);
    this.camera = new THREE.PerspectiveCamera(46, (cv.clientWidth || 800) / (cv.clientHeight || 600), 0.01, 100);
    this.camera.position.set(-1.6, 2.5, 7.2);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 1.0, 0);
    this.scene.add(new THREE.HemisphereLight(0xbcd6ff, 0x18283e, 0.9));
    const d1 = new THREE.DirectionalLight(0xffffff, 1.5); d1.position.set(4, 7, 5); this.scene.add(d1);
    const d2 = new THREE.DirectionalLight(0x88b6ff, 0.5); d2.position.set(-5, 3, -4); this.scene.add(d2);

    const grid = new THREE.GridHelper(11, 44, 0x1d3a5f, 0x142844); grid.position.y = -0.002; this.scene.add(grid);
    this._statics();      // 桥墩/拱座/桥面/塔架/主索/吊杆
    this._segments();     // 22 节段 + 合龙段（幽灵体）
    this._rig();          // 起重小车 / 吊钩 / 被吊节段 / 扣索
    this._stepsUI();
    new ResizeObserver(() => this.resize()).observe(cv);
    this._loop();
    this._updateCableUI();
  },

  _mat(color, opt = {}) {
    return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.55, metalness: 0.35 }, opt));
  },
  _line(pts, color, opacity = 1) {
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    return new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
  },

  _statics() {
    const S = this.scene;
    // 拱座
    for (const sx of [-1, 1]) {
      const ab = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.42, 0.85), this._mat(0x33465e));
      ab.position.set(sx * (HS + 0.18), 0.21, 0); S.add(ab);
      // 塔架：立柱 + 顶部横梁 + 后锚
      const tw = new THREE.Group();
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.26, TW_TOP, 0.26), this._mat(0x8a5a2b));
      col.position.y = TW_TOP / 2; tw.add(col);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.1, 0.3), this._mat(0xa06a33));
      cap.position.y = TW_TOP + 0.05; tw.add(cap);
      for (const dz of [-0.28, 0.28]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, TW_TOP, 0.1), this._mat(0x734a24));
        leg.position.set(sx * 0.14, TW_TOP / 2, dz); tw.add(leg);
      }
      tw.position.set(sx * TWX, 0, 0); S.add(tw);
      const anc = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.5), this._mat(0x2c3d52));
      anc.position.set(sx * 5.1, 0.15, 0); S.add(anc);
      S.add(this._line([new THREE.Vector3(sx * TWX, TW_TOP + 0.06, 0), new THREE.Vector3(sx * 5.1, 0.3, 0)], 0x8899aa));
      // 主索
      const pts = [];
      for (let i = 0; i <= 80; i++) {
        const x = -sx * TWX + (2 * sx * TWX) * i / 80;
        pts.push(new THREE.Vector3(x, cableY(x), 0));
      }
      S.add(this._line(pts, 0xcfd8e6));
    }
    // 桥面（中承式：桥面穿过桥面系）
    const deck = new THREE.Mesh(new THREE.BoxGeometry(6.9, 0.035, 0.95), this._mat(0x3f5570));
    deck.position.set(0, DECK_Y, 0); S.add(deck);
    for (const dz of [-0.42, 0.42]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(6.9, 0.05, 0.06), this._mat(0x2f4258));
      beam.position.set(0, DECK_Y - 0.045, dz); S.add(beam);
    }
    // 吊杆（成桥状态示意，随拱肋合龙后理解为张拉完成）
    this.hangers = [];
    for (const sx of [-1, 1]) for (const x of [0.35, 0.75, 1.15, 1.55, 1.95]) {
      const xx = sx * x;
      const ln = this._line([
        new THREE.Vector3(xx, archY(xx), 0),
        new THREE.Vector3(xx, DECK_Y - 0.05, 0)], 0x67e8f9, 0.5);
      S.add(ln); this.hangers.push(ln);
    }
  },

  // 节段几何：side=±1，k=1..11；返回 {center, angle, length}
  _segInfo(side, k) {
    const xa = side * (HS - (k - 1) * SEGW), xb = side * (HS - k * SEGW);
    const y1 = archY(xa), y2 = archY(xb);
    return {
      cx: (xa + xb) / 2, cy: (y1 + y2) / 2,
      len: Math.hypot(Math.abs(xb - xa), Math.abs(y2 - y1)),
      ang: Math.atan2(y2 - y1, xb - xa),
      tip: { x: xa, y: y1 },   // 靠塔架侧端头
    };
  },

  _segments() {
    this.segs = [];
    const ghost = () => this._mat(0x8fa8c8, { transparent: true, opacity: 0.13, depthWrite: false });
    const mk = (side, k, isClosure) => {
      let cx, cy, ang, len, tip;
      if (isClosure) {
        cx = 0; cy = archY(0.27) + (archY(0) - archY(0.27)) * 0.5; len = 0.54;
        ang = 0; tip = { x: 0.27 * -1, y: archY(0.27) };
      } else {
        const inf = this._segInfo(side, k);
        ({ cx, cy, ang, len, tip } = inf);
      }
      const gh = new THREE.Mesh(new THREE.BoxGeometry(len, 0.125, 0.16), ghost());
      gh.position.set(cx, cy, 0); gh.rotation.z = ang; this.scene.add(gh);
      const rec = { side, k, isClosure, cx, cy, ang, len, tip, ghost: gh, solid: null, stay: [] };
      this.segs.push(rec);
      return rec;
    };
    const order = [];
    for (let k = 1; k <= 11; k++) { order.push(mk(-1, k, false)); order.push(mk(1, k, false)); }
    order.push(mk(1, 0, true)); // 合龙段最后
    this.order = order;
  },

  _rig() {
    const S = this.scene;
    this.trolley = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.14), this._mat(0xffb454, { metalness: 0.6 }));
    S.add(this.trolley);
    this.hookLine = this._line([new THREE.Vector3(), new THREE.Vector3()], 0xffd28a);
    S.add(this.hookLine);
    this.hook = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.08), this._mat(0xd9dee6, { metalness: 0.7 }));
    S.add(this.hook);
    this.carried = null; // 被吊节段实体
    this.stayLines = []; // 已安装节段扣索
    this.curStay = null;
    this.trolleyX = 3.35;
    this.hookLen = 0.3;
    this.carry = { x: 3.2, y: 0.14 }; // 拼装场节段位置
  },

  _stepsUI() {
    const ol = $('hoistSteps');
    ol.innerHTML = PHASES.map(p => `<li>${p}</li>`).join('') + '<li data-cl>合龙锁定</li>';
    $('hoistPlay').addEventListener('click', () => this.togglePlay());
    $('hoistNext').addEventListener('click', () => { this.playing = false; this._skip(); });
    $('hoistReset').addEventListener('click', () => this.reset());
    $('hoistSpeed').addEventListener('change', e => { this.speed = +e.target.value; });
  },

  togglePlay() {
    if (this.done) this.reset();
    this.playing = !this.playing;
    $('hoistPlay').textContent = this.playing ? '⏸ 暂停' : '▶ 播放';
  },

  reset() {
    this.playing = false; this.idx = 0; this.phase = 0; this.pt = 0; this.done = false;
    $('hoistPlay').textContent = '▶ 播放';
    for (const s of this.segs) {
      if (s.solid) { this.scene.remove(s.solid); s.solid = null; }
      s.ghost.visible = true;
      s.stay.forEach(l => this.scene.remove(l)); s.stay = [];
    }
    this.stayLines = [];
    if (this.curStay) { this.scene.remove(this.curStay); this.curStay = null; }
    if (this.carried) { this.scene.remove(this.carried); this.carried = null; }
    this.trolleyX = 3.35; this.hookLen = 0.3;
    this._markSteps();
    this._updateCableUI();
  },

  _skip() { // 跳到下一件
    const rec = this.order[this.idx];
    if (rec && !rec.solid) this._install(rec);
    this.idx = Math.min(this.idx + 1, this.order.length);
    this.phase = 0; this.pt = 0;
    if (this.idx >= this.order.length) this._finish();
    this._markSteps();
  },

  _install(rec) {
    if (this.carried) { this.scene.remove(this.carried); this.carried = null; }
    rec.ghost.visible = false;
    const color = rec.isClosure ? 0x22e6a8 : 0x3aa0ff;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(rec.len, rec.isClosure ? 0.14 : 0.125, 0.16),
      this._mat(color, { emissive: color, emissiveIntensity: 0.25 }));
    m.position.set(rec.cx, rec.cy, 0); m.rotation.z = rec.ang;
    this.scene.add(m); rec.solid = m;
    // 扣索：由靠塔侧端头连至同侧塔顶（合龙段不设扣索）
    if (!rec.isClosure) {
      const twx = rec.side * TWX;
      const l = this._line([
        new THREE.Vector3(rec.tip.x, rec.tip.y + 0.07, 0),
        new THREE.Vector3(twx, TW_TOP, 0)], 0xffe08a, 0.85);
      this.scene.add(l); rec.stay = [l];
      this.stayLines.push(l);
    }
  },

  _finish() {
    this.done = true; this.playing = false;
    $('hoistPlay').textContent = '↺ 重新演示';
    $('hoistProg').innerHTML = '<span style="color:#22e6a8">✔ 全桥合龙完成（23/23）</span>';
    $('hoistNote').textContent = '拱顶合龙段已锁定，扣索全部拆除，转入桥面系与监测荷载试验阶段。';
  },

  _markSteps() {
    const lis = $('hoistSteps').querySelectorAll('li');
    const cur = this.order[this.idx];
    const isClosure = cur && cur.isClosure;
    lis.forEach((li, i) => {
      li.className = '';
      if (isClosure) {
        if (i < PHASES.length) li.className = 'done';
        else if (i === PHASES.length) li.className = 'cur';
      } else {
        if (i < this.phase) li.className = 'done';
        else if (i === this.phase) li.className = 'cur';
      }
    });
    const name = cur ? (cur.isClosure ? '合龙段' : `${cur.side < 0 ? '左岸' : '右岸'}S${cur.k}`) : '—';
    $('hoistProg').textContent = `第 ${Math.min(this.idx + 1, this.order.length)} / ${this.order.length} 件 · ${name}`;
  },

  _updateCableUI() {
    const cur = this.order[this.idx];
    const name = cur ? (cur.isClosure ? '合龙段' : `${cur.side < 0 ? '左岸' : '右岸'}S${cur.k}`) : '-';
    const lifting = this.phase <= 2;
    const tensioning = this.phase === 4 || this.phase === 5;
    const liftF = lifting ? (1.35 + Math.sin(performance.now() / 300) * 0.06).toFixed(2) : '0.00';
    const stayF = tensioning ? (this.phase === 4 ? (this.pt / PH_DUR[4] * 0.88).toFixed(2) : '0.88') : '0.00';
    const nStay = this.stayLines.length;
    $('hoistCable').innerHTML =
      `<div>吊装构件：<b>${name}</b></div>` +
      `<div>起重索力：<b style="color:#ffb454">${liftF} kN</b></div>` +
      `<div>当前扣索力：<b style="color:#17e6c8">${stayF} kN</b></div>` +
      `<div>已张拉扣索：<b>${nStay} 组</b></div>`;
  },

  /* ---------- 逐帧推进 ---------- */
  _loop() {
    const tick = () => {
      requestAnimationFrame(tick);
      if (!this.active) return;
      const dt = this.speed * Math.min(0.05, (this._last ? (performance.now() - this._last) : 16) / 1000);
      this._last = performance.now();
      if (this.playing && !this.done) {
        this.pt += dt;
        const dur = PH_DUR[this.phase];
        if (this.pt >= dur) {
          this.pt = 0; this.phase++;
          if (this.phase >= PHASES.length) {
            this._install(this.order[this.idx]);
            this.idx++; this.phase = 0;
            if (this.idx >= this.order.length) this._finish();
          }
          this._markSteps();
        }
      }
      this._pose();
      this._updateCableUI();
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  },

  _pose() {
    const rec = this.order[Math.min(this.idx, this.order.length - 1)];
    if (!rec) return;
    const p = Math.min(1, this.pt / PH_DUR[this.phase]);
    const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const e = ease(p);
    const targetTX = rec.isClosure ? 0 : Math.max(-3.6, Math.min(3.6, rec.cx * 0.92));
    let tx = this.trolleyX, hl = this.hookLen;

    if (this.done) { this.trolleyX = 0; hl = 0.25; }
    else if (!this.carried && this.phase === 0) {
      // 起吊：小车移向拼装场，吊钩下放
      tx = 3.35 + (this.carry.x - 3.35) * Math.min(1, this.pt / PH_DUR[0] * 1.4);
      hl = 0.3 + (this.carry.y + 0.55 - cableY(tx)) * 0; // 钩长按需
      hl = cableY(tx) - this.carry.y - 0.12;
    } else if (this.phase === 1) {
      // 走行：先收钩提升，再沿主索走至目标上方
      const up = Math.min(1, p * 2.5);
      tx = 3.35 + (targetTX - 3.35) * e;
      hl = (cableY(3.35) - this.carry.y - 1.0) * (1 - up) + 0.55 * up;
    } else if (this.phase === 2) {
      // 就位
      tx = targetTX;
      hl = cableY(tx) - (rec.cy + 0.12) - 0.1;
    } else if (this.phase === 3 || this.phase === 4 || this.phase === 5) {
      tx = targetTX; hl = cableY(tx) - (rec.cy + 0.12) - 0.1;
      if (this.phase === 5) hl = hl * (1 - e) + 0.15 * e; // 松钩收绳
    } else {
      tx = targetTX; hl = 0.25;
    }
    this.trolleyX = tx; this.hookLen = Math.max(0.12, hl);
    const ty = cableY(tx);
    this.trolley.position.set(tx, ty + 0.06, 0);
    this.hook.position.set(tx, ty - this.hookLen, 0);
    this.hookLine.geometry.setFromPoints([new THREE.Vector3(tx, ty, 0), new THREE.Vector3(tx, ty - this.hookLen, 0)]);

    // 被吊节段跟随
    if (!this.carried && (this.phase === 0 || this.phase === 1 || this.phase === 2) && !this.done) {
      const color = rec.isClosure ? 0x22e6a8 : 0xff9f43;
      this.carried = new THREE.Mesh(
        new THREE.BoxGeometry(rec.len, rec.isClosure ? 0.14 : 0.125, 0.16),
        this._mat(color, { emissive: color, emissiveIntensity: 0.3 }));
      this.scene.add(this.carried);
    }
    if (this.carried) {
      if (this.phase === 0) {
        const lift = Math.min(1, this.pt / PH_DUR[0]);
        this.carried.position.set(this.carry.x, this.carry.y + 0.9 * lift, 0);
        this.carried.rotation.z = 0;
      } else if (this.phase === 1) {
        const sway = Math.sin(performance.now() / 260) * 0.03 * (1 - e * 0.5);
        this.carried.position.set(tx, ty - this.hookLen - 0.09, 0);
        this.carried.rotation.z = sway;
      } else if (this.phase === 2) {
        this.carried.position.set(
          tx + (rec.cx - tx) * e, (ty - this.hookLen - 0.09) + (rec.cy - (ty - this.hookLen - 0.09)) * e, 0);
        this.carried.rotation.z = rec.ang * e;
      } else {
        // 已就位：临时连接/张拉/松钩期间贴在目标位
        this.carried.position.set(rec.cx, rec.cy, 0);
        this.carried.rotation.z = rec.ang;
      }
    } else if (!this.done && this.phase >= 3) {
      // 就位后以实体表示（无 carried 也画出到位姿态）
    }
    if ((this.phase === 3 || this.phase === 4) && this.carried) {
      this.carried.material.emissiveIntensity = 0.3 + 0.25 * Math.abs(Math.sin(performance.now() / 180));
    }
    // 当前扣索生长动画
    if (this.curStay) { this.scene.remove(this.curStay); this.curStay = null; }
    if (this.phase === 4 && this.carried) {
      const a = new THREE.Vector3(rec.tip.x, rec.tip.y + 0.07, 0);
      const b = new THREE.Vector3(rec.side * TWX, TW_TOP, 0);
      const m = a.clone().lerp(b, e);
      this.curStay = this._line([a, m], 0xffe08a);
      this.scene.add(this.curStay);
    }
  },

  resize() {
    const cv = $('hoistCanvas');
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  },

  onShow() {
    this.init();
    this.active = true;
    this.resize();
    this._markSteps();
  },
  onHide() { this.active = false; },
};
