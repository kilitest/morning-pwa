import {
  dbGetAllLists, dbPutList, dbDeleteList,
  dbGetItemsForList, dbPutItem, dbDeleteItem,
  dbGetSetting, dbSetSetting, uid
} from "./db.js";

// ---------- PWA SW ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try { await navigator.serviceWorker.register("./sw.js"); } catch {}
  });
}

// ---------- DOM ----------
const main = document.getElementById("main");
const backBtn = document.getElementById("backBtn");
const addBtn  = document.getElementById("addBtn");
const titleEl = document.getElementById("title");
const subtitleEl = document.getElementById("subtitle");

const sheetBackdrop = document.getElementById("sheetBackdrop");
const sheet = document.getElementById("sheet");
const sheetTitle = document.getElementById("sheetTitle");
const sheetBody = document.getElementById("sheetBody");
const sheetFooter = document.getElementById("sheetFooter");
const sheetClose = document.getElementById("sheetClose");

const alarmAudio = document.getElementById("alarmAudio");

// ---------- State ----------
let view = { name:"lists", listId:null };
let lists = [];
let items = []; // current list items
let currentList = null;

const runningTimers = new Map(); // itemId -> { endAtMs, intervalId }
let showCompleted = false;

// ---------- Utils ----------
function htmlesc(s){ return (s ?? "").replace(/[&<>"']/g, c => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
}[c]));}

function fmtSec(sec){
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec/60);
  const s = sec%60;
  return `${m}:${String(s).padStart(2,"0")}`;
}

function vibrate(){
  try { navigator.vibrate?.(200); } catch {}
}

function openSheet(title, bodyHtml, footerHtml=""){
  sheetTitle.textContent = title;
  sheetBody.innerHTML = bodyHtml;
  sheetFooter.innerHTML = footerHtml;
  sheetBackdrop.classList.remove("hidden");
  sheet.classList.remove("hidden");
}
function closeSheet(){
  sheetBackdrop.classList.add("hidden");
  sheet.classList.add("hidden");
  sheetBody.innerHTML = "";
  sheetFooter.innerHTML = "";
}
sheetBackdrop.addEventListener("click", closeSheet);
sheetClose.addEventListener("click", closeSheet);

// ---------- Init seed ----------
async function ensureSeed(){
  lists = await dbGetAllLists();
  if(lists.length === 0){
    const seed = [
      { id: uid(), title:"To-dos", color:"#4aa3ff", order: 1 },
      { id: uid(), title:"Sport", color:"#78d353", order: 2 }
    ];
    for(const l of seed) await dbPutList(l);
  }
}

// ---------- Navigation ----------
backBtn.addEventListener("click", () => {
  stopAllTimersUIOnly();
  view = { name:"lists", listId:null };
  render();
});

addBtn.addEventListener("click", async () => {
  if(view.name === "lists"){
    await promptNewList();
  } else {
    await addNewItem(currentList.id, null, 0);
    renderListView();
    setTimeout(() => {
      const inputs = main.querySelectorAll("input.edit");
      inputs[inputs.length-1]?.focus();
    }, 0);
  }
});

// ---------- Data helpers ----------
async function reloadLists(){
  lists = await dbGetAllLists();
}
async function reloadItems(listId){
  items = await dbGetItemsForList(listId);
}

function getChildren(parentId){
  return items.filter(it => it.parentId === parentId).sort((a,b)=>a.order-b.order);
}

function computeVisibleItems(){
  const out = [];
  const walk = (parentId) => {
    const kids = getChildren(parentId);
    for(const it of kids){
      if(!it.completed || showCompleted) out.push(it);
      walk(it.id);
    }
  };
  walk(null);
  return out;
}

function nextOrderFor(listId, parentId){
  const sibs = items.filter(x => x.listId===listId && x.parentId===parentId);
  if(sibs.length===0) return 1;
  return Math.max(...sibs.map(x=>x.order)) + 1;
}

async function addNewItem(listId, parentId, depth){
  const order = nextOrderFor(listId, parentId);
  const it = {
    id: uid(),
    listId,
    parentId,
    depth: Math.min(depth, 5), // 6 Ebenen: 0..5
    order,
    text: "",
    completed: false,
    timerEnabled: false,
    lastDurationSec: 600,
    attachments: []
  };
  await dbPutItem(it);
  await reloadItems(listId);
  return it;
}

async function updateItem(partial){
  const idx = items.findIndex(x=>x.id===partial.id);
  if(idx<0) return;
  const merged = { ...items[idx], ...partial };
  items[idx] = merged;
  await dbPutItem(merged);
}

