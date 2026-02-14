const DB_NAME = "morning_pwa_db";
const DB_VER = 1;

function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);

    req.onupgradeneeded = () => {
      const db = req.result;

      if(!db.objectStoreNames.contains("lists")){
        const s = db.createObjectStore("lists", { keyPath: "id" });
        s.createIndex("order", "order", { unique:false });
      }

      if(!db.objectStoreNames.contains("items")){
        const s = db.createObjectStore("items", { keyPath: "id" });
        s.createIndex("byList", "listId", { unique:false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function dbGetAllLists(){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = db.transaction("lists").objectStore("lists");
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function dbPutList(list){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = db.transaction("lists", "readwrite").objectStore("lists");
    const req = store.put(list);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function dbGetItemsForList(listId){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = db.transaction("items").objectStore("items");
    const req = store.getAll();
    req.onsuccess = () => {
      const filtered = req.result.filter(x => x.listId === listId);
      resolve(filtered);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function dbPutItem(item){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = db.transaction("items", "readwrite").objectStore("items");
    const req = store.put(item);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export function uid(){
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
