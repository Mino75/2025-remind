// db.js
const DB_NAME = "ReminderDB";
const DB_VERSION = 1;
const STORE_NAME = "Reminders";

let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = (event) => {
      console.error("IndexedDB error:", event);
      reject("Error opening DB");
    };
    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };
    request.onupgradeneeded = (event) => {
      db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "uuid" });
      }
    };
  });
}

function addTask(task) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.add(task);
    request.onsuccess = () => resolve(task);
    request.onerror = (e) => reject("Error adding task", e);
  });
}

function updateTask(task) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(task);
    request.onsuccess = () => resolve(task);
    request.onerror = (e) => reject("Error updating task", e);
  });
}

function deleteTask(uuid) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(uuid);
    request.onsuccess = () => resolve(uuid);
    request.onerror = (e) => reject("Error deleting task", e);
  });
}

function getAllTasks() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (e) => reject("Error fetching tasks", e);
  });
}

// Expose DB functions to other scripts
window.dbAPI = { openDB, addTask, updateTask, deleteTask, getAllTasks };