async function deleteItemDeep(itemId){
  const toDelete = new Set([itemId]);
  let changed = true;
  while(changed){
    changed = false;
    for(const it of items){
      if(it.parentId && toDelete.has(it.parentId) && !toDelete.has(it.id)){
        toDelete.add(it.id);
        changed = true;
      }
    }
  }
  for(const id of toDelete) await dbDeleteItem(id);
  await reloadItems(currentList.id);
}

// ---------- Render: Lists ----------
async function renderListsView(){
  await reloadLists();
  titleEl.textContent = "Listen";
  subtitleEl.classList.add("hidden");
  backBtn.classList.add("hidden");

  const html = `
    <div class="grid">
      ${lists.map(l => `
        <div class="card listcard" data-list-id="${l.id}">
          <div class="dot" style="background:${l.color}"></div>
          <div class="cardBody">
            <div class="cardTitle">${htmlesc(l.title)}</div>
            <div class="cardMeta">Tippen zum Öffnen • lang drücken zum Bearbeiten</div>
          </div>
          <div class="cardRight">›</div>
        </div>
      `).join("")}
    </div>
  `;
  main.innerHTML = html;

  main.querySelectorAll(".listcard").forEach(el => {
    el.addEventListener("click", async () => {
      const id = el.getAttribute("data-list-id");
      view = { name:"list", listId:id };
      await openList(id);
    });

    // long press = menu
    let pressT;
    el.addEventListener("touchstart", () => {
      pressT = setTimeout(() => showListMenu(el.getAttribute("data-list-id")), 450);
    }, {passive:true});
    el.addEventListener("touchend", ()=> clearTimeout(pressT), {passive:true});
  });
}

async function showListMenu(listId){
  const l = lists.find(x=>x.id===listId);
  if(!l) return;
  openSheet(
    "Liste bearbeiten",
    `
      <div class="field">
        <label class="mini">Name</label>
        <input id="listTitle" class="input" value="${htmlesc(l.title)}" />
      </div>
      <div class="field">
        <label class="mini">Farbe</label>
        <input id="listColor" class="input" value="${htmlesc(l.color)}" />
        <div class="mini">z.B. #4aa3ff</div>
      </div>
      <div class="hr"></div>
      <button id="deleteList" class="smallbtn">Liste löschen</button>
    `,
    `<button id="saveList" class="smallbtn primary">Speichern</button>`
  );

  document.getElementById("saveList").onclick = async () => {
    const title = document.getElementById("listTitle").value.trim() || "Ohne Titel";
    const color = document.getElementById("listColor").value.trim() || "#4aa3ff";
    await dbPutList({ ...l, title, color });
    closeSheet();
    await renderListsView();
  };
  document.getElementById("deleteList").onclick = async () => {
    await dbDeleteList(listId);
    closeSheet();
    await renderListsView();
  };
}

async function promptNewList(){
  openSheet(
    "Neue Liste",
    `
      <div class="field">
        <label class="mini">Name</label>
        <input id="newListTitle" class="input" placeholder="z.B. Morgenroutine" />
      </div>
      <div class="field">
        <label class="mini">Farbe</label>
        <select id="newListColor" class="select">
          <option value="#4aa3ff">Blau</option>
          <option value="#78d353">Grün</option>
          <option value="#ff7a45">Orange</option>
          <option value="#d66bff">Lila</option>
          <option value="#ffd24a">Gelb</option>
        </select>
      </div>
    `,
    `<button id="createList" class="smallbtn primary">Erstellen</button>`
  );
  document.getElementById("createList").onclick = async () => {
    const title = document.getElementById("newListTitle").value.trim() || "Ohne Titel";
    const color = document.getElementById("newListColor").value;
    const order = (lists.at(-1)?.order ?? 0) + 1;
    await dbPutList({ id: uid(), title, color, order });
    closeSheet();
    await renderListsView();
  };
}

// ---------- Render: List ----------
async function openList(listId){
  await reloadLists();
  currentList = lists.find(x=>x.id===listId);
  await reloadItems(listId);
  renderListView();
}

