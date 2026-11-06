/* CatchCat demo — UI + scan + detection flow */
(() => {
  "use strict";

  const D = window.CatchData;
  const S = window.CatchStore;

  const state = {
    data: S.load(),
    tab: "album",
    stream: null,
    track: null,
    torchOn: false,
    detector: null,
    detectorLoading: null,
    scanMode: null, // "live" | "demo"
    demoPhoto: null,
    triesLeft: 3,
    pendingCat: null,
    map: null,
    mapReady: false,
    userLat: null,
    userLng: null,
    markers: [],
    aimRaf: null,
    aimPos: 0,
    aimDir: 1,
    dragging: false
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function toast(msg, ms = 2200) {
    const el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, ms);
  }

  function refreshResources() {
    S.applyRecharge(state.data);
    S.rollToday(state.data);
    S.save(state.data);
    const { cans, coins, xp } = state.data.resources;
    $("#res-cans").textContent = cans;
    $("#res-coins").textContent = coins;
    $("#res-xp").textContent = xp;
    $("#scan-cans").textContent = cans;
    $("#mg-cans").textContent = cans;
    $("#profile-coins").textContent = coins;
  }

  function renderAlbum() {
    const grid = $("#album-grid");
    const empty = $("#album-empty");
    $$(".sticker-card", grid).forEach((n) => n.remove());
    const cats = state.data.cats;
    if (!cats.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    // newest first
    const ordered = [...cats].reverse();
    for (const cat of ordered) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `sticker-card rarity-${cat.rarity}`;
      btn.innerHTML = `
        <img class="sticker-img" src="${cat.photo}" alt="${escapeAttr(cat.name)}" />
        <span class="sticker-label"><span>${escapeHtml(cat.name)}</span><i class="paw">🐾</i></span>
      `;
      btn.addEventListener("click", () => showCard(cat));
      grid.appendChild(btn);
    }
  }

  function renderProfile() {
    const cats = state.data.cats;
    const xp = state.data.resources.xp;
    const lvl = D.levelFromXp(xp);
    $("#profile-count").textContent = cats.length;
    $("#profile-lvl").textContent = `LVL ${lvl}`;
    $("#profile-xp-fill").style.width = `${Math.round(D.xpProgress(xp) * 100)}%`;
    $("#profile-rarest").textContent = S.rarest(cats) || "—";
    $("#profile-today").textContent = state.data.todayCount || 0;
  }

  function setTab(tab) {
    state.tab = tab;
    $$(".tab-panel").forEach((p) => { p.hidden = true; });
    $(`#tab-${tab}`).hidden = false;
    $$(".nav-item").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === tab);
    });
    if (tab === "album") renderAlbum();
    if (tab === "profile") renderProfile();
    if (tab === "map") ensureMap();
    refreshResources();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  /* ---------- Map ---------- */
  function ensureMap() {
    if (!state.mapReady) {
      state.map = L.map("map", {
        zoomControl: false,
        attributionControl: true
      });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap"
      }).addTo(state.map);
      state.mapReady = true;
      // Hangzhou default
      state.map.setView([30.2741, 120.1551], 14);
      tryGeolocate(true);
    }
    setTimeout(() => state.map.invalidateSize(), 80);
    refreshMapPins();
  }

  function tryGeolocate(center) {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.userLat = pos.coords.latitude;
        state.userLng = pos.coords.longitude;
        if (center && state.map) {
          state.map.setView([state.userLat, state.userLng], 15);
        }
      },
      () => {},
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  function refreshMapPins() {
    if (!state.map) return;
    state.markers.forEach((m) => m.remove());
    state.markers = [];

    const center = state.map.getCenter();
    const baseLat = state.userLat ?? center.lat;
    const baseLng = state.userLng ?? center.lng;

    for (const s of D.SAMPLE_SIGHTINGS) {
      addPin(s.lat, s.lng, s.photo, s.name, "社区记录 · 示例", true);
    }

    for (const cat of state.data.cats) {
      let lat = cat.lat;
      let lng = cat.lng;
      if (lat == null || lng == null) {
        lat = baseLat + (Math.random() - 0.5) * 0.012;
        lng = baseLng + (Math.random() - 0.5) * 0.012;
      }
      addPin(lat, lng, cat.photo, cat.name, `${cat.rarity} · ${D.formatSerial(cat.serial)}`, false, cat);
    }
  }

  function addPin(lat, lng, photo, name, meta, sample, cat) {
    const icon = L.divIcon({
      className: "",
      html: `<img class="cat-pin${sample ? " sample" : ""}" src="${photo}" alt="" />`,
      iconSize: [48, 48],
      iconAnchor: [24, 24]
    });
    const marker = L.marker([lat, lng], { icon }).addTo(state.map);
    marker.on("click", () => {
      if (cat) {
        showCard(cat);
      } else {
        $("#pin-preview-img").src = photo;
        $("#pin-preview-name").textContent = name;
        $("#pin-preview-meta").textContent = meta;
        $("#pin-preview").hidden = false;
      }
    });
    state.markers.push(marker);
  }

  /* ---------- Scan ---------- */
  async function openScan() {
    refreshResources();
    if (state.data.resources.cans <= 0) {
      toast("罐头用完了，等一会儿会自动回复");
      return;
    }
    state.triesLeft = 3;
    state.scanMode = null;
    state.demoPhoto = null;
    updateTriesUI();
    $("#scan-screen").hidden = false;
    $("#minigame").hidden = true;
    $("#detecting").hidden = true;
    $("#demo-frame").hidden = true;
    $("#scan-video").hidden = false;
    $("#scan-hint").textContent = "拖动罐头，对准后松手";
    resetCanPosition();
    await startCamera();
  }

  function updateTriesUI() {
    const t = `${state.triesLeft} / 3 次`;
    $("#scan-tries").textContent = t;
    $("#mg-tries").textContent = t;
    $("#scan-cans").textContent = state.data.resources.cans;
    $("#mg-cans").textContent = state.data.resources.cans;
  }

  async function startCamera() {
    stopCamera();
    const constraints = [
      { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: { facingMode: "user" }, audio: false },
      { video: true, audio: false }
    ];
    let stream = null;
    for (const c of constraints) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(c);
        break;
      } catch (_) { /* try next */ }
    }
    if (!stream) {
      toast("无法打开相机，可用「演示猫」试玩");
      $("#flash-panel").hidden = true;
      return;
    }
    state.stream = stream;
    state.track = stream.getVideoTracks()[0] || null;
    const video = $("#scan-video");
    video.srcObject = stream;
    try { await video.play(); } catch (_) {}
    setupTorchUI();
  }

  function stopCamera() {
    if (state.stream) {
      state.stream.getTracks().forEach((t) => t.stop());
    }
    state.stream = null;
    state.track = null;
    state.torchOn = false;
    const video = $("#scan-video");
    video.srcObject = null;
  }

  function setupTorchUI() {
    const panel = $("#flash-panel");
    const caps = state.track && state.track.getCapabilities ? state.track.getCapabilities() : {};
    if (caps.torch) {
      panel.hidden = false;
      $("#flash-toggle").classList.toggle("on", state.torchOn);
    } else {
      panel.hidden = true;
    }
  }

  async function toggleTorch() {
    if (!state.track) return;
    const caps = state.track.getCapabilities ? state.track.getCapabilities() : {};
    if (!caps.torch) return;
    state.torchOn = !state.torchOn;
    try {
      await state.track.applyConstraints({ advanced: [{ torch: state.torchOn }] });
    } catch {
      state.torchOn = false;
    }
    $("#flash-toggle").classList.toggle("on", state.torchOn);
  }

  function closeScan(opts = {}) {
    stopAim();
    stopCamera();
    $("#scan-screen").hidden = true;
    $("#minigame").hidden = true;
    $("#detecting").hidden = true;
    $("#demo-frame").hidden = true;
    state.scanMode = null;
    state.demoPhoto = null;
    if (opts.toast) toast(opts.toast);
    setTab("album");
  }

  function resetCanPosition() {
    const can = $("#can-drag");
    can.style.position = "";
    can.style.left = "";
    can.style.top = "";
    can.style.transform = "";
    can.classList.remove("dragging");
  }

  /* Drag can */
  function setupCanDrag() {
    const can = $("#can-drag");
    let startX = 0, startY = 0, origX = 0, origY = 0;

    const onDown = (e) => {
      if (!$("#minigame").hidden) return;
      e.preventDefault();
      state.dragging = true;
      can.classList.add("dragging");
      const pt = point(e);
      const rect = can.getBoundingClientRect();
      const wrap = $("#can-drag-wrap").getBoundingClientRect();
      can.style.position = "fixed";
      can.style.left = `${rect.left}px`;
      can.style.top = `${rect.top}px`;
      can.style.transform = "none";
      startX = pt.x;
      startY = pt.y;
      origX = rect.left;
      origY = rect.top;
      void wrap;
      if (e.pointerId != null && can.setPointerCapture) {
        try { can.setPointerCapture(e.pointerId); } catch (_) {}
      }
    };

    const onMove = (e) => {
      if (!state.dragging) return;
      e.preventDefault();
      const pt = point(e);
      can.style.left = `${origX + (pt.x - startX)}px`;
      can.style.top = `${origY + (pt.y - startY)}px`;
    };

    const onUp = () => {
      if (!state.dragging) return;
      state.dragging = false;
      can.classList.remove("dragging");
      if (!$("#minigame").hidden || $("#scan-screen").hidden) return;
      // Any release starts the snack alignment minigame
      beginMinigame(state.scanMode === "demo");
    };

    can.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function point(e) {
    if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  }

  /* Demo mode */
  function startDemo() {
    state.scanMode = "demo";
    state.demoPhoto = D.pick(D.DEMO_PHOTOS);
    const img = $("#demo-frame");
    img.src = state.demoPhoto;
    img.hidden = false;
    $("#scan-video").hidden = true;
    $("#scan-hint").textContent = "演示模式 · 拖动罐头对准后松手";
    resetCanPosition();
    // still play minigame on release — user must drag
    toast("演示模式：拖动罐头松手");
  }

  /* Minigame */
  function beginMinigame(fromDemo) {
    if (fromDemo) state.scanMode = "demo";
    $("#minigame").hidden = false;
    $("#mg-tier").textContent = `${D.weightedRarity().id} Tier`;
    updateTriesUI();
    // randomize green zone
    const green = $("#aim-green");
    const width = 18 + Math.floor(Math.random() * 10); // 18-27%
    const left = 15 + Math.floor(Math.random() * (70 - width));
    green.style.width = `${width}%`;
    green.style.left = `${left}%`;
    state.aimPos = 0;
    state.aimDir = 1;
    startAim();
  }

  function startAim() {
    stopAim();
    const marker = $("#aim-marker");
    const speed = 0.55 + Math.random() * 0.35;
    const tick = () => {
      state.aimPos += state.aimDir * speed;
      if (state.aimPos >= 100) { state.aimPos = 100; state.aimDir = -1; }
      if (state.aimPos <= 0) { state.aimPos = 0; state.aimDir = 1; }
      marker.style.left = `${state.aimPos}%`;
      state.aimRaf = requestAnimationFrame(tick);
    };
    state.aimRaf = requestAnimationFrame(tick);

    // tap anywhere on the minigame (except cancel) to throw — easier on phones
    const release = (e) => {
      if (e.target.closest("#mg-cancel, #mg-cancel-x")) return;
      e.preventDefault();
      e.stopPropagation();
      resolveAim();
    };
    $("#minigame").onpointerdown = release;
  }

  function stopAim() {
    if (state.aimRaf) cancelAnimationFrame(state.aimRaf);
    state.aimRaf = null;
  }

  function resolveAim() {
    stopAim();
    const green = $("#aim-green");
    const gLeft = parseFloat(green.style.left);
    const gWidth = parseFloat(green.style.width);
    const hit = state.aimPos >= gLeft && state.aimPos <= gLeft + gWidth;
    if (hit) {
      $("#minigame").hidden = true;
      runDetection();
    } else {
      state.triesLeft -= 1;
      updateTriesUI();
      if (state.triesLeft <= 0) {
        // consume a can, return to album
        state.data.resources.cans = Math.max(0, state.data.resources.cans - 1);
        S.save(state.data);
        closeScan({ toast: "三次都没对准，罐头用掉一罐" });
      } else {
        toast("没对准绿色区域，再试一次");
        // restart aim with new zone
        beginMinigame(state.scanMode === "demo");
      }
    }
  }

  function cancelMinigame() {
    stopAim();
    $("#minigame").hidden = true;
    resetCanPosition();
    if (state.scanMode === "demo") {
      $("#demo-frame").hidden = false;
    }
  }

  /* Detection */
  async function ensureDetector() {
    if (state.detector) return state.detector;
    if (state.detectorLoading) return state.detectorLoading;
    state.detectorLoading = (async () => {
      if (!window.cocoSsd) throw new Error("coco-ssd 未加载");
      state.detector = await cocoSsd.load({ base: "lite_mobilenet_v2" });
      return state.detector;
    })();
    try {
      return await state.detectorLoading;
    } finally {
      state.detectorLoading = null;
    }
  }

  async function runDetection() {
    $("#detecting").hidden = false;
    try {
      let photoDataUrl;
      let found = false;

      if (state.scanMode === "demo") {
        // Demo always succeeds after green hit
        photoDataUrl = await imageToDataUrl(state.demoPhoto || D.DEMO_PHOTOS[0]);
        found = true;
      } else {
        const frame = captureFrame();
        if (!frame) {
          toast("取景失败，请重试或用演示猫");
          $("#detecting").hidden = true;
          resetCanPosition();
          return;
        }
        photoDataUrl = frame;
        try {
          const model = await ensureDetector();
          const img = await loadImage(photoDataUrl);
          const preds = await model.detect(img);
          found = preds.some((p) => p.class === "cat" && p.score >= 0.35);
        } catch (err) {
          console.warn("detection error", err);
          toast("识别模型加载失败，可用演示猫");
          $("#detecting").hidden = true;
          // consume a throw but not can
          state.triesLeft = Math.max(0, state.triesLeft - 1);
          updateTriesUI();
          if (state.triesLeft <= 0) {
            state.data.resources.cans = Math.max(0, state.data.resources.cans - 1);
            S.save(state.data);
            closeScan({ toast: "识别失败，罐头用掉一罐" });
          } else {
            resetCanPosition();
          }
          return;
        }
      }

      $("#detecting").hidden = true;

      if (!found) {
        state.triesLeft = Math.max(0, state.triesLeft - 1);
        updateTriesUI();
        toast("没有识别到猫，换个角度再试");
        if (state.triesLeft <= 0) {
          // Missed detections don't consume can per spec ("do not consume the can (may consume a throw)")
          // but if out of throws, soft return
          closeScan({ toast: "这次没抓到，罐头还在" });
        } else {
          resetCanPosition();
        }
        return;
      }

      // Success — consume 1 can
      state.data.resources.cans = Math.max(0, state.data.resources.cans - 1);
      const serial = state.data.nextSerial++;
      let lat = state.userLat;
      let lng = state.userLng;
      if (lat == null && navigator.geolocation) {
        // best-effort sync from last known; try quick read
        tryGeolocate(false);
        lat = state.userLat;
        lng = state.userLng;
      }
      if ((lat == null || lng == null) && state.scanMode === "demo") {
        const c = state.map ? state.map.getCenter() : { lat: 30.2741, lng: 120.1551 };
        lat = c.lat + (Math.random() - 0.5) * 0.01;
        lng = c.lng + (Math.random() - 0.5) * 0.01;
      }

      const cat = D.generateCat({
        photo: photoDataUrl,
        lat, lng,
        serial,
        demo: state.scanMode === "demo"
      });
      // fix name uniqueness against existing
      const used = state.data.cats.map((c) => c.name);
      if (used.includes(cat.name)) cat.name = D.generateName(used);

      state.data.cats.push(cat);
      state.data.resources.xp += cat.xpGain;
      state.data.resources.coins += cat.coinsGain;
      state.data.todayCount = (state.data.todayCount || 0) + 1;
      S.save(state.data);

      stopCamera();
      $("#scan-screen").hidden = true;
      showFound(cat);
    } catch (err) {
      console.error(err);
      $("#detecting").hidden = true;
      toast("出了点问题，请再试一次");
      resetCanPosition();
    }
  }

  function captureFrame() {
    const video = $("#scan-video");
    if (!video.videoWidth) return null;
    const canvas = $("#scan-canvas");
    const w = video.videoWidth;
    const h = video.videoHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.85);
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async function imageToDataUrl(src) {
    const img = await loadImage(src);
    const canvas = document.createElement("canvas");
    const max = 800;
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (w > max || h > max) {
      const scale = max / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.88);
  }

  /* Found */
  function showFound(cat) {
    state.pendingCat = cat;
    const stars = $("#found-stars");
    stars.innerHTML = "";
    for (let i = 0; i < 12; i++) {
      const s = document.createElement("i");
      s.textContent = "★";
      s.style.left = `${8 + Math.random() * 84}%`;
      s.style.top = `${5 + Math.random() * 45}%`;
      s.style.animationDelay = `${Math.random()}s`;
      s.style.fontSize = `${14 + Math.random() * 14}px`;
      stars.appendChild(s);
    }
    $("#found-photo").src = cat.photo;
    $("#found-name").textContent = cat.name;
    $("#found-xp").textContent = `XP +${cat.xpGain}`;
    $("#found-coins").textContent = `🪙 +${cat.coinsGain}`;
    $("#found-serial").textContent = D.formatSerial(cat.serial);
    $("#found-screen").hidden = false;
  }

  function continueFromFound() {
    const cat = state.pendingCat;
    $("#found-screen").hidden = true;
    if (cat) showCard(cat);
    else setTab("album");
  }

  /* Card */
  function showCard(cat) {
    $("#card-name").textContent = cat.name;
    $("#card-serial").textContent = D.formatSerial(cat.serial);
    $("#card-photo").src = cat.photo;
    $("#card-rarity").textContent = cat.rarity;
    $("#card-type").textContent = `Iconic Cat · ${cat.type}`;
    $("#card-snack").textContent = cat.snack;
    $("#card-charm").textContent = cat.charm;
    $("#card-ability").textContent = cat.ability;

    const kw = $("#card-keywords");
    kw.innerHTML = "";
    for (const k of cat.keywords || []) {
      const chip = document.createElement("div");
      chip.className = "kw-chip";
      chip.innerHTML = `<span class="kw-ico">${k.icon}</span>${escapeHtml(k.name)}`;
      kw.appendChild(chip);
    }

    const detail = $("#keyword-detail");
    detail.innerHTML = `<p style="font-size:11px;font-weight:800;letter-spacing:.08em;color:#999;margin-bottom:8px">KEYWORDS</p>`;
    for (const k of cat.keywords || []) {
      const item = document.createElement("div");
      item.className = "kd-item";
      item.innerHTML = `<strong><span>${k.icon}</span>${escapeHtml(k.name)}</strong><p>${escapeHtml(k.desc)}</p>`;
      detail.appendChild(item);
    }

    $("#card-screen").hidden = false;
  }

  function closeCard() {
    $("#card-screen").hidden = true;
    state.pendingCat = null;
    setTab("album");
    renderAlbum();
    refreshResources();
  }

  /* Wire UI */
  function bind() {
    $$(".nav-item").forEach((btn) => {
      btn.addEventListener("click", () => setTab(btn.dataset.tab));
    });
    $("#btn-scan").addEventListener("click", openScan);
    $("#scan-close").addEventListener("click", () => closeScan());
    $("#demo-btn").addEventListener("click", startDemo);
    $("#flash-toggle").addEventListener("click", toggleTorch);
    $("#mg-cancel").addEventListener("click", cancelMinigame);
    $("#mg-cancel-x").addEventListener("click", cancelMinigame);
    // tapping the minigame sky also tries to "release" when marker is moving — use aim bar primarily
    $("#found-continue").addEventListener("click", continueFromFound);
    $("#found-screen").addEventListener("click", (e) => {
      if (e.target.id === "found-continue" || e.target.closest(".found-card") || e.target.closest(".found-sticker-wrap")) {
        continueFromFound();
      }
    });
    $("#card-close").addEventListener("click", closeCard);
    $("#notice-close").addEventListener("click", () => { $("#map-notice").hidden = true; });
    $("#pin-preview-close").addEventListener("click", () => { $("#pin-preview").hidden = true; });
    $("#map-locate").addEventListener("click", () => tryGeolocate(true));
    setupCanDrag();

  }

  /* Boot */
  function boot() {
    bind();
    refreshResources();
    setTab("album");
    // preload detector quietly in background (optional)
    if (window.cocoSsd) {
      ensureDetector().catch(() => {});
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
