// db.js
const DB_NAME = "ReminderDB";
const DB_VERSION = 2; // <-- bump
const STORE_NAME = "Reminders";
const ARCHIVE_STORE_NAME = "ArchivedReminders";
const SETTINGS_STORE_NAME = "Settings";

let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = (event) => reject("Error opening DB");

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      db = event.target.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "uuid" });
      }

      // NEW: archive store, same keyPath/fields
      if (!db.objectStoreNames.contains(ARCHIVE_STORE_NAME)) {
        db.createObjectStore(ARCHIVE_STORE_NAME, { keyPath: "uuid" });
      }

      // NEW: settings KV store
      if (!db.objectStoreNames.contains(SETTINGS_STORE_NAME)) {
        db.createObjectStore(SETTINGS_STORE_NAME, { keyPath: "key" });
      }
    };
  });
}

function addTask(task) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.add(task);
    req.onsuccess = () => resolve(task);
    req.onerror = (e) => reject("Error adding task");
  });
}

function updateTask(task) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(task);
    req.onsuccess = () => resolve(task);
    req.onerror = () => reject("Error updating task");
  });
}

function deleteTask(uuid) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(uuid);
    req.onsuccess = () => resolve(uuid);
    req.onerror = () => reject("Error deleting task");
  });
}

function getAllTasks() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = (event) => resolve(event.target.result);
    req.onerror = () => reject("Error fetching tasks");
  });
}

// NEW: archive ops
function archiveTask(task) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, ARCHIVE_STORE_NAME], "readwrite");
    const active = tx.objectStore(STORE_NAME);
    const archive = tx.objectStore(ARCHIVE_STORE_NAME);

    // write to archive then delete from active
    const putReq = archive.put(task);
    putReq.onerror = () => reject("Error archiving task");
    putReq.onsuccess = () => {
      const delReq = active.delete(task.uuid);
      delReq.onerror = () => reject("Error removing from active store");
      delReq.onsuccess = () => resolve(task.uuid);
    };
  });
}

function getAllArchived() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([ARCHIVE_STORE_NAME], "readonly");
    const store = tx.objectStore(ARCHIVE_STORE_NAME);
    const req = store.getAll();
    req.onsuccess = (event) => resolve(event.target.result);
    req.onerror = () => reject("Error fetching archived");
  });
}

// NEW: settings ops
function setSetting(key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([SETTINGS_STORE_NAME], "readwrite");
    const store = tx.objectStore(SETTINGS_STORE_NAME);
    const req = store.put({ key, value });
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject("Error saving setting");
  });
}

function getSetting(key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([SETTINGS_STORE_NAME], "readonly");
    const store = tx.objectStore(SETTINGS_STORE_NAME);
    const req = store.get(key);
    req.onsuccess = (event) => resolve(event.target.result ? event.target.result.value : undefined);
    req.onerror = () => reject("Error reading setting");
  });
}

window.dbAPI = {
  openDB, addTask, updateTask, deleteTask, getAllTasks,
  archiveTask, getAllArchived,
  setSetting, getSetting,
  storeName: STORE_NAME
};