function renderListView(){
  if(!currentList) return;
  titleEl.textContent = currentList.title;
  subtitleEl.textContent = "Tippen zum Schreiben • ⋯ für Aktionen • ≋ zum Ziehen";
  subtitleEl.classList.remove("hidden");
  backBtn.classList.remove("hidden");

  const visible = computeVisibleItems();
  const completedCount = items.filter(x=>x.completed).length;

  main.innerHTML = `
    <div class="card" style="padding:8px 12px; margin-bottom:10px; display:flex; justify-content:space-between;">
      <div class="mini">${visible.length} aktiv • ${completedCount} erledigt</div>
      <button id="toggleCompleted" class="smallbtn">${showCompleted ? "Erledigte ausblenden" : "Erledigte anzeigen"}</button>
    </div>

    <div class="card" style="padding:0;">
      <div id="listRows">
        ${visible.map(it => renderRow(it)).join("")}
        ${visible.length === 0 ? `<div class="row"><div class="mini">Noch keine Punkte. Tippe +</div></div>` : ""}
      </div>
    </div>
  `;

  document.getElementById("toggleCompleted").onclick = () => {
    showCompleted = !showCompleted;
    renderListView();
  };

  wireRowEvents();
  refreshTimersUI();
}

function renderRow(it){
  const pad = Math.min(it.depth, 5) * 18;
  const checked = it.completed ? "checked" : "";
  const checkMark = it.completed ? "✓" : "";

  const timer = it.timerEnabled ? `
    <div class="timerLine">
      <span class="pill">🕒 <span id="t_${it.id}">${fmtSec(getRemainingSec(it.id, it.lastDurationSec))}</span></span>
      <button class="smallbtn primary" data-act="timerStart" data-id="${it.id}">Start</button>
      <button class="smallbtn" data-act="timerEdit" data-id="${it.id}">Zeit</button>
      <button class="smallbtn" data-act="timerStop" data-id="${it.id}">Stop</button>
    </div>
  ` : "";

  const thumbs = (it.attachments?.length ?? 0) ? `
    <div class="attachThumbs">
      ${it.attachments.map(a => {
        if(a.kind === "image"){
          return `<div class="thumb" data-act="openAttach" data-id="${it.id}" data-aid="${a.id}">
            <img src="${a.dataUrl}" alt="bild" />
          </div>`;
        }
        return `<div class="thumb" data-act="playAudio" data-id="${it.id}" data-aid="${a.id}">
          <div class="audiotag">▶︎ Audio</div>
        </div>`;
      }).join("")}
    </div>
  ` : "";

  return `
    <div class="row" data-row-id="${it.id}">
      <div class="handle" data-handle="${it.id}">≋</div>
      <div class="chk ${checked}" data-act="toggle" data-id="${it.id}">
        <span>${checkMark}</span>
      </div>
      <div class="textWrap" style="padding-left:${pad}px">
        <input class="edit" data-act="edit" data-id="${it.id}" value="${htmlesc(it.text)}" placeholder="Neuer Punkt…" />
        <div class="mini">
          <span class="pill" style="display:${it.timerEnabled?'inline-flex':'none'};">Timer</span>
          <button class="btnlink" data-act="menu" data-id="${it.id}">⋯</button>
        </div>
        ${timer}
        ${thumbs}
      </div>
    </div>
  `;
}

// ---------- Row events ----------
function wireRowEvents(){
  main.querySelectorAll("[data-act='toggle']").forEach(el => {
    el.addEventListener("click", async () => {
      const id = el.getAttribute("data-id");
      const it = items.find(x=>x.id===id);
      if(!it) return;
      await updateItem({ id, completed: !it.completed });
      renderListView();
    });
  });

  main.querySelectorAll("input[data-act='edit']").forEach(inp => {
    inp.addEventListener("input", async () => {
      const id = inp.getAttribute("data-id");
      await updateItem({ id, text: inp.value });
    });
    inp.addEventListener("keydown", async (e) => {
      if(e.key === "Enter"){
        e.preventDefault();
        const id = inp.getAttribute("data-id");
        const it = items.find(x=>x.id===id);
        if(!it) return;
        const newIt = await addNewItem(it.listId, it.parentId, it.depth);
        renderListView();
        setTimeout(() => main.querySelector(`input[data-id="${newIt.id}"]`)?.focus(), 0);
      }
    });
  });

  main.querySelectorAll("[data-act='timerStart']").forEach(b => b.onclick = () => timerStart(b.dataset.id));
  main.querySelectorAll("[data-act='timerStop']").forEach(b => b.onclick = () => timerStop(b.dataset.id));
  main.querySelectorAll("[data-act='timerEdit']").forEach(b => b.onclick = () => timerEdit(b.dataset.id));

  main.querySelectorAll("[data-act='openAttach']").forEach(el => el.onclick = () => openAttachment(el.dataset.id, el.dataset.aid));
  main.querySelectorAll("[data-act='playAudio']").forEach(el => el.onclick = () => playAttachmentAudio(el.dataset.id, el.dataset.aid));

  main.querySelectorAll("[data-act='menu']").forEach(el => el.addEventListener("click", () => openItemMenu(el.dataset.id)));

  enableTouchDragReorder();
}

