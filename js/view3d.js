// view3d.js —— 三维数字孪生视图：GLB 加载 / 归一化 / 测点自动挂接 / 拾取交互
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TYPES, Mock, sensorShow } from './mock.js';

const $ = (id) => document.getElementById(id);

export const Twin = {
  ready: false, active: true, span: 6, rise: 1, yDeck: 0,
  meshes: [], matGroups: [], markers: new Map(), selected: null,
  _lastRay: 0, _hoverMesh: null, _selMesh: null, _err: null,

  init() {
    this.ui = {
      canvas: $('twinCanvas'), overlay: $('loadOverlay'), bar: $('loadBar'), txt: $('loadTxt'),
      tip: $('tip3d'), legend: $('legend3d'), layers: $('layerList'), toggles: $('sensorToggles'),
      info: $('modelInfo'), sel: $('selInfo'), spark: $('selSpark'), live: $('liveList'),
    };
    this._initScene();
    this._buildLegend();
    this._buildToggles();
    this._bindUI();
    this._load();
    new ResizeObserver(() => this.resize()).observe(this.ui.canvas);
    this._loop();
  },

  /* ---------- 场景基础 ---------- */
  _initScene() {
    const w = this.ui.canvas.clientWidth || 800, h = this.ui.canvas.clientHeight || 600;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.ui.canvas.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a1220);
    this.scene.fog = new THREE.Fog(0x0a1220, 14, 34);

    this.camera = new THREE.PerspectiveCamera(46, w / h, 0.01, 100);
    this.camera.position.set(4.6, 2.6, 5.2);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0.7, 0);
    this.controls.autoRotateSpeed = 0.8;

    const hemi = new THREE.HemisphereLight(0xbcd6ff, 0x18283e, 0.85);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(5, 9, 4); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x88b6ff, 0.45); fill.position.set(-6, 4, -5); this.scene.add(fill);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(this.renderer), 0.04).texture;
    pmrem.dispose();

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(4.6, 64),
      new THREE.MeshStandardMaterial({ color: 0x0d1a30, roughness: 0.95, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.004; this.scene.add(ground);
    const grid = new THREE.GridHelper(12, 48, 0x1d3a5f, 0x142844);
    grid.position.y = -0.002; this.scene.add(grid);

    this.markerGroup = new THREE.Group(); this.scene.add(this.markerGroup);
    this.hoverBox = new THREE.Box3Helper(new THREE.Box3(), 0xffb454); this.hoverBox.visible = false; this.scene.add(this.hoverBox);
    this.selBox = new THREE.Box3Helper(new THREE.Box3(), 0x17e6c8); this.selBox.visible = false; this.scene.add(this.selBox);
    this.raycaster = new THREE.Raycaster();

    // 迷你趋势图
    this.spark = echarts.init(this.ui.spark);
    this.spark.setOption(this._sparkOption());
    this._bindPick();
  },

  _sparkOption() {
    return {
      grid: { left: 44, right: 8, top: 10, bottom: 20 },
      xAxis: { type: 'time', axisLabel: { color: '#5f7d9e', fontSize: 10, hideOverlap: true }, splitLine: { show: false } },
      yAxis: { type: 'value', axisLabel: { color: '#5f7d9e', fontSize: 10 }, splitLine: { lineStyle: { color: '#16283f' } }, scale: true },
      tooltip: { trigger: 'axis' },
      series: [{ type: 'line', showSymbol: false, lineStyle: { color: '#17e6c8', width: 1.6 },
        areaStyle: { color: 'rgba(23,230,200,0.10)' }, data: [] }],
    };
  },

  /* ---------- 图例 / 测点开关 / 按钮 ---------- */
  _buildLegend() {
    this.ui.legend.innerHTML = Object.entries(TYPES).map(([k, t]) =>
      `<span><i style="background:${t.color}"></i>${t.label}</span>`).join('');
  },
  _buildToggles() {
    this.ui.toggles.innerHTML = Object.entries(TYPES).map(([k, t]) => {
      const n = Mock.sensors.filter(s => s.type === k).length;
      return `<label class="layer-item"><input type="checkbox" checked data-type="${k}">
        <span class="layer-dot" style="background:${t.color}"></span>${t.label}
        <span class="layer-count">${n}</span></label>`;
    }).join('');
    this.ui.toggles.querySelectorAll('input').forEach(cb => {
      cb.addEventListener('change', () => {
        this.markerGroup.children.forEach(sp => {
          const s = sp.userData.sensor;
          if (s && s.type === cb.dataset.type) sp.visible = cb.checked;
        });
      });
    });
  },
  _bindUI() {
    document.querySelectorAll('[data-cam]').forEach(b => b.addEventListener('click', () => this.flyTo(b.dataset.cam)));
    $('btnRotate').addEventListener('click', (e) => {
      this.controls.autoRotate = !this.controls.autoRotate;
      e.currentTarget.classList.toggle('active', this.controls.autoRotate);
    });
    $('btnWire').addEventListener('click', (e) => {
      this._wire = !this._wire;
      e.currentTarget.classList.toggle('active', this._wire);
      this.root && this.root.traverse(o => { if (o.isMesh) o.material.wireframe = this._wire; });
    });
  },

  /* ---------- 模型加载 ---------- */
  _load() {
    const t0 = performance.now();
    const draco = new DRACOLoader();
    draco.setDecoderPath('./libs/draco/');
    const loader = new GLTFLoader().setDRACOLoader(draco);
    loader.load('./model/pingnan_bridge.glb',
      (gltf) => {
        try {
          this._onLoaded(gltf, performance.now() - t0);
        } catch (err) {
          this._err = String(err && err.message || err);
          this.ui.txt.innerHTML = `模型处理失败：${this._err}`;
        }
      },
      (xhr) => {
        if (xhr.total) {
          const p = Math.round(xhr.loaded / xhr.total * 100);
          this.ui.bar.style.width = p + '%';
          this.ui.txt.textContent = p < 100 ? `下载模型文件 ${p}%（14.9 MB）` : '正在解码几何数据（Draco）…';
        }
      },
      (err) => {
        this.ui.txt.innerHTML = '模型加载失败：请通过 <b>启动演示.bat</b> 或本地 HTTP 服务访问（浏览器安全策略禁止 file:// 直接打开）。';
        console.error(err);
      });
  },

  _onLoaded(gltf, ms) {
    this.root = gltf.scene;
    this.scene.add(this.root);
    this._normalize();
    this._collectMaterials();
    const layout = this._computeLayout();
    this.layout = layout;
    this._assignPositions(layout);
    this._buildMarkers();
    this._buildLayerPanel();
    this.ready = true;

    this.ui.overlay.style.display = 'none';
    this.flyTo('all');
    const U = this._uniqGeo;
    this.ui.info.innerHTML =
      `<div>计算跨径 <b>6.00 m</b>（归一化）</div>` +
      `<div>拱顶离桥面 <b>${this.rise.toFixed(2)} m</b></div>` +
      `<div>顶点 <b>${(U.verts / 1e4).toFixed(1)} 万</b> · 三角面 <b>${(U.tris / 1e4).toFixed(1)} 万</b></div>` +
      `<div>构件网格 <b>${U.count}</b> · 材质组 <b>${this.matGroups.length}</b></div>` +
      `<div>加载耗时 <b>${(ms / 1000).toFixed(1)} s</b></div>`;
    this.ui.info.classList.remove('dim');
    window.__checks && (window.__checks.modelLoaded = true);
  },

  // 归一化到试验模型尺寸：跨度 6 m，底部对齐 y=0，中心对齐 xz=0
  _normalize() {
    this.root.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(this.root);
    const size = box.getSize(new THREE.Vector3());
    const spanAxis = size.x >= size.z ? 'x' : 'z';
    this.spanAxis = spanAxis;
    this.root.scale.setScalar(6 / size[spanAxis]);
    this.root.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(this.root);
    const c = box.getCenter(new THREE.Vector3());
    this.root.position.x -= c.x; this.root.position.z -= c.z; this.root.position.y -= box.min.y;
    this.root.updateMatrixWorld(true);
    this.bbox = new THREE.Box3().setFromObject(this.root);
  },

  _collectMaterials() {
    const map = new Map();
    this.root.traverse(o => {
      if (!o.isMesh) return;
      this.meshes.push(o);
      const geo = o.geometry;
      if (!geo.userData._tris) {
        geo.userData._tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
      }
      o.userData.tris = geo.userData._tris;
      const m = o.material;
      if (!map.has(m)) map.set(m, []);
      map.get(m).push(o);
    });
    let i = 0;
    this.matGroups = [...map.entries()].map(([mat, meshes]) => {
      const col = mat.color ? '#' + mat.color.getHexString() : '#8899aa';
      return { idx: i++, mat, meshes, color: col, name: mat.name || `材质组 ${i}`, visible: true };
    });
    // 唯一几何统计（GLB 中多节点共享网格，避免重复计数）
    const uniq = new Set();
    let verts = 0, tris = 0;
    for (const o of this.meshes) {
      if (uniq.has(o.geometry)) continue;
      uniq.add(o.geometry);
      verts += o.geometry.attributes.position.count;
      tris += o.userData.tris;
    }
    this._uniqGeo = { count: uniq.size, verts, tris };
  },

  // 顶点包络分析：自动寻找拱顶线、桥面高程、拱肋区段与两侧主钢管横向位置
  _computeLayout() {
    const b = this.bbox, NB = 240, NY = 160;
    const span = this.spanAxis === 'x' ? b.max.x - b.min.x : b.max.z - b.min.z;
    const minX = b.min.x, maxX = b.max.x, maxY = b.max.y;
    const env = Array.from({ length: NB }, () => [-Infinity, -Infinity]);
    const yHist = new Array(NY).fill(0);
    const samples = []; const p = new THREE.Vector3();
    let verts = 0, tris = 0, stride = 1;

    for (const mesh of this.meshes) {
      verts += mesh.geometry.attributes.position.count;
      tris += mesh.userData.tris;
    }
    stride = Math.max(1, Math.floor(verts / 120000));

    for (const mesh of this.meshes) {
      const pos = mesh.geometry.attributes.position, mw = mesh.matrixWorld;
      for (let i = 0; i < pos.count; i += stride) {
        p.fromBufferAttribute(pos, i).applyMatrix4(mw);
        const xb = Math.min(NB - 1, Math.max(0, Math.floor((p.x - minX) / (maxX - minX) * NB)));
        const zb = p.z >= 0 ? 1 : 0;
        if (p.y > env[xb][zb]) env[xb][zb] = p.y;
        const yb = Math.min(NY - 1, Math.floor(p.y / maxY * NY));
        yHist[yb]++;
        if (samples.length < 150000) samples.push(p.x, p.y, p.z);
      }
    }
    // 桥面高程：顶点数最多的 y 层（桥面板为最大平面）
    let yDeck = 0, best = -1;
    for (let i = 2; i < NY - 2; i++) if (yHist[i] > best && i / NY * maxY > 0.12 * maxY) { best = yHist[i]; yDeck = i / NY * maxY; }
    const rise = maxY - yDeck;

    // 拱肋区段：包络明显高于桥面的最长连续段
    const flag = env.map(e => Math.max(e[0], e[1]) > yDeck + 0.32 * rise);
    let s0 = -1, s1 = -1, len = 0, run = 0, r0 = 0;
    flag.forEach((f, i) => {
      if (f) { if (!run) r0 = i; run++; if (run > len) { len = run; s0 = r0; s1 = i; } }
      else run = 0;
    });
    const pad = Math.round((s1 - s0) * 0.1);
    s0 = Math.max(0, s0 - pad); s1 = Math.min(NB - 1, s1 + pad);
    const bx = i => minX + (i + 0.5) / NB * (maxX - minX);
    const archX0 = bx(s0), archX1 = bx(s1);

    // 两侧主钢管与桥面横向半宽（分位数采样）
    const zArch = [], zDeck = [];
    for (let i = 0; i < samples.length; i += 3) {
      if (samples[i + 1] > yDeck + 0.55 * rise) zArch.push(samples[i + 2]);
      else if (Math.abs(samples[i + 1] - yDeck) < 0.05 * rise) zDeck.push(Math.abs(samples[i + 2]));
    }
    zArch.sort((a, b2) => a - b2); zDeck.sort((a, b2) => a - b2);
    const q = (arr, f) => arr.length ? arr[Math.floor(f * arr.length)] : 0;
    const zT1 = q(zArch, 0.22), zT2 = q(zArch, 0.78);      // 两侧拱肋管中心
    const zDeckHalf = Math.max(0.3, q(zDeck, 0.85));       // 桥面半宽

    this.yDeck = yDeck; this.rise = rise;
    return { env, NB, minX, maxX, maxY, yDeck, rise, archX0, archX1, zT1, zT2, zDeckHalf, verts, tris };
  },

  envY(x, zb) {
    const L = this.layout;
    const i = Math.min(L.NB - 1, Math.max(0, Math.round((x - L.minX) / (L.maxX - L.minX) * L.NB - 0.5)));
    const v = L.env[i] && isFinite(L.env[i][zb]) ? L.env[i][zb] : L.yDeck;
    return v;
  },

  // 将 106 个代表性测点挂接到模型表面
  _assignPositions(L) {
    const segX = (k) => L.archX0 + (k - 0.5) / 22 * (L.archX1 - L.archX0); // k=1..22
    const set = (id, x, y, z) => { const s = Mock.sensors.find(v => v.id === id); if (s) s.pos = [x, y, z]; };
    for (let k = 1; k <= 22; k++) {
      const x = segX(k);
      set(`A-${k}U`, x, this.envY(x, 0) + 0.02, L.zT1);
      set(`A-${k}D`, x, this.envY(x, 1) + 0.02, L.zT2);
    }
    set('F-01', (L.archX0 + L.archX1) / 2, L.maxY + 0.02, L.zT1);
    set('F-02', (L.archX0 + L.archX1) / 2, L.maxY + 0.02, L.zT2);
    const dx = L.maxX - L.minX;
    for (let i = 1; i <= 8; i++) {
      const x = L.minX + dx * (0.12 + 0.76 * (i - 1) / 7);
      set(`D-0${i}`, x, L.yDeck + 0.03, i % 2 ? L.zDeckHalf * 0.7 : -L.zDeckHalf * 0.7);
    }
    for (let h = 1; h <= 16; h++) {
      const x = L.archX0 + (0.26 + 0.48 * (h - 1) / 15) * (L.archX1 - L.archX0);
      set(`E-${String(h * 2 - 1).padStart(2, '0')}`, x, this.envY(x, 0) + 0.02, L.zT1);
      set(`E-${String(h * 2).padStart(2, '0')}`, x, this.envY(x, 1) + 0.02, L.zT2);
    }
    const wx = [0.2, 0.5, 0.65, 0.8].map(f => L.minX + dx * f);
    wx.forEach((x, i) => set(`W-0${i + 1}`, x, L.yDeck + 0.04, 0));
    const ax = [0.15, 0.3, 0.42, 0.5, 0.58, 0.7, 0.85, 0.62].map(f => L.minX + dx * f);
    ax.forEach((x, i) => set(`AC-0${i + 1}`, x, L.yDeck + 0.04, (i % 2 ? -1 : 1) * L.zDeckHalf * 0.6));
    const qx = [0.06, 0.35, 0.65, 0.94].map(f => L.archX0 + f * (L.archX1 - L.archX0));
    qx.forEach((x, i) => set(`QJ-0${i + 1}`, x, this.envY(x, i % 2) + 0.03, i % 2 ? L.zT2 : L.zT1));
    set('ENV-01', L.minX + dx * 0.08, L.yDeck + 0.05, 0);
    set('ENV-02', L.maxX - dx * 0.08, L.yDeck + 0.05, 0);
    set('WS-01', (L.archX0 + L.archX1) / 2, L.maxY + 0.06, 0);
    set('WS-02', L.maxX - dx * 0.05, L.yDeck + 0.06, -L.zDeckHalf * 0.5);
  },

  _markerTexture() {
    if (this._mtex) return this._mtex;
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    const rg = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    rg.addColorStop(0, 'rgba(255,255,255,1)');
    rg.addColorStop(0.35, 'rgba(255,255,255,0.85)');
    rg.addColorStop(0.65, 'rgba(255,255,255,0.12)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
    g.beginPath(); g.arc(32, 32, 9, 0, 6.3); g.fillStyle = '#fff'; g.fill();
    this._mtex = new THREE.CanvasTexture(cv);
    return this._mtex;
  },

  _buildMarkers() {
    for (const s of Mock.sensors) {
      if (!s.pos) continue;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this._markerTexture(), color: TYPES[s.type].color,
        depthTest: false, transparent: true, opacity: 0.95,
      }));
      sp.position.set(...s.pos);
      sp.scale.setScalar(0.085);
      sp.renderOrder = 50;
      sp.userData.sensor = s;
      this.markerGroup.add(sp);
      this.markers.set(s.id, sp);
    }
  },

  _buildLayerPanel() {
    this.ui.layers.innerHTML = this.matGroups.map((g, i) => `
      <label class="layer-item"><input type="checkbox" checked data-g="${i}">
      <span class="layer-dot" style="background:${g.color}"></span>${g.name}
      <span class="layer-count">${g.meshes.length}</span></label>`).join('');
    this.ui.layers.querySelectorAll('input').forEach(cb => {
      cb.addEventListener('change', () => {
        const g = this.matGroups[+cb.dataset.g];
        g.visible = cb.checked;
        g.meshes.forEach(m => { m.visible = g.visible; });
      });
    });
  },

  /* ---------- 拾取交互 ---------- */
  _bindPick() {
    const dom = this.renderer.domElement;
    let downXY = null;
    dom.addEventListener('pointerdown', e => { downXY = [e.clientX, e.clientY]; });
    dom.addEventListener('pointerup', e => {
      if (!downXY || Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]) > 4) return; // 拖动不算点击
      this._pick(e.clientX, e.clientY, true);
    });
    dom.addEventListener('pointermove', e => {
      const now = performance.now();
      if (now - this._lastRay < 90) return;
      this._lastRay = now;
      this._pick(e.clientX, e.clientY, false, e);
    });
    dom.addEventListener('pointerleave', () => { this.ui.tip.hidden = true; });
  },

  _pick(cx, cy, isClick, ev) {
    if (!this.ready) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const m = new THREE.Vector2((cx - r.left) / r.width * 2 - 1, -(cy - r.top) / r.height * 2 + 1);
    this.raycaster.setFromCamera(m, this.camera);
    // 先拾取测点（sprite）
    const hits = this.raycaster.intersectObjects(this.markerGroup.children, false);
    const hit = hits.find(h => h.object.visible && h.object.userData.sensor);
    if (hit) {
      const s = hit.object.userData.sensor;
      this.ui.tip.hidden = false;
      this.ui.tip.style.left = (cx - r.left + 14) + 'px';
      this.ui.tip.style.top = (cy - r.top + 10) + 'px';
      this.ui.tip.innerHTML = `<b>${s.name}</b><br>${sensorShow(s)}`;
      if (isClick) this.selectSensor(s.id);
      return;
    }
    this.ui.tip.hidden = true;
    // 构件拾取（节流）
    const mh = this.raycaster.intersectObjects(this.meshes, false);
    if (mh.length) {
      const mesh = mh[0].object;
      if (this._hoverMesh !== mesh) {
        this._hoverMesh = mesh;
        this.hoverBox.box.setFromObject(mesh);
        this.hoverBox.visible = true;
      }
      this.ui.tip.hidden = false;
      this.ui.tip.style.left = (cx - r.left + 14) + 'px';
      this.ui.tip.style.top = (cy - r.top + 10) + 'px';
      const g = this.matGroups.find(x => x.mat === mesh.material);
      this.ui.tip.innerHTML = `<b>构件 #${this.meshes.indexOf(mesh)}</b> · ${g ? g.name : ''}<br>点击查看详情`;
      if (isClick) this.selectMesh(mesh);
    } else {
      this._hoverMesh = null; this.hoverBox.visible = false;
    }
  },

  selectSensor(id) {
    const s = Mock.sensors.find(v => v.id === id);
    if (!s) return;
    this.selected = { kind: 'sensor', s };
    this.selBox.visible = false;
    const t = TYPES[s.type];
    const lv = ['正常', '一级预警', '二级预警', '三级预警'][s.alarmLvl] || '正常';
    this.ui.sel.innerHTML = `
      <div><b>${s.name}</b></div>
      <div>编号：${s.id} · ${t.label}计</div>
      <div>设计分区：${{ A: 'A区 拱肋', B: 'B区 横联', C: 'C区 腹杆', D: 'D区 桥面系', E: 'E区 吊杆', F: 'F区 合龙段' }[s.zone] || '通用'}</div>
      <div>当前值：<b style="color:${t.color}">${sensorShow(s)}</b></div>
      <div>预警阈值：三级 ${t.thr[0]} / 二级 ${t.thr[1]} / 一级 ${t.thr[2]} ${t.unit}</div>
      <div>状态：<b style="color:${s.status === 'ok' ? '#2fe6a8' : '#ff7a81'}">${lv}</b></div>`;
    if (this._selMarker) { this._selMarker.scale.setScalar(0.085); this._selMarker = null; }
    const sp = this.markers.get(id);
    if (sp) { sp.scale.setScalar(0.14); this._selMarker = sp; }
    this.spark.setOption(this._sparkOption());
    this._sparkTick(true);
  },

  selectMesh(mesh) {
    this.selected = { kind: 'mesh', mesh };
    this._selMesh = mesh;
    this.selBox.box.setFromObject(mesh);
    this.selBox.visible = true;
    const sz = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
    const g = this.matGroups.find(x => x.mat === mesh.material);
    // 最近测点
    const c = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
    let near = null, nd = 1e9;
    for (const s of Mock.sensors) {
      if (!s.pos) continue;
      const d = (s.pos[0] - c.x) ** 2 + (s.pos[1] - c.y) ** 2 + (s.pos[2] - c.z) ** 2;
      if (d < nd) { nd = d; near = s; }
    }
    this.ui.sel.innerHTML = `
      <div><b>构件 #${this.meshes.indexOf(mesh)}</b></div>
      <div>材质组：${g ? g.name : '-'}</div>
      <div>包络尺寸：${sz.x.toFixed(3)} × ${sz.y.toFixed(3)} × ${sz.z.toFixed(3)} m</div>
      <div>三角面：${Math.round(mesh.userData.tris)}</div>
      ${near ? `<div>最近测点：<b>${near.name}</b>（${sensorShow(near)}）</div>` : ''}`;
  },

  /* ---------- 视角 ---------- */
  flyTo(kind) {
    const L = this.layout || { maxY: 1.4, yDeck: 0.5, rise: 0.9, archX0: -2.6, archX1: 2.6 };
    const target = new THREE.Vector3(0, L.yDeck + L.rise * 0.35, 0);
    const P = {
      all: [0, L.maxY * 2.3, 5.6],
      arch: [L.archX0 * 0.55, L.yDeck + L.rise * 1.9, 3.6],
      deck: [-1.8, L.yDeck + 0.75, 3.0],
      crown: [0.4, L.maxY + 0.85, 1.6],
    };
    this.camera.position.set(...P[kind]);
    this.controls.target.copy(target);
    this.controls.update();
  },

  focusSensor(id) {
    const s = Mock.sensors.find(v => v.id === id);
    if (!s || !s.pos || !this.ready) return;
    this.controls.target.set(s.pos[0], s.pos[1], s.pos[2]);
    this.camera.position.set(s.pos[0] + 1.2, s.pos[1] + 0.7, s.pos[2] + 1.6);
    this.controls.update();
    this.selectSensor(id);
  },

  resize() {
    const w = this.ui.canvas.clientWidth, h = this.ui.canvas.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  },

  /* ---------- 每秒刷新 / 渲染循环 ---------- */
  _liveBuilt: false,
  _buildLive() {
    const keys = ['A-11U', 'F-01', 'E-16', 'W-02', 'AC-04', 'QJ-02', 'ENV-01', 'WS-01'];
    this._liveKeys = keys.map(id => Mock.sensors.find(s => s.id === id)).filter(Boolean);
    this.ui.live.innerHTML = this._liveKeys.map(s => `
      <div class="live-row" data-id="${s.id}">
        <span class="live-dot"></span><span class="nm">${s.name}</span><span class="vl">-</span>
      </div>`).join('');
    this.ui.live.querySelectorAll('.live-row').forEach(row => {
      row.addEventListener('click', () => this.focusSensor(row.dataset.id));
    });
    this._liveBuilt = true;
  },
  _updateLive() {
    if (!this._liveBuilt) this._buildLive();
    this.ui.live.querySelectorAll('.live-row').forEach(row => {
      const s = Mock.sensors.find(v => v.id === row.dataset.id);
      if (!s) return;
      row.querySelector('.vl').textContent = sensorShow(s);
      row.classList.toggle('alarm', s.status === 'alarm');
      row.classList.toggle('warn', s.status === 'warn');
      row.querySelector('.live-dot').style.background =
        s.status === 'ok' ? TYPES[s.type].color : (s.status === 'warn' ? '#ffb454' : '#ff5a63');
    });
  },

  onTick(now) {
    // 测点滚动历史（spark 用）
    if (this.selected && this.selected.kind === 'sensor') this._sparkTick();
    this._updateLive();
    // 预警测点变色脉冲
    const t = performance.now() / 1000;
    this.markers.forEach((sp, id) => {
      const s = Mock.sensors.find(v => v.id === id);
      const alarm = s.status !== 'ok';
      if (alarm) {
        sp.material.color.setHex(0xff4d55);
        sp.scale.setScalar(0.09 + 0.035 * (1 + Math.sin(t * 5)));
      } else if (this._selMarker !== sp) {
        const cur = '#' + sp.material.color.getHexString();
        const want = TYPES[s.type].color;
        if (cur.toLowerCase() !== want.toLowerCase()) sp.material.color.set(want);
        if (sp.scale.x > 0.09 && this._selMarker !== sp) sp.scale.setScalar(0.085);
      }
    });
  },

  _sparkTick(force) {
    if (!this.selected || this.selected.kind !== 'sensor') return;
    const s = this.selected.s;
    const data = s.hist.slice(-90);
    this.spark.setOption({ series: [{ data }], yAxis: { name: TYPES[s.type].unit } });
    if (force) this.spark.resize();
  },

  _loop() {
    const tick = () => {
      requestAnimationFrame(tick);
      if (!this.active) return;
      if (this.controls.autoRotate && !this.ready) { /* loading 时也可转 */ }
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      if (!this._infoDone && this.ready) { this._infoDone = true; }
    };
    tick();
  },
};
