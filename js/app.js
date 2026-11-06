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
    geoStatus: null,
    geoInflight: null,
    mapHasView: false,
    tiles: null,
    crewReady: false,
    crew: { leadId: null, supportIds: [] },
    battle: null,
    markers: [],
    aimRaf: null,
    aimPos: 0,
    aimDir: 1,
    aimFrozen: false,
    missTimer: null,
    pendingRarity: null,
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
      const img = document.createElement("img");
      img.className = "sticker-img";
      img.src = cat.photo;
      img.alt = cat.name;
      applyPhotoStyle(img, cat.stickerStyle);
      const label = document.createElement("span");
      label.className = "sticker-label";
      label.innerHTML = `<span>${escapeHtml(cat.name)}</span><i class="paw">🐾</i>`;
      btn.append(img, label);
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
    if (tab !== "battle") stopFightAim();
    state.tab = tab;
    $$(".tab-panel").forEach((p) => { p.hidden = true; });
    $(`#tab-${tab}`).hidden = false;
    $$(".nav-item").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === tab);
    });
    if (tab === "album") renderAlbum();
    if (tab === "profile") renderProfile();
    if (tab === "map") ensureMap();
    if (tab === "battle") renderBattle();
    refreshResources();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function applyPhotoStyle(img, style) {
    if (!style) {
      img.style.objectPosition = "";
      img.style.filter = "";
      img.style.transform = "";
      return;
    }
    img.style.objectPosition = style.objectPosition || "center";
    img.style.filter = style.filter || "";
    img.style.transform = style.rotate ? `rotate(${style.rotate})` : "";
  }

  function isCoaching() {
    const n = state.data.lifetimeMinigames || 0;
    return n > 0 && n <= 3;
  }

  function clearMissTimer() {
    if (state.missTimer) {
      clearTimeout(state.missTimer);
      state.missTimer = null;
    }
    state.aimFrozen = false;
    const marker = $("#aim-marker");
    if (marker) marker.classList.remove("frozen");
  }

  /* ---------- Map ---------- */
  function ensureMap() {
    if (!state.mapReady) {
      state.map = L.map("map", {
        zoomControl: false,
        attributionControl: true
      });
      state.mapReady = true;
    }
    if (state.userLat != null && state.userLng != null) {
      if (!state.mapHasView) focusMapOnUser();
      else setTimeout(() => state.map && state.map.invalidateSize(), 80);
      refreshMapPins();
    } else {
      clearPins();
      tryGeolocate(true);
    }
  }

  function ensureTiles() {
    if (!state.map || state.tiles) return;
    state.tiles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap"
    }).addTo(state.map);
  }

  function focusMapOnUser() {
    if (!state.map || state.userLat == null || state.userLng == null) return;
    state.map.setView([state.userLat, state.userLng], 15);
    state.mapHasView = true;
    ensureTiles();
    setTimeout(() => state.map && state.map.invalidateSize(), 80);
  }

  function tryGeolocate(center, opts = {}) {
    if (!opts.fresh && state.userLat != null && state.userLng != null) {
      if (center) focusMapOnUser();
      if (state.mapHasView) refreshMapPins();
      return Promise.resolve(true);
    }
    if (!navigator.geolocation) {
      state.geoStatus = "unsupported";
      toast("需要定位才能把地图放到你附近");
      return Promise.resolve(false);
    }
    if (state.geoInflight) {
      return state.geoInflight.then((ok) => {
        if (ok && center) focusMapOnUser();
        if (ok && state.mapHasView) refreshMapPins();
        return ok;
      });
    }
    state.geoStatus = "pending";
    state.geoInflight = new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          state.userLat = pos.coords.latitude;
          state.userLng = pos.coords.longitude;
          state.geoStatus = "ok";
          state.geoInflight = null;
          if (center || (state.map && !state.mapHasView)) focusMapOnUser();
          if (state.mapHasView) refreshMapPins();
          resolve(true);
        },
        () => {
          state.geoStatus = "denied";
          state.geoInflight = null;
          toast("需要定位才能把地图放到你附近");
          resolve(false);
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: opts.fresh ? 0 : 60000 }
      );
    });
    return state.geoInflight;
  }

  function clearPins() {
    state.markers.forEach((m) => m.remove());
    state.markers = [];
  }

  function pinOffset(id) {
    let h = 2166136261;
    const str = String(id || "");
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const u = (h >>> 0) / 4294967295;
    const v = ((h >>> 8) & 0xffff) / 65535;
    return { lat: (u - 0.5) * 0.012, lng: (v - 0.5) * 0.012 };
  }

  function refreshMapPins() {
    if (!state.map || !state.mapHasView || state.userLat == null || state.userLng == null) return;
    clearPins();
    const baseLat = state.userLat;
    const baseLng = state.userLng;
    const origin = D.SAMPLE_SIGHTINGS[0];
    if (origin) {
      for (const s of D.SAMPLE_SIGHTINGS) {
        addPin(
          baseLat + (s.lat - origin.lat),
          baseLng + (s.lng - origin.lng),
          s.photo,
          s.name,
          "社区记录 · 示例",
          true
        );
      }
    }
    for (const cat of state.data.cats) {
      let lat = cat.lat;
      let lng = cat.lng;
      if (lat == null || lng == null) {
        const shift = pinOffset(cat.id);
        lat = baseLat + shift.lat;
        lng = baseLng + shift.lng;
      }
      addPin(lat, lng, cat.photo, cat.name, `${cat.rarity} · ${D.formatSerial(cat.serial)}`, false, cat);
    }
  }

  async function captureCoords() {
    if (state.userLat == null || state.userLng == null) {
      const pending = state.geoInflight
        || (state.geoStatus === "denied" || state.geoStatus === "unsupported"
          ? null
          : tryGeolocate(false));
      if (pending) {
        await Promise.race([
          pending,
          new Promise((resolve) => setTimeout(resolve, 1500))
        ]);
      }
    }
    if (state.userLat != null && state.userLng != null) {
      return { lat: state.userLat, lng: state.userLng };
    }
    if (state.geoStatus === "ok" && state.map && state.mapHasView) {
      const c = state.map.getCenter();
      return { lat: c.lat, lng: c.lng };
    }
    return { lat: null, lng: null };
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
    $("#scan-hint").textContent = "点一下或拖动罐头，开始瞄准";
    resetCanPosition();
    tryGeolocate(false);
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
    clearMissTimer();
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
    $("#scan-hint").textContent = "演示模式 · 点一下或拖动罐头，开始瞄准";
    resetCanPosition();
    toast("演示模式：点一下或拖动罐头");
  }

  /* Minigame */
  function beginMinigame(fromDemo, opts = {}) {
    if (fromDemo) state.scanMode = "demo";
    clearMissTimer();
    if (!opts.continueRound) {
      state.data.lifetimeMinigames = (state.data.lifetimeMinigames || 0) + 1;
      state.pendingRarity = D.weightedRarity().id;
      S.save(state.data);
    } else if (!state.pendingRarity) {
      state.pendingRarity = D.weightedRarity().id;
    }
    $("#minigame").hidden = false;
    $("#mg-tier").textContent = `${state.pendingRarity} Tier`;
    const coaching = isCoaching();
    $("#mg-release").textContent = coaching
      ? "橙色准星进绿色时，点屏幕"
      : "准星进入绿色时点屏幕";
    updateTriesUI();
    const green = $("#aim-green");
    const width = 18 + Math.floor(Math.random() * 10); // 18-27%
    const left = 15 + Math.floor(Math.random() * (70 - width));
    green.style.width = `${width}%`;
    green.style.left = `${left}%`;
    green.classList.toggle("coach", coaching);
    state.aimPos = 0;
    state.aimDir = 1;
    const marker = $("#aim-marker");
    if (marker) marker.style.left = "0%";
    startAim();
  }

  function startAim() {
    stopAim();
    const marker = $("#aim-marker");
    marker.classList.remove("frozen");
    const speed = isCoaching()
      ? 0.35 + Math.random() * 0.20
      : 0.55 + Math.random() * 0.35;
    const tick = () => {
      state.aimPos += state.aimDir * speed;
      if (state.aimPos >= 100) { state.aimPos = 100; state.aimDir = -1; }
      if (state.aimPos <= 0) { state.aimPos = 0; state.aimDir = 1; }
      marker.style.left = `${state.aimPos}%`;
      state.aimRaf = requestAnimationFrame(tick);
    };
    state.aimRaf = requestAnimationFrame(tick);

    // Tap anywhere on the minigame (except cancel) to throw.
    const release = (e) => {
      if (state.aimFrozen) return;
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
    if (state.aimFrozen) return;
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
      const lastMiss = state.triesLeft <= 0;
      state.aimFrozen = true;
      const marker = $("#aim-marker");
      marker.classList.add("frozen");
      if (!lastMiss) toast("没对准绿色区域，再试一次");
      state.missTimer = setTimeout(() => {
        state.missTimer = null;
        state.aimFrozen = false;
        marker.classList.remove("frozen");
        if ($("#scan-screen").hidden) return;
        if (lastMiss) {
          finishMissRound();
        } else if (!$("#minigame").hidden) {
          beginMinigame(state.scanMode === "demo", { continueRound: true });
        }
      }, 400);
    }
  }

  function finishMissRound() {
    const used = state.data.freeMissRounds || 0;
    let msg;
    if (used < 10) {
      state.data.freeMissRounds = used + 1;
      msg = "三次都没对准，罐头还在";
    } else {
      state.data.resources.cans = Math.max(0, state.data.resources.cans - 1);
      msg = "三次都没对准，罐头用掉一罐";
    }
    S.save(state.data);
    closeScan({ toast: msg });
  }

  function cancelMinigame() {
    if (state.aimFrozen && state.triesLeft <= 0) return;
    clearMissTimer();
    stopAim();
    $("#minigame").hidden = true;
    const green = $("#aim-green");
    if (green) green.classList.remove("coach");
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
      const where = await captureCoords();
      const lat = where.lat;
      const lng = where.lng;

      const used = state.data.cats.map((c) => c.name);
      const cat = D.generateCat({
        photo: photoDataUrl,
        lat, lng,
        serial,
        demo: state.scanMode === "demo",
        usedNames: used,
        rarity: state.pendingRarity
      });
      // Backup if the rolled name still collides.
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
    applyPhotoStyle($("#found-photo"), cat.stickerStyle);
    $("#found-name").textContent = cat.name;
    $("#found-xp").textContent = `XP +${cat.xpGain}`;
    $("#found-coins").textContent = `🪙 +${cat.coinsGain}`;
    $("#found-serial").textContent = D.formatSerial(cat.serial);
    $("#found-screen").hidden = false;
  }

  function continueFromFound() {
    const cat = state.pendingCat;
    const firstCatch = state.data.cats.length === 1;
    $("#found-screen").hidden = true;
    if (cat) showCard(cat, { coach: firstCatch });
    else setTab("album");
  }

  /* Card */
  function showCard(cat, opts = {}) {
    const coach = $("#card-coach");
    if (coach) {
      coach.hidden = !opts.coach;
      if (opts.coach) coach.textContent = "这是你的猫卡。";
    }
    $("#card-name").textContent = cat.name;
    $("#card-serial").textContent = D.formatSerial(cat.serial);
    $("#card-photo").src = cat.photo;
    applyPhotoStyle($("#card-photo"), cat.stickerStyle);
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
    const coach = $("#card-coach");
    if (coach) coach.hidden = true;
    state.pendingCat = null;
    setTab("album");
    renderAlbum();
    refreshResources();
  }

  /* ---------- Alley Clash (training only) ---------- */
  function findCat(id) {
    return state.data.cats.find((c) => c.id === id) || null;
  }

  function ensureCrew() {
    const leadOk = state.crewReady && findCat(state.crew.leadId);
    if (leadOk) return;
    const picks = D.defaultCrew(state.data.cats);
    state.crew = {
      leadId: picks.lead ? picks.lead.id : null,
      supportIds: picks.supports.map((c) => c.id)
    };
    state.crewReady = !!picks.lead;
  }

  function toggleCrewCat(id) {
    const crew = state.crew;
    if (crew.leadId === id) {
      crew.leadId = crew.supportIds.shift() || null;
      return;
    }
    const idx = crew.supportIds.indexOf(id);
    if (idx >= 0) {
      crew.supportIds.splice(idx, 1);
      return;
    }
    if (!crew.leadId) crew.leadId = id;
    else if (crew.supportIds.length < 2) crew.supportIds.push(id);
    else crew.supportIds[1] = id;
  }

  function paintSetup() {
    ensureCrew();
    const lead = findCat(state.crew.leadId);
    const supports = state.crew.supportIds.map(findCat).filter(Boolean);
    const slots = $("#crew-slots");
    slots.innerHTML = "";
    const rows = [["领队", lead], ["支援", supports[0] || null], ["支援", supports[1] || null]];
    for (const [role, cat] of rows) {
      const el = document.createElement("div");
      el.className = "crew-slot" + (cat ? "" : " vacant");
      if (!cat) {
        el.innerHTML = `<span class="slot-role">${role}</span><em>空</em>`;
      } else {
        const kws = (cat.keywords || []).map((k) => k.name).join(" · ");
        el.innerHTML = `
          <img alt="" />
          <div>
            <span class="slot-role">${role}</span>
            <strong></strong>
            <small class="slot-stats"></small>
            <small class="slot-kws"></small>
          </div>`;
        const img = el.querySelector("img");
        img.src = cat.photo;
        img.alt = cat.name;
        applyPhotoStyle(img, cat.stickerStyle);
        el.querySelector("strong").textContent = cat.name;
        el.querySelector(".slot-stats").textContent = `${cat.rarity} · SNACK ${cat.snack} · CHARM ${cat.charm}`;
        el.querySelector(".slot-kws").textContent = kws;
      }
      slots.appendChild(el);
    }
    const picker = $("#crew-picker");
    picker.innerHTML = "";
    for (const cat of [...state.data.cats].reverse()) {
      const btn = document.createElement("button");
      btn.type = "button";
      const on = cat.id === state.crew.leadId || state.crew.supportIds.includes(cat.id);
      btn.className = "pick-cat" + (on ? " on" : "");
      btn.innerHTML = `<img alt="" /><span></span>`;
      const img = btn.querySelector("img");
      img.src = cat.photo;
      img.alt = cat.name;
      applyPhotoStyle(img, cat.stickerStyle);
      btn.querySelector("span").textContent = cat.name;
      btn.addEventListener("click", () => {
        toggleCrewCat(cat.id);
        paintSetup();
      });
      picker.appendChild(btn);
    }
    const start = $("#battle-start");
    if (start) start.disabled = !lead;
  }

  function renderBattle() {
    const empty = state.data.cats.length === 0;
    $("#battle-empty").hidden = !empty;
    if (empty) {
      stopFightAim();
      state.battle = null;
      state.crewReady = false;
      $("#battle-setup").hidden = true;
      $("#battle-fight").hidden = true;
      $("#battle-result").hidden = true;
      return;
    }
    if (!state.battle) {
      $("#battle-fight").hidden = true;
      $("#battle-result").hidden = true;
      $("#battle-setup").hidden = false;
      const last = state.data.lastBattle;
      $("#battle-sub").textContent = last
        ? `上场${last.win ? "胜利" : "失利"} · 训练对手 ${last.crew}`
        : "训练对手 · 猫会留在图鉴里";
      paintSetup();
      return;
    }
    $("#battle-setup").hidden = true;
    if (state.battle.phase === "result") {
      $("#battle-fight").hidden = true;
      $("#battle-result").hidden = false;
      return;
    }
    $("#battle-result").hidden = true;
    $("#battle-fight").hidden = false;
    paintHp();
    if (state.battle.phase === "aim" && state.tab === "battle") startFightAim();
    else if (state.battle.phase === "skills") showSkills();
    else if (state.battle.phase === "rival" && !state.battle.timer) rivalTurn();
  }

  function stopFightAim() {
    const b = state.battle;
    if (!b) return;
    if (b.raf) cancelAnimationFrame(b.raf);
    b.raf = null;
    if (b.timer) clearTimeout(b.timer);
    b.timer = null;
    const bar = $("#fight-bar");
    if (bar) bar.onpointerdown = null;
  }

  function fightLog(line) {
    if (!state.battle) return;
    const el = $("#fight-log");
    if (!el) return;
    const p = document.createElement("p");
    p.textContent = line;
    el.appendChild(p);
    while (el.children.length > 6) el.removeChild(el.firstChild);
    el.scrollTop = el.scrollHeight;
  }

  function paintHp() {
    const b = state.battle;
    if (!b) return;
    $("#fight-you-name").textContent = b.player.lead.name;
    $("#fight-foe-name").textContent = "训练对手";
    $("#fight-you-num").textContent = `${b.player.hp}/${b.player.max}`;
    $("#fight-foe-num").textContent = `${b.rival.hp}/${b.rival.max}`;
    $("#fight-you-hp").style.width = `${Math.max(0, Math.round((b.player.hp / b.player.max) * 100))}%`;
    $("#fight-foe-hp").style.width = `${Math.max(0, Math.round((b.rival.hp / b.rival.max) * 100))}%`;
  }

  function describeHit(who, result) {
    if (result.notes.includes("Guard")) return `${who}的攻击被 Guard 挡住了`;
    const verb = result.hit ? "命中" : "擦到了";
    let line = `${who} ${verb}，造成 ${result.dmg} 点伤害`;
    if (result.notes.includes("Loaf")) line = `${who} 打在 Loaf 上，造成 ${result.dmg} 点伤害`;
    if (result.extra && result.extra.dmg) line += `，终局一击再造成 ${result.extra.dmg}`;
    return line;
  }

  function checkKo() {
    const b = state.battle;
    if (!b || b.phase === "result") return true;
    if (b.rival.hp <= 0) { endBattle(true); return true; }
    if (b.player.hp <= 0) { endBattle(false); return true; }
    return false;
  }

  function endBattle(playerWon) {
    const b = state.battle;
    if (!b || b.phase === "result") return;
    b.phase = "result";
    stopFightAim();
    const xp = playerWon ? 36 : 12;
    const coins = playerWon ? 8 : 2;
    state.data.resources.xp += xp;
    state.data.resources.coins += coins;
    state.data.lastBattle = { win: !!playerWon, crew: b.crewName, at: Date.now(), xp, coins };
    S.save(state.data);
    refreshResources();
    $("#battle-fight").hidden = true;
    $("#battle-result").hidden = false;
    $("#battle-result-title").textContent = playerWon ? "巷战胜利" : "巷战失利";
    $("#battle-result-reward").textContent = `XP +${xp} · 🪙 +${coins}`;
  }

  function startBattle() {
    const lead = findCat(state.crew.leadId);
    if (!lead) {
      toast("先选一只领队");
      return;
    }
    const supports = state.crew.supportIds.map(findCat).filter(Boolean).slice(0, 2);
    const albumSize = state.data.cats.length;
    const match = D.createTrainingMatch(state.data.cats, { lead, supports });
    if (state.data.cats.length !== albumSize) {
      state.data.cats.length = albumSize;
    }
    state.battle = {
      phase: "aim",
      turn: 0,
      crewName: match.crewName,
      player: match.player,
      rival: match.rival,
      raf: null,
      timer: null,
      pos: 0,
      dir: 1,
      resolving: false
    };
    $("#battle-setup").hidden = true;
    $("#battle-result").hidden = true;
    $("#battle-fight").hidden = false;
    $("#fight-log").innerHTML = "";
    $("#battle-sub").textContent = `训练对手 · ${match.crewName}`;
    fightLog(`巷战开始。训练对手 ${match.crewName}`);
    paintHp();
    beginPlayerTurn();
  }

  function beginPlayerTurn() {
    const b = state.battle;
    if (!b || b.phase === "result") return;
    b.turn += 1;
    if (b.turn > 10) {
      fightLog("时间到，血量更高的一方获胜");
      endBattle(b.player.hp >= b.rival.hp);
      return;
    }
    if (b.player.skipNext) {
      b.player.skipNext = false;
      fightLog("你这一拍在打盹");
      rivalTurn();
      return;
    }
    b.phase = "aim";
    b.resolving = false;
    const prompt = $("#fight-prompt");
    if (prompt) prompt.textContent = "准星进入绿色时点屏幕";
    if (state.tab === "battle") startFightAim();
  }

  function startFightAim() {
    const b = state.battle;
    if (!b || b.phase !== "aim" || state.tab !== "battle") return;
    if (b.raf) cancelAnimationFrame(b.raf);
    b.raf = null;
    $("#fight-aim").hidden = false;
    $("#fight-skills").hidden = true;
    const green = $("#fight-green");
    const width = 18 + Math.floor(Math.random() * 10);
    const left = 15 + Math.floor(Math.random() * Math.max(1, 70 - width));
    green.style.width = `${width}%`;
    green.style.left = `${left}%`;
    b.pos = 0;
    b.dir = 1;
    b.resolving = false;
    const speed = 0.48 + Math.random() * 0.22;
    const marker = $("#fight-marker");
    const tick = () => {
      if (!state.battle || state.battle !== b || b.phase !== "aim") return;
      b.pos += b.dir * speed;
      if (b.pos >= 100) { b.pos = 100; b.dir = -1; }
      if (b.pos <= 0) { b.pos = 0; b.dir = 1; }
      marker.style.left = `${b.pos}%`;
      b.raf = requestAnimationFrame(tick);
    };
    b.raf = requestAnimationFrame(tick);
    const bar = $("#fight-bar");
    bar.onpointerdown = (e) => {
      e.preventDefault();
      resolveFightAim();
    };
  }

  function resolveFightAim() {
    const b = state.battle;
    if (!b || b.phase !== "aim" || b.resolving) return;
    b.resolving = true;
    if (b.raf) cancelAnimationFrame(b.raf);
    b.raf = null;
    const green = $("#fight-green");
    const gLeft = parseFloat(green.style.left);
    const gWidth = parseFloat(green.style.width);
    const hit = b.pos >= gLeft && b.pos <= gLeft + gWidth;
    const result = D.launch(b.player, b.rival, hit);
    fightLog(describeHit(b.player.lead.name, result));
    paintHp();
    if (checkKo()) return;
    const offer = (hit || b.turn % 2 === 0) && b.player.keywordsLeft.length > 0;
    if (offer) showSkills();
    else rivalTurn();
  }

  function showSkills() {
    const b = state.battle;
    if (!b || b.phase === "result") return;
    b.phase = "skills";
    if (b.raf) cancelAnimationFrame(b.raf);
    b.raf = null;
    $("#fight-aim").hidden = true;
    $("#fight-skills").hidden = false;
    const row = $("#skill-row");
    row.innerHTML = "";
    for (const name of b.player.keywordsLeft.slice(0, 2)) {
      const meta = D.KEYWORDS.find((k) => k.name === name);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "skill-btn";
      const title = document.createElement("span");
      title.textContent = `${meta ? meta.icon : "✨"} ${name}`;
      const detail = document.createElement("small");
      detail.textContent = meta ? meta.desc : "";
      btn.append(title, detail);
      btn.addEventListener("click", () => useSkill(name));
      row.appendChild(btn);
    }
  }

  function useSkill(name) {
    const b = state.battle;
    if (!b || b.phase !== "skills") return;
    const effect = D.playKeyword(b.player, b.rival, name);
    fightLog(effect.log);
    paintHp();
    if (checkKo()) return;
    rivalTurn();
  }

  function rivalTurn() {
    const b = state.battle;
    if (!b || b.phase === "result") return;
    b.phase = "rival";
    $("#fight-aim").hidden = true;
    $("#fight-skills").hidden = true;
    if (b.timer) clearTimeout(b.timer);
    b.timer = setTimeout(() => {
      b.timer = null;
      if (!state.battle || state.battle !== b || b.phase === "result") return;
      if (b.rival.skipNext) {
        b.rival.skipNext = false;
        fightLog("训练对手的反击被跳过了");
        beginPlayerTurn();
        return;
      }
      const options = b.rival.keywordsLeft.filter((name) => name !== "Copycat" || b.player.lastKeyword);
      const pre = ["Finale", "Purrfect", "Zoomies"];
      let chosen = null;
      if (options.length && Math.random() < 0.5) chosen = options[0];
      if (chosen && pre.includes(chosen)) {
        const effect = D.playKeyword(b.rival, b.player, chosen);
        fightLog(`训练对手 ${effect.log}`);
        paintHp();
        if (checkKo()) return;
        chosen = null;
      }
      const hit = Math.random() < (b.rival.hitChance == null ? 0.62 : b.rival.hitChance);
      const result = D.launch(b.rival, b.player, hit);
      fightLog(describeHit("训练对手", result));
      paintHp();
      if (checkKo()) return;
      if (chosen) {
        const effect = D.playKeyword(b.rival, b.player, chosen);
        fightLog(`训练对手 ${effect.log}`);
        paintHp();
        if (checkKo()) return;
      }
      beginPlayerTurn();
    }, 520);
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
    $("#map-locate").addEventListener("click", () => tryGeolocate(true, { fresh: true }));
    $("#battle-go-scan").addEventListener("click", openScan);
    $("#battle-start").addEventListener("click", startBattle);
    $("#fight-tap").addEventListener("click", resolveFightAim);
    $("#fight-skip").addEventListener("click", () => {
      if (state.battle && state.battle.phase === "skills") rivalTurn();
    });
    $("#battle-again").addEventListener("click", () => {
      stopFightAim();
      state.battle = null;
      renderBattle();
    });
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