// ---------- Item menu ----------
function openItemMenu(itemId){
  const it = items.find(x=>x.id===itemId);
  if(!it) return;

  openSheet(
    "Punkt",
    `
      <div class="mini">Aktionen</div>
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px;">
        <button id="indentBtn" class="smallbtn">Einrücken</button>
        <button id="outdentBtn" class="smallbtn">Ausrücken</button>
        <button id="timerToggleBtn" class="smallbtn">${it.timerEnabled ? "Timer entfernen" : "Timer hinzufügen"}</button>
      </div>
      <div class="hr"></div>
      <div class="mini">Anhänge</div>
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px;">
        <button id="addPhotoBtn" class="smallbtn">Foto</button>
        <button id="addAudioBtn" class="smallbtn">MP3/Audio</button>
      </div>
      <div class="hr"></div>
      <button id="deleteBtn" class="smallbtn">Löschen</button>
    `
  );

  document.getElementById("indentBtn").onclick = async () => {
    const sibs = items.filter(x=>x.listId===it.listId && x.parentId===it.parentId).sort((a,b)=>a.order-b.order);
    const idx = sibs.findIndex(x=>x.id===it.id);
    if(idx>0 && it.depth < 5){
      const newParent = sibs[idx-1];
      await updateItem({ id: it.id, parentId: newParent.id, depth: it.depth+1, order: nextOrderFor(it.listId, newParent.id) });
      await reloadItems(currentList.id);
    }
    closeSheet();
    renderListView();
  };

  document.getElementById("outdentBtn").onclick = async () => {
    if(it.depth === 0) { closeSheet(); return; }
    const parent = items.find(x=>x.id===it.parentId);
    const newParentId = parent?.parentId ?? null;
    const newDepth = Math.max(0, it.depth-1);
    await updateItem({ id: it.id, parentId: newParentId, depth: newDepth, order: nextOrderFor(it.listId, newParentId) });
    await reloadItems(currentList.id);
    closeSheet();
    renderListView();
  };

  document.getElementById("timerToggleBtn").onclick = async () => {
    await updateItem({ id: it.id, timerEnabled: !it.timerEnabled });
    closeSheet();
    renderListView();
  };

  document.getElementById("deleteBtn").onclick = async () => {
    await deleteItemDeep(it.id);
    closeSheet();
    renderListView();
  };

  document.getElementById("addPhotoBtn").onclick = async () => {
    closeSheet();
    await addAttachment(it.id, "image");
  };
  document.getElementById("addAudioBtn").onclick = async () => {
    closeSheet();
    await addAttachment(it.id, "audio");
  };
}

// ---------- Attachments ----------
async function addAttachment(itemId, kind){
  const it = items.find(x=>x.id===itemId);
  if(!it) return;

  const input = document.createElement("input");
  input.type = "file";
  if(kind === "image"){
    input.accept = "image/*";
    input.capture = "environment";
  } else {
    input.accept = "audio/*,.mp3,.m4a,.wav";
  }

  input.onchange = async () => {
    const file = input.files?.[0];
    if(!file) return;

    const dataUrl = await fileToDataURL(file);
    const a = {
      id: uid(),
      kind: kind === "image" ? "image" : "audio",
      name: file.name || (kind === "image" ? "photo" : "audio"),
      mime: file.type || "",
      dataUrl
    };
    const attachments = [...(it.attachments ?? []), a].slice(0, 10);
    await updateItem({ id: it.id, attachments });
    await reloadItems(currentList.id);
    renderListView();
  };

  input.click();
}

