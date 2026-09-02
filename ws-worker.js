(() => {
"use strict";

if(window.__wsWorkerActive) return;
window.__wsWorkerActive = true;

const WS_BASE_URL = "wss://api.inout.games/io/";
const DEFAULT_OPERATOR_ID = "ee2013ed-e1f0-4d6e-97d2-f36619e2eb52";
const WS_SETTINGS_KEY = "ws-worker-settings-v1";
const DEFAULT_WS_AUTH = {
  double: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJkNTA0NzcxOC1mMzhhLTRkNWItYWRhNC1iODJkNWMxNzg1ZjAiLCJuaWNrbmFtZSI6IkN5YW4gU2VsZWN0ZWQgU3RvYXQiLCJiYWxhbmNlIjoiMTAwMDAwMCIsImN1cnJlbmN5IjoiVVNEIiwib3BlcmF0b3IiOiJlZTIwMTNlZC1lMWYwLTRkNmUtOTdkMi1mMzY2MTllMmViNTIiLCJvcGVyYXRvcklkIjoiZWUyMDEzZWQtZTFmMC00ZDZlLTk3ZDItZjM2NjE5ZTJlYjUyIiwiZ2FtZU1vZGUiOiJuZXctZG91YmxlIiwibWV0YSI6bnVsbCwiZ2FtZUF2YXRhciI6bnVsbCwic2Vzc2lvblRva2VuIjoianNwODF6IiwiaWF0IjoxNzg3NjYzODcxLCJleHAiOjE3ODc3NTAyNzF9.NvWzk0HRZuAXtuZdB94tLCXo79FoXLJ1dAn4ii-v2WM",
  wheel: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJkNTA0NzcxOC1mMzhhLTRkNWItYWRhNC1iODJkNWMxNzg1ZjAiLCJuaWNrbmFtZSI6IkN5YW4gU2VsZWN0ZWQgU3RvYXQiLCJiYWxhbmNlIjoiMTAwMDAwMCIsImN1cnJlbmN5IjoiVVNEIiwib3BlcmF0b3IiOiJlZTIwMTNlZC1lMWYwLTRkNmUtOTdkMi1mMzY2MTllMmViNTIiLCJvcGVyYXRvcklkIjoiZWUyMDEzZWQtZTFmMC00ZDZlLTk3ZDItZjM2NjE5ZTJlYjUyIiwiZ2FtZU1vZGUiOiJ3aGVlbCIsIm1ldGEiOm51bGwsImdhbWVBdmF0YXIiOm51bGwsInNlc3Npb25Ub2tlbiI6ImpzcDgxeiIsImlhdCI6MTc4NzY5NzU0OCwiZXhwIjoxNzg3NzgzOTQ4fQ.FnNpjEDuLObvq8gfVc-jI1_pz4qO4FusSOESz-EDhJQ"
};

const MAX_RESULTS = 500;
const DUPLICATE_WINDOW_MS = 15000;

const KEYS = {
  double: "historico-double-v1",
  wheel: "historico-wheel-v1"
};

function getWsSettings(){
  try{
    const settings = JSON.parse(localStorage.getItem(WS_SETTINGS_KEY) || "null");
    return settings && typeof settings === "object" ? settings : {};
  }catch{
    return {};
  }
}

function getConfiguredWsUrl(label, gameMode){
  const settings = getWsSettings();
  const directUrl = settings[label + "Url"] || localStorage.getItem("ws-" + label + "-url");
  if(directUrl) return String(directUrl).replace(/&amp;/g, "&");

  let authorization =
    settings[label + "Authorization"] ||
    settings.authorization ||
    localStorage.getItem("ws-" + label + "-authorization") ||
    localStorage.getItem("ws-authorization") ||
    DEFAULT_WS_AUTH[label];
  if(!authorization) return "";
  authorization = String(authorization).trim();
  if(authorization.startsWith("wss://")) return authorization.replace(/&amp;/g, "&");
  if(authorization.includes("Authorization=")){
    try{
      const qs = authorization.includes("?") ? authorization.split("?").slice(1).join("?") : authorization;
      authorization = new URLSearchParams(qs.replace(/&amp;/g, "&")).get("Authorization") || authorization;
    }catch{}
  }

  const params = new URLSearchParams({
    operatorId: settings.operatorId || localStorage.getItem("ws-operator-id") || DEFAULT_OPERATOR_ID,
    Authorization: authorization,
    gameMode,
    EIO: "4",
    transport: "websocket"
  });
  return WS_BASE_URL + "?" + params.toString();
}

function normalizeDouble(item){
  if(!item || typeof item !== "object") return null;
  const number = Number(
    item.number ??
    item.cellIndex ??
    item.roll ??
    item.value ??
    item.winningNumber ??
    item.resultNumber ??
    item.drawNumber
  );
  let color = String(
    item.color ??
    item.cellColor ??
    item.winningColor ??
    item.resultColor ??
    item.winnerColor ??
    item.selectedColor ??
    item.winner ??
    ""
  ).toLowerCase();
  color = color.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const aliases = {
    vermelho: "red",
    red: "red",
    r: "red",
    preto: "black",
    black: "black",
    b: "black",
    branco: "green",
    white: "green",
    green: "green",
    g: "green"
  };
  color = aliases[color] || color;
  if(!Number.isFinite(number)) return null;
  if(!["red","black","green"].includes(color)){
    if(number === 0) color = "green";
    else if(number >= 1 && number <= 7) color = "red";
    else if(number >= 8 && number <= 14) color = "black";
    else return null;
  }
  const normalized = {number,color};
  const roundId =
    item.roundId ??
    item.roundID ??
    item.roundUuid ??
    item.roundUUID ??
    item.gameId ??
    item.gameID ??
    item.id ??
    item.uuid;
  if(roundId !== undefined && roundId !== null) normalized.roundId = String(roundId);
  return normalized;
}

function looksLikeDoubleResult(item){
  if(!item || typeof item !== "object") return false;
  const hasNumber =
    item.number !== undefined ||
    item.cellIndex !== undefined ||
    item.roll !== undefined ||
    item.value !== undefined ||
    item.winningNumber !== undefined ||
    item.resultNumber !== undefined ||
    item.drawNumber !== undefined;
  const hasColor =
    item.color !== undefined ||
    item.cellColor !== undefined ||
    item.winningColor !== undefined ||
    item.resultColor !== undefined ||
    item.winnerColor !== undefined ||
    item.selectedColor !== undefined ||
    item.winner !== undefined;
  return hasNumber && (hasColor || Number(item.number ?? item.cellIndex ?? item.roll ?? item.value) === 0);
}

function looksLikeWheelResult(item){
  if(!item || typeof item !== "object") return false;
  const hasCellIndex =
    item.cellIndex !== undefined ||
    item.index !== undefined ||
    item.number !== undefined ||
    item.resultNumber !== undefined ||
    item.winningNumber !== undefined ||
    item.value !== undefined;
  const hasColor =
    item.cellColor !== undefined ||
    item.color !== undefined ||
    item.resultColor !== undefined ||
    item.winningColor !== undefined ||
    item.winnerColor !== undefined;
  const hasMultiplier =
    item.multiplier !== undefined ||
    item.cellMultiplier !== undefined ||
    item.resultMultiplier !== undefined ||
    item.winningMultiplier !== undefined;
  return hasCellIndex && (hasColor || hasMultiplier);
}

function normalizeWheel(item){
  if(!item || typeof item !== "object") return null;
  const cellIndex = Number(
    item.cellIndex ??
    item.index ??
    item.number ??
    item.resultNumber ??
    item.winningNumber ??
    item.value
  );
  const multiplierRaw =
    item.multiplier ??
    item.cellMultiplier ??
    item.resultMultiplier ??
    item.winningMultiplier;
  const multiplierText = multiplierRaw === undefined || multiplierRaw === null ? "" : String(multiplierRaw).trim();
  const multiplier = multiplierText ? Number(multiplierText.replace(/x/i, "")) : NaN;
  let cellColor = String(
    item.cellColor ??
    item.color ??
    item.resultColor ??
    item.winningColor ??
    item.winnerColor ??
    ""
  ).toLowerCase();
  cellColor = cellColor.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const aliases = {
    black: "black",
    gray: "black",
    grey: "black",
    preto: "black",
    red: "red",
    vermelho: "red",
    blue: "blue",
    azul: "blue",
    green: "green",
    verde: "green"
  };
  cellColor = aliases[cellColor] || cellColor;
  if(!Number.isFinite(cellIndex)) return null;
  if(!["red","blue","green","black"].includes(cellColor)){
    if(multiplier === 2) cellColor = "black";
    else if(multiplier === 3) cellColor = "red";
    else if(multiplier === 5) cellColor = "blue";
    else if(multiplier === 50) cellColor = "green";
    else return null;
  }
  const normalized = {cellIndex, cellColor};
  if(Number.isFinite(multiplier)) normalized.multiplier = multiplier;
  const roundId =
    item.roundId ??
    item.roundID ??
    item.roundUuid ??
    item.roundUUID ??
    item.gameId ??
    item.gameID ??
    item.id ??
    item.uuid;
  if(roundId !== undefined && roundId !== null) normalized.roundId = String(roundId);
  return normalized;
}

function resultKeyDouble(r){ return `${r.number}:${r.color}`; }
function resultKeyWheel(r){ return `${r.cellIndex}:${r.cellColor}`; }
function stableKeyDouble(r){ return r && r.roundId ? "round:" + r.roundId : ""; }
function stableKeyWheel(r){ return r && r.roundId ? "round:" + r.roundId : ""; }

function createStorageId(){
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

function loadHistory(key){
  try{
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    if(Array.isArray(saved) && saved.length) return saved;
  }catch{}
  return [];
}

function saveHistory(key, data){
  try{
    const seenRounds = new Set();
    const saved = [];
    const stableKeyFn = key === KEYS.wheel ? stableKeyWheel : stableKeyDouble;
    for(const item of data){
      const stable = stableKeyFn(item);
      if(stable){
        if(seenRounds.has(stable)) continue;
        seenRounds.add(stable);
      }
      saved.push(item);
    }
    localStorage.setItem(key, JSON.stringify(saved.slice(0, MAX_RESULTS)));
  }catch{}
}

function isImmediateDuplicate(previous, item, keyFn, stableKeyFn){
  if(!previous || !item) return false;
  const stablePrevious = stableKeyFn(previous);
  const stableItem = stableKeyFn(item);
  if(stablePrevious && stableItem) return stablePrevious === stableItem;
  const previousTime = Number(previous.time || 0);
  const itemTime = Number(item.time || Date.now());
  return keyFn(previous) === keyFn(item) &&
    previousTime > 0 &&
    Math.abs(itemTime - previousTime) < DUPLICATE_WINDOW_MS;
}

function syncFromServer(key, items, normalizeFn, keyFn, stableKeyFn){
  if(!Array.isArray(items) || !items.length) return false;
  const parsed = items.map(normalizeFn).filter(Boolean).map(item => ({...item, time: item.time || Date.now(), storageId: item.roundId ? item.storageId : (item.storageId || createStorageId())}));
  if(!parsed.length) return false;

  let current = loadHistory(key);
  let added = false;

  for(const item of parsed){
    if(isImmediateDuplicate(current[0], item, keyFn, stableKeyFn)) continue;
    let exists = false;
    for(let i=0;i<Math.min(current.length,20);i++){
      const stableCurrent = stableKeyFn(current[i]);
      const stableItem = stableKeyFn(item);
      if(stableCurrent && stableItem && stableCurrent === stableItem){exists=true;break;}
    }
    if(!exists){
      current.unshift(item);
      added = true;
    }
  }

  if(added){
    current = current.slice(0, MAX_RESULTS);
    saveHistory(key, current);
    return true;
  }
  return false;
}

function sameSnapshotItem(a, b, keyFn, stableKeyFn){
  const stableA = stableKeyFn(a);
  const stableB = stableKeyFn(b);
  if(stableA && stableB) return stableA === stableB;
  return keyFn(a) === keyFn(b);
}

function findSnapshotOverlap(parsed, current, keyFn, stableKeyFn){
  const max = Math.min(parsed.length, current.length);
  for(let size = max; size > 0; size--){
    let matches = true;
    for(let i = 0; i < size; i++){
      if(!sameSnapshotItem(parsed[parsed.length - size + i], current[i], keyFn, stableKeyFn)){
        matches = false;
        break;
      }
    }
    if(matches) return size;
  }
  return 0;
}

function syncSnapshotFromServer(storageKey, items, normalizeFn, keyFn, stableKeyFn){
  if(!Array.isArray(items) || !items.length) return false;
  const parsed = items.map(normalizeFn).filter(Boolean).map(item => ({...item, time: item.time || Date.now(), storageId: item.roundId ? item.storageId : (item.storageId || createStorageId())}));
  if(!parsed.length) return false;

  const current = loadHistory(storageKey);
  const overlap = findSnapshotOverlap(parsed, current, keyFn, stableKeyFn);
  const next = parsed.concat(current.slice(overlap));

  const trimmed = next.slice(0, MAX_RESULTS);
  if(JSON.stringify(current.slice(0, MAX_RESULTS)) === JSON.stringify(trimmed)) return false;
  saveHistory(storageKey, trimmed);
  return true;
}

function syncDoubleFromServer(items){
  return syncSnapshotFromServer(KEYS.double, items, normalizeDouble, resultKeyDouble, stableKeyDouble);
}

function syncWheelFromServer(items){
  return syncSnapshotFromServer(KEYS.wheel, items, normalizeWheel, resultKeyWheel, stableKeyWheel);
}

function addResult(key, item, normalizeFn, keyFn){
  const r = normalizeFn(item);
  if(!r) return false;
  r.time = r.time || Date.now();
  if(!r.roundId) r.storageId = r.storageId || createStorageId();

  let history = loadHistory(key);
  const stableKeyFn = key === KEYS.wheel ? stableKeyWheel : stableKeyDouble;
  if(history.length){
    if(isImmediateDuplicate(history[0], r, keyFn, stableKeyFn)) return false;
  }

  history.unshift(r);
  history = history.slice(0, MAX_RESULTS);
  saveHistory(key, history);
  return true;
}

function processEventDouble(eventName, data){
  if(!data || typeof data !== "object") return false;
  let changed = false;

  if(eventName === "gameService-game-state"){
    if(Array.isArray(data.prevRoundResults)){
      changed = syncDoubleFromServer(data.prevRoundResults) || changed;
    }
    if(data.cellResult && String(data.status || "").toUpperCase() === "IN_GAME"){
      changed = addResult(KEYS.double, data.cellResult, normalizeDouble, resultKeyDouble) || changed;
    }
    return changed;
  }

  if(eventName === "gameService-game-status-changed"){
    const status = String(data.status || "").toUpperCase();
    const finalLike = /RESULT|FINISH|ENDED|END|COMPLETE|COMPLETED|IN_GAME/.test(status);
    if(finalLike && data.cellResult){
      changed = addResult(KEYS.double, data.cellResult, normalizeDouble, resultKeyDouble) || changed;
      return changed;
    }
    if(Array.isArray(data.prevRoundResults)){
      changed = syncDoubleFromServer(data.prevRoundResults) || changed;
    }
    return changed;
  }

  return changed;
}

function scanDoublePayload(value, depth = 0){
  if(!value || depth > 6) return false;
  let changed = false;

  if(Array.isArray(value)){
    for(const item of value){
      changed = scanDoublePayload(item, depth + 1) || changed;
    }
    return changed;
  }

  if(typeof value !== "object") return false;

  if(Array.isArray(value.prevRoundResults)){
    changed = syncDoubleFromServer(value.prevRoundResults) || changed;
  }

  const resultKeys = [
    "cellResult",
    "result",
    "roundResult",
    "gameResult",
    "lastResult",
    "currentResult",
    "winnerCell",
    "winningCell",
    "winner"
  ];
  for(const key of resultKeys){
    if(!value[key] || typeof value[key] !== "object") continue;
    const status = String(value.status || "").toUpperCase();
    const finalLike = !status || /RESULT|FINISH|ENDED|END|COMPLETE|COMPLETED|IN_GAME/.test(status);
    if(finalLike){
      changed = addResult(KEYS.double, value[key], normalizeDouble, resultKeyDouble) || changed;
    }
  }

  if(looksLikeDoubleResult(value)){
    const status = String(value.status || "").toUpperCase();
    const finalLike = !status || /RESULT|FINISH|ENDED|END|COMPLETE|COMPLETED|IN_GAME/.test(status);
    if(finalLike){
      changed = addResult(KEYS.double, value, normalizeDouble, resultKeyDouble) || changed;
    }
  }

  for(const key of Object.keys(value)){
    if(key === "prevRoundResults" || resultKeys.includes(key)) continue;
    changed = scanDoublePayload(value[key], depth + 1) || changed;
  }

  return changed;
}

function scanWheelPayload(value, depth = 0){
  if(!value || depth > 6) return false;
  let changed = false;

  if(Array.isArray(value)){
    for(const item of value){
      changed = scanWheelPayload(item, depth + 1) || changed;
    }
    return changed;
  }

  if(typeof value !== "object") return false;

  if(Array.isArray(value.prevRoundResults)){
    changed = syncWheelFromServer(value.prevRoundResults) || changed;
  }

  const resultKeys = [
    "cellResult",
    "result",
    "roundResult",
    "gameResult",
    "lastResult",
    "currentResult",
    "winnerCell",
    "winningCell",
    "winner"
  ];
  for(const key of resultKeys){
    if(!value[key] || typeof value[key] !== "object") continue;
    const status = String(value.status || "").toUpperCase();
    const finalLike = !status || /RESULT|FINISH|ENDED|END|COMPLETE|COMPLETED|IN_GAME/.test(status);
    if(finalLike){
      changed = addResult(KEYS.wheel, value[key], normalizeWheel, resultKeyWheel) || changed;
    }
  }

  if(looksLikeWheelResult(value)){
    const status = String(value.status || "").toUpperCase();
    const finalLike = !status || /RESULT|FINISH|ENDED|END|COMPLETE|COMPLETED|IN_GAME/.test(status);
    if(finalLike){
      changed = addResult(KEYS.wheel, value, normalizeWheel, resultKeyWheel) || changed;
    }
  }

  for(const key of Object.keys(value)){
    if(key === "prevRoundResults" || resultKeys.includes(key)) continue;
    changed = scanWheelPayload(value[key], depth + 1) || changed;
  }

  return changed;
}

function processEventWheel(eventName, data){
  if(!data || typeof data !== "object") return false;
  let changed = false;

  if(eventName === "gameService-game-state"){
    if(Array.isArray(data.prevRoundResults)){
      changed = syncWheelFromServer(data.prevRoundResults) || changed;
    }
    if(data.cellResult && /RESULT|FINISH|ENDED|END|COMPLETE|COMPLETED|IN_GAME/.test(String(data.status || "").toUpperCase())){
      changed = addResult(KEYS.wheel, data.cellResult, normalizeWheel, resultKeyWheel) || changed;
    }
    return changed;
  }

  if(eventName === "gameService-game-status-changed"){
    const status = String(data.status || "").toUpperCase();
    if(status === "IN_GAME" && data.cellResult){
      changed = addResult(KEYS.wheel, data.cellResult, normalizeWheel, resultKeyWheel) || changed;
      return changed;
    }
    if(Array.isArray(data.prevRoundResults)){
      changed = syncWheelFromServer(data.prevRoundResults) || changed;
    }
    if(/FINISH|RESULT|ENDED|END|COMPLETE|COMPLETED/.test(status) && looksLikeWheelResult(data)){
      changed = addResult(KEYS.wheel, data, normalizeWheel, resultKeyWheel) || changed;
    }
    return changed;
  }

  const finalLike = /result|finished|finish|ended|end|complete|completed/.test(eventName) ||
                    /RESULT|FINISH|ENDED|COMPLETE/.test(String(data.status || "").toUpperCase());
  if(finalLike && data.cellResult){
    changed = addResult(KEYS.wheel, data.cellResult, normalizeWheel, resultKeyWheel) || changed;
  }

  return changed;
}

function processPayloadDouble(payload){
  if(!payload) return false;
  let changed = false;

  if(Array.isArray(payload)){
    if(typeof payload[0] === "string"){
      changed = processEventDouble(payload[0], payload[1]) || changed;
      changed = scanDoublePayload(payload[1]) || changed;
      return changed;
    }
    for(const item of payload){
      if(item && typeof item === "object"){
        if(Array.isArray(item.prevRoundResults)){
          changed = syncDoubleFromServer(item.prevRoundResults) || changed;
        }
        if(String(item.status || "").toUpperCase() === "IN_GAME" && item.cellResult){
          changed = addResult(KEYS.double, item.cellResult, normalizeDouble, resultKeyDouble) || changed;
        }
      }
    }
    return changed;
  }

  if(typeof payload === "object"){
    if(Array.isArray(payload.prevRoundResults)){
      changed = syncDoubleFromServer(payload.prevRoundResults) || changed;
    }
    changed = scanDoublePayload(payload) || changed;
  }
  return changed;
}

function processPayloadWheel(payload){
  if(!payload) return false;
  let changed = false;

  if(Array.isArray(payload)){
    if(typeof payload[0] === "string"){
      changed = processEventWheel(payload[0], payload[1]) || changed;
      changed = scanWheelPayload(payload[1]) || changed;
      return changed;
    }
    for(const item of payload){
      if(item && typeof item === "object"){
        if(Array.isArray(item.prevRoundResults)){
          changed = syncWheelFromServer(item.prevRoundResults) || changed;
        }
        if(item.cellResult && /RESULT|FINISH|ENDED|END|COMPLETE|COMPLETED|IN_GAME/.test(String(item.status || "").toUpperCase())){
          changed = addResult(KEYS.wheel, item.cellResult, normalizeWheel, resultKeyWheel) || changed;
        }
        changed = scanWheelPayload(item) || changed;
      }
    }
    return changed;
  }

  if(typeof payload === "object"){
    if(Array.isArray(payload.prevRoundResults)){
      changed = syncWheelFromServer(payload.prevRoundResults) || changed;
    }
    changed = scanWheelPayload(payload) || changed;
  }
  return changed;
}

function parseSocketMessage(raw){
  if(typeof raw !== "string") return null;

  if(raw.includes("\u001e")){
    return raw.split("\u001e").filter(Boolean);
  }
  return [raw];
}

function parsePacketPayload(part, prefixLength){
  const body = part.slice(prefixLength);
  const pos = body.search(/[\[{]/);
  if(pos < 0) return null;
  return JSON.parse(body.slice(pos));
}

function saveDebug(label, patch){
  try{
    const key = "__ws-debug-" + label;
    const current = JSON.parse(localStorage.getItem(key) || "{}");
    localStorage.setItem(key, JSON.stringify({...current, ...patch, updatedAt: Date.now()}));
  }catch{}
}

function createConnection(getWsUrl, processPayloadFn, label){
  let socket = null;
  let reconnectTimer = null;
  let lastConnect = 0;

  function notifyStatus(connected, reason){
    saveDebug(label, {connected, reason: reason || "", lastStatusAt: Date.now()});
    window.dispatchEvent(new CustomEvent("ws-worker-status", {detail:{label, connected, reason}}));
  }

  function notifyUpdate(changed){
    if(!changed) return;
    saveDebug(label, {lastUpdateAt: Date.now()});
    window.dispatchEvent(new CustomEvent("ws-worker-update", {detail:{label}}));
    try{ localStorage.setItem("__ws-ping", Date.now()); }catch{}
  }

  function connect(){
    clearTimeout(reconnectTimer);
    if(socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)){
      return;
    }

    const wsUrl = getWsUrl();
    if(!wsUrl){
      notifyStatus(false, "missing-config");
      return;
    }

    try{
      socket = new WebSocket(wsUrl);
    }catch{
      scheduleReconnect();
      return;
    }

    socket.onopen = () => {
      lastConnect = Date.now();
      notifyStatus(true);
    };

    socket.onmessage = async event => {
      let data = event.data;

      if(data instanceof Blob){
        try{ data = await data.text(); }catch{ return; }
      }else if(data instanceof ArrayBuffer){
        try{ data = new TextDecoder().decode(data); }catch{ return; }
      }

      const parts = parseSocketMessage(data);
      if(!parts) return;
      saveDebug(label, {lastMessageAt: Date.now(), lastMessageSample: String(data).slice(0, 220)});

      for(const part of parts){
        if(part === "0" || part.startsWith("0{")){
          if(socket && socket.readyState === WebSocket.OPEN){
            try{ socket.send("40"); }catch{}
          }
          continue;
        }
        if(part === "2"){
          if(socket && socket.readyState === WebSocket.OPEN){
            try{ socket.send("3"); }catch{}
          }
          continue;
        }
        if(part === "40" || part.startsWith("40{")) continue;

        if(part.startsWith("42")){
          try{
            const payload = parsePacketPayload(part, 2);
            const changed = processPayloadFn(payload);
            notifyUpdate(changed);
          }catch{}
          continue;
        }

        if(part.startsWith("431")){
          try{
            const payload = parsePacketPayload(part, 3);
            notifyUpdate(processPayloadFn(payload));
          }catch{}
          continue;
        }

        if(part.startsWith("43")){
          try{
            const payload = parsePacketPayload(part, 2);
            notifyUpdate(processPayloadFn(payload));
          }catch{}
        }
      }
    };

    socket.onerror = () => {
      saveDebug(label, {lastErrorAt: Date.now()});
      try{ socket.close(); }catch{}
    };

    socket.onclose = () => {
      socket = null;
      notifyStatus(false, "closed");
      scheduleReconnect();
    };
  }

  function scheduleReconnect(){
    clearTimeout(reconnectTimer);
    const delay = Math.min(30000, 2000 + (Date.now() - lastConnect < 5000 ? 3000 : 0));
    reconnectTimer = setTimeout(connect, delay);
  }

  return { connect, close(){
    clearTimeout(reconnectTimer);
    if(socket){
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try{ socket.close(); }catch{}
      socket = null;
    }
  }};
}

const isBackground = document.title === "WS Background";
const isDoublePage = /Double/i.test(document.title);
const isWheelPage = /Wheel/i.test(document.title);
const isRobotsPage = !!document.querySelector("[data-robot]");

const doubleConn = createConnection(() => getConfiguredWsUrl("double", "new-double"), processPayloadDouble, "double");
const wheelConn = createConnection(() => getConfiguredWsUrl("wheel", "wheel"), processPayloadWheel, "wheel");

if(isBackground || isRobotsPage){
  doubleConn.connect();
  wheelConn.connect();
}else{
  if(isDoublePage) doubleConn.connect();
  if(isWheelPage) wheelConn.connect();
}

if(isBackground || isRobotsPage){
  document.addEventListener("visibilitychange", () => {
    if(document.visibilityState === "visible"){
      doubleConn.connect();
      wheelConn.connect();
    }
  });

  window.addEventListener("storage", e => {
    if(e.key !== WS_SETTINGS_KEY && !String(e.key || "").startsWith("ws-")) return;
    doubleConn.close();
    wheelConn.close();
    doubleConn.connect();
    wheelConn.connect();
  });

  window.addEventListener("beforeunload", () => {
    doubleConn.close();
    wheelConn.close();
  });
}else if(isDoublePage || isWheelPage){
  document.addEventListener("visibilitychange", () => {
    if(document.visibilityState === "visible"){
      if(isDoublePage) doubleConn.connect();
      if(isWheelPage) wheelConn.connect();
    }
  });

  window.addEventListener("storage", e => {
    if(e.key !== WS_SETTINGS_KEY && !String(e.key || "").startsWith("ws-")) return;
    if(isDoublePage){
      doubleConn.close();
      doubleConn.connect();
    }
    if(isWheelPage){
      wheelConn.close();
      wheelConn.connect();
    }
  });

  window.addEventListener("beforeunload", () => {
    if(isDoublePage) doubleConn.close();
    if(isWheelPage) wheelConn.close();
  });
}

/* =========================================================
   ROBO BACKGROUND LOGIC — roda 24h em ws-background.html
   ========================================================= */

const ROBOT_STORAGE_PREFIX = "robot-";
const ROBOT_CHANNELS_KEY = "telegram-channels";
const ROBOT_TOKEN_KEY = "telegram-bot-token";
const ROBOT_HISTORY_KEY = "historico-double-v1";

const CE={red:"🔴",black:"⚫",green:"🟢"};
const CL={red:"VERMELHO",black:"PRETO",green:"VERDE"};

function robotGetToken(){return localStorage.getItem(ROBOT_TOKEN_KEY)||"";}
function robotGetChannels(){try{return JSON.parse(localStorage.getItem(ROBOT_CHANNELS_KEY)||"[]");}catch{return[];}}
function robotGetData(id){try{return JSON.parse(localStorage.getItem(ROBOT_STORAGE_PREFIX+id)||"null");}catch{return null;}}
function robotSaveData(id,data){try{localStorage.setItem(ROBOT_STORAGE_PREFIX+id,JSON.stringify(data));}catch{}try{localStorage.setItem(ROBOT_STORAGE_PREFIX+id+"-version",Date.now()+"");}catch{}}
function robotGetHistory(){try{return JSON.parse(localStorage.getItem(ROBOT_HISTORY_KEY)||"[]");}catch{return[];}}

function robotEscapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function robotDoubleResultKey(r){
  if(!r)return "";
  return r.roundId ? "round:" + r.roundId : r.number + ":" + r.color;
}

function robotWheelResultKey(r){
  if(!r)return "";
  return r.roundId ? "round:" + r.roundId : r.cellIndex + ":" + r.cellColor;
}

function robotLeadingRun(history, keyFn, key){
  if(!key)return 0;
  let count = 0;
  for(const item of history){
    if(keyFn(item) !== key) break;
    count++;
  }
  return count;
}

function robotCaptureBaseline(history, keyFn){
  const key = history.length ? keyFn(history[0]) : "";
  return {
    baselineKey: key,
    baselineRun: robotLeadingRun(history, keyFn, key),
    baselineLength: history.length
  };
}

function robotApplyBaseline(pending, history, keyFn){
  const base = robotCaptureBaseline(history, keyFn);
  pending.baselineKey = base.baselineKey;
  pending.baselineRun = base.baselineRun;
  pending.baselineLength = base.baselineLength;
}

function robotNextResultAfterPending(history, pending, keyFn){
  if(!history.length || !pending) return null;
  if(!pending.baselineKey){
    robotApplyBaseline(pending, history, keyFn);
    return null;
  }
  const latest = history[0];
  const latestKey = keyFn(latest);
  if(latestKey !== pending.baselineKey) return latest;
  const currentRun = robotLeadingRun(history, keyFn, pending.baselineKey);
  if(currentRun > (pending.baselineRun || 0)) return latest;
  return null;
}

function robotPatternEmoji(text){
  return text
    .replace(/VERMELHO/g,"🟥")
    .replace(/PRETO/g,"⬛")
    .replace(/VERDE/g,"🟩")
    .replace(/V/g,"🟥")
    .replace(/P/g,"⬛");
}

function robotLiveEmojis(history){
  const emojiMap={red:"🔴",black:"⚫",green:"🟢"};
  return history.slice(0,10).map(r=>emojiMap[r.color]||"❓").join("");
}

function robotSendTelegram(channelId, text){
  const token=robotGetToken();
  if(!token||!channelId)return Promise.resolve(false);
  return fetch("https://api.telegram.org/bot"+token+"/sendMessage",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({chat_id:channelId,text:text})
  }).then(r=>r.json()).then(data=>data.ok).catch(()=>false);
}

function robotGatherSignals(history){
  if(history.length<5)return{signals:[],seq:[]};
  const seq=history.map(r=>r.color).filter(c=>["red","black","green"].includes(c));
  if(seq.length<5)return{signals:[],seq};
  const signals=[];
  const all=seq.filter(c=>c!=="green");

  function addSignal(target,name,conf,weight){
    signals.push({target,name,conf:Math.min(98,Math.max(20,conf)),weight:weight||1});
  }

  function countStreak(startIdx){
    const c=seq[startIdx];
    let n=0;
    for(let i=startIdx;i<seq.length;i++){if(seq[i]===c)n++;else break;}
    return n;
  }
  const streak=countStreak(0);
  const streakColor=seq[0];
  if(streak>=3&&streakColor!=="green"){
    const target=streakColor==="red"?"black":"red";
    const name=streak+"x "+CL[streakColor]+" seguidos";
    const conf=streak>=5?88:streak===4?84:streak===3?78:72;
    addSignal(target,name,conf,streak>=5?2.2:streak===4?2:1.8);
  }

  let altCount=0;
  for(let i=1;i<seq.length;i++){
    if(seq[i]!==seq[i-1]&&seq[i]!=="green"&&seq[i-1]!=="green")altCount++;
    else break;
  }
  if(altCount>=4){
    const target=seq[0]==="red"?"red":"black";
    const name="Alternância "+altCount+"x (V↔P)";
    addSignal(target,name,60+altCount*3,1.6);
  }else if(altCount===3){
    const target=seq[0]==="red"?"black":"red";
    const name="Alternância curta 3x — inversão";
    addSignal(target,name,64,1.4);
  }

  if(seq.length>=4){
    if(seq[0]===seq[1]&&seq[2]===seq[3]&&seq[0]!==seq[2]&&seq[0]!=="green"&&seq[2]!=="green"){
      const target=seq[0]==="red"?"black":"red";
      const name="Par duplicado: "+CE[seq[0]]+CE[seq[0]]+"→"+CE[seq[2]]+CE[seq[2]];
      addSignal(target,name,60,1.4);
    }
  }

  if(streak===3&&streakColor!=="green"){
    addSignal(streakColor==="red"?"black":"red","Trinca de 3 completada",70,2);
  }

  if(seq[0]==="green"){
    const check=seq.slice(1);
    const rc=check.filter(c=>c==="red").length;
    const bc=check.filter(c=>c==="black").length;
    if(rc>bc)addSignal("black","Branco → recuperação preta",64,1.5);
    else if(bc>rc)addSignal("red","Branco → recuperação vermelha",64,1.5);
  }

  if(all.length>=5){
    const rc=all.filter(c=>c==="red").length;
    const bc=all.filter(c=>c==="black").length;
    const ratio=rc/Math.max(bc,1);
    if(ratio>=2.5)addSignal("black","Dominância vermelha total ("+rc+"V:"+bc+"P)",68,1.6);
    else if(ratio>=2)addSignal("black","Dominância vermelha total ("+rc+"V:"+bc+"P)",64,1.4);
    const invRatio=bc/Math.max(rc,1);
    if(invRatio>=2.5)addSignal("red","Dominância preta total ("+bc+"P:"+rc+"V)",68,1.6);
    else if(invRatio>=2)addSignal("red","Dominância preta total ("+bc+"P:"+rc+"V)",64,1.4);
  }

  if(all.length>=5){
    const rc=all.filter(c=>c==="red").length;
    const bc=all.filter(c=>c==="black").length;
    const total=rc+bc;
    const redPct=Math.round(rc/total*100);
    const blackPct=Math.round(bc/total*100);
    if(redPct>=75)addSignal("black","Vermelho dominante total "+redPct+"%",62,1.3);
    else if(redPct>=65)addSignal("black","Vermelho dominante total "+redPct+"%",58,1.2);
    if(blackPct>=75)addSignal("red","Preto dominante total "+blackPct+"%",62,1.3);
    else if(blackPct>=65)addSignal("red","Preto dominante total "+blackPct+"%",58,1.2);
  }

  for(let len=3;len<=6;len++){
    if(seq.length<len*2)continue;
    const p=seq.slice(len-1,-1).reverse().slice(0,len);
    if(p.length<len)continue;
    let same=true;
    for(let j=1;j<len;j++){if(p[j]!==p[0]){same=false;break;}}
    if(!same)continue;
    if(p[0]==="green")continue;
    let match=true;
    for(let i=len;i<seq.length;i+=len){
      if(seq[i]!==p[i%len]){match=false;break;}
    }
    if(match){
      const target=p[0]==="red"?"black":"red";
      addSignal(target,"Repetição: "+p.map(c=>CE[c]).join(""),58,1.2);
    }
  }

  const noGreen=seq.filter(c=>c!=="green");
  if(noGreen.length>=8){
    let recentStreakSame=true;
    for(let i=0;i<3;i++){if(noGreen[i]!==noGreen[i+1]){recentStreakSame=false;break;}}
    if(!recentStreakSame&&streak<=2){
      const rc8=noGreen.slice(0,4).filter(c=>c==="red").length;
      const bc8=noGreen.slice(0,4).filter(c=>c==="black").length;
      if(rc8>=3)addSignal("black","Acúmulo vermelho recente",58,1.2);
      if(bc8>=3)addSignal("red","Acúmulo preto recente",58,1.2);
    }
  }

  for(let cycle=2;cycle<=8;cycle++){
    if(all.length<cycle*3)continue;
    let match=true;
    for(let i=cycle;i<Math.min(all.length,cycle*4);i++){
      if(all[i]!==all[i%cycle]){match=false;break;}
    }
    if(match){
      const target=all[0]==="red"?"black":"red";
      addSignal(target,"Ciclo "+cycle+" rodadas detectado",56,1);
    }
  }

  return{signals,seq};
}

function robotDetectPattern(history, options){
  options=options||{};
  const{signals,seq}=robotGatherSignals(history);
  if(!signals.length)return null;

  const recentLossColor=options.recentLossColor;
  const recentLossCount=options.recentLossCount||0;
  const sameColorLimit=options.sameColorLimit||2;

  const scores={red:{total:0,signals:[]},black:{total:0,signals:[]}};
  for(const s of signals){
    let conf=s.conf;

    if(recentLossColor&&s.target===recentLossColor&&recentLossCount>=sameColorLimit){
      conf=conf*0.65;
    }

    if(seq.length>=3){
      const last3=seq.slice(0,3).filter(c=>c!=="green");
      const opposite=s.target==="red"?"black":"red";
      const oppCount=last3.filter(c=>c===opposite).length;
      if(oppCount>=2)conf=conf*0.75;
    }

    const finalConf=Math.min(95,Math.max(20,Math.round(conf)));
    scores[s.target].total+=finalConf*s.weight;
    scores[s.target].signals.push({...s,conf:finalConf});
  }

  const best=scores.red.total>=scores.black.total?{target:"red",data:scores.red}:{target:"black",data:scores.black};
  if(best.data.signals.length===0)return null;

  const avgConf=Math.round(best.data.total/best.data.signals.length);
  const names=best.data.signals.map(s=>s.name);
  const uniqueNames=[...new Set(names)];
  const patternName=uniqueNames.slice(0,2).join(" + ");

  return{targetColor:best.target,patternName,confidence:Math.min(95,avgConf),signalCount:best.data.signals.length,allSignals:signals,scores};
}

function robotBuildMessage(pattern, history, cfg){
  const galeLabels=["SG","GALE 1","GALE 2","GALE 3","GALE 4"];
  const mg=parseInt(cfg.martingale)||0;
  const gp=cfg.greenProtect||false;
  const sc=pattern.signalCount||1;
  const confBar=pattern.confidence>=80?"🟩🟩🟩":pattern.confidence>=60?"🟨🟨⬜":"🟥🟥⬜";
  const timeNow=new Date().toLocaleTimeString("pt-BR");
  const entryStr=CE[pattern.targetColor]+(gp?" + 🟢":"");
  return"⚡️ SINAL DETECTADO ⚡️\n"+
    "━━━━━━━━━━━━━━━━━━━\n"+
    "BETBOOM DOUBLE CORES 🔴⚫️\n"+
    "━━━━━━━━━━━━━━━━━━━\n"+
    "➡️ ENTRADA: "+entryStr+"\n"+
    (gp?"🛡️ Proteção no Verde: ATIVADA\n":"")+
    (mg>0?"🎰 Martingale: "+galeLabels[mg]+" ("+(mg+1)+" entradas)\n":"")+
    "🔎 "+robotPatternEmoji(pattern.patternName)+"\n"+
    "📊 "+confBar+" "+pattern.confidence+"%\n"+
    "🧩 "+sc+" indicador"+(sc>1?"es":"")+"\n"+
    "━━━━━━━━━━━━━━━━━━━\n"+
    "AO VIVO:\n"+robotLiveEmojis(history)+"\n"+
    "━━━━━━━━━━━━━━━━━━━\n"+
    "⏳ Resultado em breve... ["+timeNow+"]";
}

function robotComputeRecentLossContext(cfg){
  const score=cfg.score||{wins:0,losses:0,streak:0,streakType:"",history:[]};
  const history=score.history||[];
  let recentLossColor=null;
  let recentLossCount=0;
  for(let i=0;i<history.length;i++){
    const item=history[i];
    if(item.result==="loss"){
      if(recentLossColor===null){
        recentLossColor=item.color;
        recentLossCount=1;
      }else if(item.color===recentLossColor){
        recentLossCount++;
      }else{
        break;
      }
    }else{
      break;
    }
  }
  return{recentLossColor,recentLossCount};
}

async function robotRunBetBoom(){
  const data=robotGetData("betboom");
  if(!data||!data.active)return;

  const history=robotGetHistory();
  const pending=data.pending;

  if(pending&&pending.sent&&!pending.result){
    if(history.length>0){
      const hadBaseline=!!pending.baselineKey;
      const latest=robotNextResultAfterPending(history,pending,robotDoubleResultKey);
      if(!hadBaseline&&pending.baselineKey){
        robotSaveData("betboom",data);
        return;
      }
      if(latest){

        const isWin=latest.color==="green"?data.greenProtect:latest.color===pending.targetColor;
        const currentLevel=pending.martingaleLevel||0;
        const maxGale=data.martingale||0;

        if(!isWin&&currentLevel<maxGale){
          const nextLevel=currentLevel+1;
          const nextGaleLabel=["SG","GALE 1","GALE 2","GALE 3","GALE 4"][nextLevel]||"GALE "+nextLevel;
          const checkPattern=robotDetectPattern(history,{
            recentLossColor:pending.targetColor,
            recentLossCount:nextLevel,
            sameColorLimit:1
          });

          if(checkPattern&&checkPattern.targetColor!==pending.targetColor&&checkPattern.confidence>=pending.confidence){
            data.pending.targetColor=checkPattern.targetColor;
            data.pending.patternName=checkPattern.patternName;
            data.pending.confidence=checkPattern.confidence;
            data.pending.martingaleLevel=nextLevel;
            data.pending.sent=false;
            data.pending.result=null;
            data.pending.sentAt=null;
            robotSaveData("betboom",data);
          }else{
            data.pending.martingaleLevel=nextLevel;
            data.pending.sent=false;
            data.pending.result=null;
            data.pending.sentAt=null;
            robotSaveData("betboom",data);
          }
          return;
        }

        data.pending.result=isWin?"win":"loss";
        data.pending.resultColor=latest.color;
        data.pending.correctedAt=new Date().toLocaleTimeString("pt-BR");

        if(!data.score)data.score={wins:0,losses:0,streak:0,streakType:""};
        if(isWin)data.score.wins++;
        else data.score.losses++;

        const s=data.score;
        if(s.streakType===(isWin?"win":"loss"))s.streak++;
        else{s.streak=1;s.streakType=isWin?"win":"loss";}

        s.history=s.history||[];
        s.history.unshift({time:data.pending.correctedAt,result:data.pending.result,color:latest.color});
        if(s.history.length>50)s.history=s.history.slice(0,50);

        data.pending=null;
        robotSaveData("betboom",data);

        const total=s.wins+s.losses;
        const rate=total?Math.round(s.wins/total*100):0;
        const correctionMsg=(isWin?"✅WIN!✅":"❌LOSS❌")+"\n"+
          "━━━━━━━━━━━━━━━━━━━\n"+
          "Resultado: "+CE[latest.color]+" "+CL[latest.color]+"\n"+
          "Previsao: "+CE[pending.targetColor]+" "+CL[pending.targetColor]+"\n"+
          "━━━━━━━━━━━━━━━━━━━\n"+
          "📊 PLACAR: ✅"+s.wins+"W / ❌"+s.losses+"L ("+rate+"%)";
        await robotSendTelegram(data.channel,correctionMsg);
      }
      return;
    }
  }

  if(pending&&!pending.sent&&!pending.result&&pending.martingaleLevel>0){
    const now=Date.now();
    if(now-(window.__robotLastGaleSignalTime||0)<30000)return;
    window.__robotLastGaleSignalTime=now;

    const galeLabels=["SG","GALE 1","GALE 2","GALE 3","GALE 4"];
    const galeLabel=galeLabels[pending.martingaleLevel]||"GALE "+pending.martingaleLevel;
    const emojis=robotLiveEmojis(history);
    const gp=data.greenProtect||false;
    const entryStr=CE[pending.targetColor]+(gp?" + 🟢":"");
    const timeNow=new Date().toLocaleTimeString("pt-BR");
    const galeMsg="🔄 "+galeLabel+" — NOVA ENTRADA\n"+
      "━━━━━━━━━━━━━━━━━━━\n"+
      "➡️ ENTRADA: "+entryStr+"\n"+
      "━━━━━━━━━━━━━━━━━━━\n"+
      "AO VIVO:\n"+emojis+"\n"+
      "━━━━━━━━━━━━━━━━━━━\n"+
      "⏳ Resultado em breve... ["+timeNow+"]";

    const sent=await robotSendTelegram(data.channel,galeMsg);
    if(sent){
      robotApplyBaseline(data.pending, history, robotDoubleResultKey);
      data.pending.sent=true;
      data.pending.sentAt=new Date().toLocaleTimeString("pt-BR");
      robotSaveData("betboom",data);
    }
    return;
  }

  if(!pending){
    const recentLoss=robotComputeRecentLossContext(data);
    const pattern=robotDetectPattern(history, recentLoss);
    if(!pattern)return;

    const now=Date.now();
    if(now-(window.__robotLastSignalTime||0)<(data.interval||30)*1000)return;
    window.__robotLastSignalTime=now;

    const entryMsg=robotBuildMessage(pattern, history, data);
    const sent=await robotSendTelegram(data.channel,entryMsg);
    if(sent){
      data.pending={
        targetColor:pattern.targetColor,
        patternName:pattern.patternName,
        confidence:pattern.confidence,
        signalCount:pattern.signalCount||1,
        martingaleLevel:0,
        sentAt:new Date().toLocaleTimeString("pt-BR"),
        sent:true,
        result:null
      };
      robotApplyBaseline(data.pending, history, robotDoubleResultKey);
      robotSaveData("betboom",data);
    }
  }
}

/* === WHEEL 2X ROBOT === */
const WCE={grey:"⚫️",red:"🔴",blue:"🔵",green:"🟢"};
const WCL={grey:"PRETO",red:"VERMELHO",blue:"AZUL",green:"VERDE"};
const WCM={grey:"2X",red:"3X",blue:"5X",green:"50X"};

function robotWheelGetHistory(){try{return JSON.parse(localStorage.getItem("historico-wheel-v1")||"[]");}catch{return[];}}

function robotWheelLiveEmojis(history){
  const emojiMap={grey:"⚫️",red:"🔴",blue:"🔵",green:"🟢"};
  return history.slice(0,10).map(r=>emojiMap[r.cellColor]||"").join("");
}

function robotWheelPatternEmoji(text){
  return text
    .replace(/PRETO/g,"⚫️")
    .replace(/VERMELHO/g,"🟥")
    .replace(/AZUL/g,"🟦")
    .replace(/VERDE/g,"🟩");
}

function robotWheelGatherSignals(history){
  if(history.length<5)return{signals:[],seq:[]};
  const seq=history.map(r=>r.cellColor).filter(c=>["black","red","blue","green"].includes(c));
  if(seq.length<5)return{signals:[],seq};
  const signals=[];
  const T="black";
  const nums=history.map(r=>r.cellIndex).filter(n=>Number.isFinite(n));

  function addSignal(name,conf,weight){
    signals.push({target:T,name,conf:Math.min(98,Math.max(20,conf)),weight:weight||1});
  }

  if(nums.length>=8){
    const freq={};
    for(let i=0;i<=14;i++)freq[i]=0;
    nums.slice(0,20).forEach(n=>{if(n>=0&&n<=14)freq[n]++;});
    const sorted=Object.keys(freq).map(Number).sort((a,b)=>freq[b]-freq[a]);
    const coldNum=sorted[sorted.length-1];
    const hotNum=sorted[0];
    if(freq[coldNum]<=1&&freq[hotNum]>=4){
      addSignal("Frio "+coldNum+" vs Quente "+hotNum+" ("+freq[hotNum]+"x)",66,1.5);
    }else if(freq[hotNum]>=5){
      addSignal("Numero "+hotNum+" quente ("+freq[hotNum]+"x nos ultimos 20)",62,1.3);
    }
  }

  if(nums.length>=6){
    const last6=nums.slice(0,6);
    const sum=last6.reduce((a,b)=>a+b,0);
    const avg=sum/6;
    if(avg>=9)addSignal("Media alta "+avg.toFixed(1)+" — inversao pendurada",63,1.4);
    else if(avg<=5)addSignal("Media baixa "+avg.toFixed(1)+" — inversao pendurada",63,1.4);
  }

  if(nums.length>=10){
    const recent10=nums.slice(0,10);
    let grandes=0;
    let pequenos=0;
    for(const n of recent10){if(n>=8)grandes++;else if(n>=1&&n<=7)pequenos++;}
    if(grandes>=7)addSignal("Grandes dominam "+grandes+"/10 — pequenos pendurados",65,1.5);
    else if(pequenos>=7)addSignal("Pequenos dominam "+pequenos+"/10 — grandes pendurados",65,1.5);
  }

  if(nums.length>=8){
    const recent8=nums.slice(0,8);
    const altCount=recent8.filter((n,i)=>i>0&&Math.abs(n-recent8[i-1])>=5).length;
    if(altCount>=4)addSignal("Grandes saltos "+altCount+"x — preto entra",64,1.4);
  }

  if(nums.length>=6){
    const recent6=nums.slice(0,6);
    let up=0;
    let down=0;
    for(let i=1;i<recent6.length;i++){
      if(recent6[i]>recent6[i-1])up++;
      else down++;
    }
    if(up>=5)addSignal("Tendencia subindo "+up+"x — pode inverter",61,1.3);
    else if(down>=5)addSignal("Tendencia descendo "+down+"x — pode inverter",61,1.3);
  }

  return{signals,seq};
}

function robotWheelDetectPattern(history, options){
  options=options||{};
  const{signals,seq}=robotWheelGatherSignals(history);
  if(!signals.length)return null;

  const recentLossColor=options.recentLossColor;
  const recentLossCount=options.recentLossCount||0;
  const sameColorLimit=options.sameColorLimit||2;

  let totalConf=0;
  let totalWeight=0;
  let totalSignals=0;
  const usedNames=[];

  for(const s of signals){
    let conf=s.conf;

    if(recentLossColor==="black"&&recentLossCount>=sameColorLimit){
      conf=conf*0.65;
    }

    const last3=seq.slice(0,3).filter(c=>c!=="green");
    const blackCount=last3.filter(c=>c==="black").length;
    if(blackCount>=2)conf=conf*0.85;

    const finalConf=Math.min(95,Math.max(20,Math.round(conf)));
    totalConf+=finalConf*s.weight;
    totalWeight+=s.weight;
    totalSignals++;
    if(!usedNames.includes(s.name))usedNames.push(s.name);
  }

  if(totalSignals===0)return null;

  const avgConf=Math.round(totalConf/totalWeight);
  const patternName=usedNames.slice(0,2).join(" + ");

  return{targetColor:"black",patternName,confidence:Math.min(95,avgConf),signalCount:totalSignals,allSignals:signals};
}

function robotWheelBuildMessage(pattern, history, cfg){
  const galeLabels=["SG","GALE 1","GALE 2","GALE 3","GALE 4"];
  const mg=parseInt(cfg.martingale)||0;
  const sc=pattern.signalCount||1;
  const confBar=pattern.confidence>=80?"🟩🟩🟩":pattern.confidence>=60?"🟨🟨⬜":"🟥🟥⬜";
  const timeNow=new Date().toLocaleTimeString("pt-BR");
  const entryStr=WCE[pattern.targetColor]+" "+WCM[pattern.targetColor];
  return"⚡️ SINAL DETECTADO ⚡️\n"+
    "━━━━━━━━━━━━━━━━━━━\n"+
    "WHEEL 2X — CORES 🎡\n"+
    "━━━━━━━━━━━━━━━━━━━\n"+
    "➡️ ENTRADA: "+entryStr+"\n"+
    "💰 Multipliador: "+WCM[pattern.targetColor]+"\n"+
    (mg>0?"🎰 Martingale: "+galeLabels[mg]+" ("+(mg+1)+" entradas)\n":"")+
    "🔎 "+robotWheelPatternEmoji(pattern.patternName)+"\n"+
    "📊 "+confBar+" "+pattern.confidence+"%\n"+
    "🧩 "+sc+" indicador"+(sc>1?"es":"")+"\n"+
    "━━━━━━━━━━━━━━━━━━━\n"+
    "AO VIVO:\n"+robotWheelLiveEmojis(history)+"\n"+
    "━━━━━━━━━━━━━━━━━━━\n"+
    "⏳ Resultado em breve... ["+timeNow+"]";
}

function robotWheelComputeRecentLossContext(cfg){
  const score=cfg.score||{wins:0,losses:0,streak:0,streakType:"",history:[]};
  const history=score.history||[];
  let recentLossColor=null;
  let recentLossCount=0;
  for(let i=0;i<history.length;i++){
    const item=history[i];
    if(item.result==="loss"){
      if(recentLossColor===null){
        recentLossColor=item.color;
        recentLossCount=1;
      }else if(item.color===recentLossColor){
        recentLossCount++;
      }else{
        break;
      }
    }else{
      break;
    }
  }
  return{recentLossColor,recentLossCount};
}

async function robotRunWheel2X(){
  const data=robotGetData("robowheeldoisx");
  if(!data||!data.active)return;

  const history=robotWheelGetHistory();
  const pending=data.pending;

  if(pending&&pending.sent&&!pending.result){
    if(history.length>0){
      const hadBaseline=!!pending.baselineKey;
      const latest=robotNextResultAfterPending(history,pending,robotWheelResultKey);
      if(!hadBaseline&&pending.baselineKey){
        robotSaveData("robowheeldoisx",data);
        return;
      }
      if(latest){

        const isWin=latest.cellColor===pending.targetColor;
        const currentLevel=pending.martingaleLevel||0;
        const maxGale=data.martingale||0;

        if(!isWin&&currentLevel<maxGale){
          const nextLevel=currentLevel+1;
          const nextGaleLabel=["SG","GALE 1","GALE 2","GALE 3","GALE 4"][nextLevel]||"GALE "+nextLevel;
          const checkPattern=robotWheelDetectPattern(history,{
            recentLossColor:pending.targetColor,
            recentLossCount:nextLevel,
            sameColorLimit:1
          });

          if(checkPattern&&checkPattern.targetColor!==pending.targetColor&&checkPattern.confidence>=pending.confidence){
            data.pending.targetColor=checkPattern.targetColor;
            data.pending.patternName=checkPattern.patternName;
            data.pending.confidence=checkPattern.confidence;
            data.pending.martingaleLevel=nextLevel;
            data.pending.sent=false;
            data.pending.result=null;
            data.pending.sentAt=null;
            robotSaveData("robowheeldoisx",data);
          }else{
            data.pending.martingaleLevel=nextLevel;
            data.pending.sent=false;
            data.pending.result=null;
            data.pending.sentAt=null;
            robotSaveData("robowheeldoisx",data);
          }
          return;
        }

        data.pending.result=isWin?"win":"loss";
        data.pending.resultColor=latest.cellColor;
        data.pending.correctedAt=new Date().toLocaleTimeString("pt-BR");

        if(!data.score)data.score={wins:0,losses:0,streak:0,streakType:""};
        if(isWin)data.score.wins++;
        else data.score.losses++;

        const s=data.score;
        if(s.streakType===(isWin?"win":"loss"))s.streak++;
        else{s.streak=1;s.streakType=isWin?"win":"loss";}

        s.history=s.history||[];
        s.history.unshift({time:data.pending.correctedAt,result:data.pending.result,color:latest.cellColor});
        if(s.history.length>50)s.history=s.history.slice(0,50);

        data.pending=null;
        robotSaveData("robowheeldoisx",data);

        const total=s.wins+s.losses;
        const rate=total?Math.round(s.wins/total*100):0;
        const correctionMsg=(isWin?"✅WIN!✅":"❌LOSS❌")+"\n"+
          "━━━━━━━━━━━━━━━━━━━\n"+
          "Resultado: "+WCE[latest.cellColor]+" "+WCL[latest.cellColor]+"\n"+
          "Previsao: "+WCE[pending.targetColor]+" "+WCL[pending.targetColor]+"\n"+
          "━━━━━━━━━━━━━━━━━━━\n"+
          "📊 PLACAR: ✅"+s.wins+"W / ❌"+s.losses+"L ("+rate+"%)";
        await robotSendTelegram(data.channel,correctionMsg);
      }
      return;
    }
  }

  if(pending&&!pending.sent&&!pending.result&&pending.martingaleLevel>0){
    const now=Date.now();
    if(now-(window.__robotWheelLastGaleSignalTime||0)<30000)return;
    window.__robotWheelLastGaleSignalTime=now;

    const galeLabels=["SG","GALE 1","GALE 2","GALE 3","GALE 4"];
    const galeLabel=galeLabels[pending.martingaleLevel]||"GALE "+pending.martingaleLevel;
    const emojis=robotWheelLiveEmojis(history);
    const entryStr=WCE[pending.targetColor]+" "+WCM[pending.targetColor];
    const timeNow=new Date().toLocaleTimeString("pt-BR");
    const galeMsg="🔄 "+galeLabel+" — NOVA ENTRADA\n"+
      "━━━━━━━━━━━━━━━━━━━\n"+
      "➡️ ENTRADA: "+entryStr+"\n"+
      "━━━━━━━━━━━━━━━━━━━\n"+
      "AO VIVO:\n"+emojis+"\n"+
      "━━━━━━━━━━━━━━━━━━━\n"+
      "⏳ Resultado em breve... ["+timeNow+"]";

    const sent=await robotSendTelegram(data.channel,galeMsg);
    if(sent){
      robotApplyBaseline(data.pending, history, robotWheelResultKey);
      data.pending.sent=true;
      data.pending.sentAt=new Date().toLocaleTimeString("pt-BR");
      robotSaveData("robowheeldoisx",data);
    }
    return;
  }

  if(!pending){
    const recentLoss=robotWheelComputeRecentLossContext(data);
    const pattern=robotWheelDetectPattern(history, recentLoss);
    if(!pattern)return;

    const now=Date.now();
    if(now-(window.__robotWheelLastSignalTime||0)<(data.interval||30)*1000)return;
    window.__robotWheelLastSignalTime=now;

    const entryMsg=robotWheelBuildMessage(pattern, history, data);
    const sent=await robotSendTelegram(data.channel,entryMsg);
    if(sent){
      data.pending={
        targetColor:pattern.targetColor,
        patternName:pattern.patternName,
        confidence:pattern.confidence,
        signalCount:pattern.signalCount||1,
        martingaleLevel:0,
        sentAt:new Date().toLocaleTimeString("pt-BR"),
        sent:true,
        result:null
      };
      robotApplyBaseline(data.pending, history, robotWheelResultKey);
      robotSaveData("robowheeldoisx",data);
    }
  }
}

function robotInit(){
  window.__robotLastSignalTime=0;
  window.__robotLastGaleSignalTime=0;
  window.__robotLastResultSig="";
  window.__robotWheelLastSignalTime=0;
  window.__robotWheelLastGaleSignalTime=0;
  window.__robotWheelLastResultSig="";

  setInterval(async ()=>{
    await robotRunBetBoom();
    await robotRunWheel2X();
  }, 5000);

  window.addEventListener("storage", e=>{
    if(e.key===ROBOT_HISTORY_KEY&&e.newValue){
      window.__robotLastResultSig="";
    }
    if(e.key==="historico-wheel-v1"&&e.newValue){
      window.__robotWheelLastResultSig="";
    }
  });
}

if(document.title==="WS Background"){
  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded", robotInit);
  }else{
    robotInit();
  }
}

})();
