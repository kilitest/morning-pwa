const DB_NAME = "morning_pwa_db";
const DB_VER = 1;

function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);

    req.onupgradeneeded = () => {
      const db = req.result;

      // lists: { id, title, color, order }
      if(!db.objectStoreNames.contains("lists")){
        const s = db.createObjectStore("lists", { keyPath: "id" });
        s.createIndex("order", "order", { unique:false });
      }

      // items: { id, listId, parentId, depth, order, text, completed, timerEnabled, lastDurationSec, attachments:[] }
      if(!db.objectStoreNames.contains("items")){
        const s = db.createObjectStore("items", { keyPath: "id" });
        s.createIndex("byList", "listId", { unique:false });
        s.createIndex("byParent", "parentId", { unique:false });
        s.createIndex("byListOrder", ["listId","order"], { unique:false });
      }

      // settings: { key, value }
      if(!db.objectStoreNames.contains("settings")){
        db.createObjectStore("settings", { keyPath: "key" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, storeName, mode="readonly"){
  return db.transaction(storeName, mode).objectStore(storeName);
}

export async function dbGetAllLists(){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = tx(db, "lists");
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result.sort((a,b)=>a.order-b.order));
    req.onerror = () => reject(req.error);
  });
}

export async function dbPutList(list){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = tx(db, "lists", "readwrite");
    const req = store.put(list);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function dbDeleteList(listId){
  const db = await openDB();
  const listsTx = db.transaction(["lists","items"], "readwrite");
  const listsStore = listsTx.objectStore("lists");
  const itemsStore = listsTx.objectStore("items");

  return new Promise((resolve, reject) => {
    listsStore.delete(listId);
    const idx = itemsStore.index("byList");
    const req = idx.getAll(listId);
    req.onsuccess = () => {
      for(const it of req.result){
        itemsStore.delete(it.id);
      }
    };
    listsTx.oncomplete = () => resolve(true);
    listsTx.onerror = () => reject(listsTx.error);
  });
}

export async function dbGetItemsForList(listId){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = tx(db, "items");
    const idx = store.index("byList");
    const req = idx.getAll(listId);
    req.onsuccess = () => resolve(req.result.sort((a,b)=>a.order-b.order));
    req.onerror = () => reject(req.error);
  });
}

export async function dbPutItem(item){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = tx(db, "items", "readwrite");
    const req = store.put(item);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function dbDeleteItem(itemId){
  const db = await openDB();
  const t = db.transaction(["items"], "readwrite");
  const store = t.objectStore("items");
  return new Promise((resolve, reject) => {
    store.delete(itemId);
    t.oncomplete = () => resolve(true);
    t.onerror = () => reject(t.error);
  });
}

export async function dbGetSetting(key, fallback=null){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = tx(db, "settings");
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result?.value ?? fallback);
    req.onerror = () => reject(req.error);
  });
}

export async function dbSetSetting(key, value){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = tx(db, "settings", "readwrite");
    const req = store.put({ key, value });
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export function uid(){
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