function fileToDataURL(file){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function openAttachment(itemId, attachId){
  const it = items.find(x=>x.id===itemId);
  const a = it?.attachments?.find(x=>x.id===attachId);
  if(!a) return;
  openSheet(a.name || "Bild", `<div class="bigPreview"><img src="${a.dataUrl}" alt="preview" /></div>`);
}

function playAttachmentAudio(itemId, attachId){
  const it = items.find(x=>x.id===itemId);
  const a = it?.attachments?.find(x=>x.id===attachId);
  if(!a) return;

  openSheet(
    a.name || "Audio",
    `
      <audio controls style="width:100%;">
        <source src="${a.dataUrl}" type="${a.mime || "audio/mpeg"}" />
      </audio>
      <div class="mini" style="margin-top:10px;">Offline abspielbar.</div>
    `
  );
}

// ---------- Timer ----------
function getRemainingSec(itemId, fallback){
  const t = runningTimers.get(itemId);
  if(!t) return fallback;
  const left = Math.ceil((t.endAtMs - Date.now())/1000);
  return Math.max(0, left);
}

function timerStart(itemId){
  const it = items.find(x=>x.id===itemId);
  if(!it) return;

  timerStop(itemId);

  const dur = it.lastDurationSec ?? 600;
  const endAtMs = Date.now() + dur*1000;

  const intervalId = setInterval(() => {
    const left = Math.ceil((endAtMs - Date.now())/1000);
    const el = document.getElementById(`t_${itemId}`);
    if(el) el.textContent = fmtSec(left);
    if(left <= 0){
      clearInterval(intervalId);
      runningTimers.delete(itemId);
      fireAlarm();
      refreshTimersUI();
    }
  }, 250);

  runningTimers.set(itemId, { endAtMs, intervalId });
  refreshTimersUI();
}

function timerStop(itemId){
  const t = runningTimers.get(itemId);
  if(t){
    clearInterval(t.intervalId);
    runningTimers.delete(itemId);
  }
  refreshTimersUI();
}

function stopAllTimersUIOnly(){
  for(const [,t] of runningTimers.entries()){
    clearInterval(t.intervalId);
  }
  runningTimers.clear();
}

function fireAlarm(){
  try {
    alarmAudio.currentTime = 0;
    alarmAudio.play().catch(()=>{});
  } catch {}
  vibrate();
}

async function timerEdit(itemId){
  const it = items.find(x=>x.id===itemId);
  if(!it) return;

  const cur = it.lastDurationSec ?? 600;
  const curMin = Math.floor(cur/60);
  const curSec = cur%60;

  openSheet(
    "Zeit einstellen",
    `
      <div class="field">
        <label class="mini">Minuten</label>
        <input id="mins" class="input" inputmode="numeric" value="${curMin}" />
      </div>
      <div class="field">
        <label class="mini">Sekunden</label>
        <input id="secs" class="input" inputmode="numeric" value="${curSec}" />
      </div>
      <div class="mini">Wird pro Punkt gespeichert (zuletzt benutzt).</div>
    `,
    `<button id="saveTime" class="smallbtn primary">Speichern</button>`
  );

  document.getElementById("saveTime").onclick = async () => {
    const mins = Math.max(0, parseInt(document.getElementById("mins").value || "0", 10));
    const secs = Math.max(0, parseInt(document.getElementById("secs").value || "0", 10));
    const total = Math.min(60*60, mins*60 + secs);
    await updateItem({ id: it.id, lastDurationSec: total || 1 });
    closeSheet();
    renderListView();
  };
}

function refreshTimersUI(){
  for(const it of items){
    if(!it.timerEnabled) continue;
    const el = document.getElementById(`t_${it.id}`);
    if(el){
      el.textContent = fmtSec(getRemainingSec(it.id, it.lastDurationSec ?? 600));
    }
  }
}

// ---------- Touch drag reorder (gleiche Ebene / gleicher Parent) ----------
function enableTouchDragReorder(){
  const handles = main.querySelectorAll("[data-handle]");
  handles.forEach(h => {
    const id = h.getAttribute("data-handle");
    let startY = 0;
    let dragging = false;

    h.addEventListener("touchstart", (e) => {
      startY = e.touches[0].clientY;
      dragging = true;
    }, {passive:true});

    h.addEventListener("touchmove", (e) => {
      if(!dragging) return;
      const y = e.touches[0].clientY;
      const dy = y - startY;
      if(Math.abs(dy) < 18) return;

      const it = items.find(x=>x.id===id);
      if(!it) return;

      const visibleSame = computeVisibleItems().filter(v => v.parentId === it.parentId);
      const idx = visibleSame.findIndex(v=>v.id===id);
      const dir = dy > 0 ? 1 : -1;
      const newIdx = idx + dir;
      if(newIdx < 0 || newIdx >= visibleSame.length) return;

      const a = visibleSame[idx];
      const b = visibleSame[newIdx];
      const ao = a.order, bo = b.order;
      a.order = bo; b.order = ao;

      Promise.all([dbPutItem(a), dbPutItem(b)]).then(async () => {
        await reloadItems(currentList.id);
        renderListView();
      });

      startY = y;
    }, {passive:true});

    h.addEventListener("touchend", () => {
      dragging = false;
    }, {passive:true});
  });
}

// ---------- Start ----------
async function render(){
  if(view.name === "lists"){
    await renderListsView();
  } else {
    await openList(view.listId);
  }
}

(async function boot(){
  await ensureSeed();
  const s = await dbGetSetting("alarmSound", null);
  if(!s) await dbSetSetting("alarmSound", "sounds/soft.mp3");
  await render();
})();
