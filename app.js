import {
  dbGetAllLists, dbPutList, dbDeleteList,
  dbGetItemsForList, dbPutItem, dbDeleteItem,
  dbGetSetting, dbSetSetting, uid
} from "./db.js";

const main = document.getElementById("main");
const backBtn = document.getElementById("backBtn");
const addBtn  = document.getElementById("addBtn");
const titleEl = document.getElementById("title");

const alarmAudio = document.getElementById("alarmAudio");

let view = { name:"lists", listId:null };
let lists = [];
let items = [];
let currentList = null;

let runningTimers = new Map();

function fmtSec(sec){
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec/60);
  const s = sec%60;
  return `${m}:${String(s).padStart(2,"0")}`;
}

async function ensureSeed(){
  lists = await dbGetAllLists();
  if(lists.length === 0){
    const seed = [
      { id: uid(), title:"To-dos", color:"#4aa3ff", order:1 },
      { id: uid(), title:"Sport",  color:"#78d353", order:2 }
    ];
    for(const l of seed) await dbPutList(l);
  }
}

async function reloadLists(){
  lists = await dbGetAllLists();
}

async function reloadItems(listId){
  items = await dbGetItemsForList(listId);
}

function render(){
  if(view.name === "lists"){
    renderLists();
  } else {
    renderList();
  }
}

async function renderLists(){
  await reloadLists();
  titleEl.textContent = "Listen";
  backBtn.classList.add("hidden");

  main.innerHTML = `
    ${lists.map(l => `
      <div class="card" data-id="${l.id}">
        <strong>${l.title}</strong>
      </div>
    `).join("")}
  `;

  main.querySelectorAll(".card").forEach(el => {
    el.onclick = async () => {
      view = { name:"list", listId:el.dataset.id };
      await openList(el.dataset.id);
    };
  });
}

async function openList(id){
  currentList = lists.find(l => l.id === id);
  await reloadItems(id);
  renderList();
}

function renderList(){
  titleEl.textContent = currentList.title;
  backBtn.classList.remove("hidden");

  main.innerHTML = `
    ${items.map(it => `
      <div class="row">
        <div class="chk" data-id="${it.id}"></div>
        <input class="edit" data-id="${it.id}" value="${it.text}" />
        ${it.timerEnabled ? `
          <button data-timer="${it.id}">${fmtSec(it.lastDurationSec)}</button>
        ` : ""}
      </div>
    `).join("")}
  `;

  wireEvents();
}

function wireEvents(){

  main.querySelectorAll(".edit").forEach(inp => {
    inp.oninput = async () => {
      const id = inp.dataset.id;
      const it = items.find(x => x.id === id);
      it.text = inp.value;
      await dbPutItem(it);
    };
  });

  main.querySelectorAll(".chk").forEach(chk => {
    chk.onclick = async () => {
      const id = chk.dataset.id;
      await dbDeleteItem(id);
      await reloadItems(currentList.id);
      renderList();
    };
  });

  main.querySelectorAll("[data-timer]").forEach(btn => {
    btn.onclick = () => startTimer(btn.dataset.timer);
  });
}

async function startTimer(itemId){
  const it = items.find(x=>x.id===itemId);
  if(!it) return;

  let sec = it.lastDurationSec || 60;
  const end = Date.now() + sec*1000;

  const interval = setInterval(() => {
    const left = Math.ceil((end-Date.now())/1000);
    if(left <= 0){
      clearInterval(interval);
      alarmAudio.play();
    }
  }, 200);
}

addBtn.onclick = async () => {
  if(view.name === "lists"){
    const newList = { id:uid(), title:"Neue Liste", color:"#4aa3ff", order:lists.length+1 };
    await dbPutList(newList);
    render();
  } else {
    const newItem = {
      id:uid(),
      listId:currentList.id,
      text:"Neuer Punkt",
      timerEnabled:true,
      lastDurationSec:60
    };
    await dbPutItem(newItem);
    await reloadItems(currentList.id);
    renderList();
  }
};

backBtn.onclick = () => {
  view = { name:"lists", listId:null };
  render();
};

(async function init(){
  await ensureSeed();
  render();
})();
