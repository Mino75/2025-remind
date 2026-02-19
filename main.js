// main.js (single-file, production-safe)
// - Includes IndexedDB layer (formerly db.js) + UI logic in one file
// - No DB schema changes: DB_VERSION=2, stores remain: Reminders / ArchivedReminders / Settings
// - Removes profile/gamification/HUD + removes archive feature usage
// - Keeps all tasks in Reminders; hides deactivated by default with a UI filter toggle
// - On reach can trigger: (1) intent/deeplink (best-effort), (2) iframe overlay + postMessage payload + wait ACK

(() => {
  // =========================
  // IndexedDB (inlined db.js)
  // =========================
  const DB_NAME = "ReminderDB";
  const DB_VERSION = 2;
  const STORE_NAME = "Reminders";
  const ARCHIVE_STORE_NAME = "ArchivedReminders"; // exists in prod schema; not used by UI
  const SETTINGS_STORE_NAME = "Settings";         // exists in prod schema; not used by UI

  let db;

  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(new Error("Error opening DB"));
      request.onsuccess = (event) => {
        db = event.target.result;
        resolve(db);
      };
      request.onupgradeneeded = (event) => {
        db = event.target.result;

        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "uuid" });
        }
        if (!db.objectStoreNames.contains(ARCHIVE_STORE_NAME)) {
          db.createObjectStore(ARCHIVE_STORE_NAME, { keyPath: "uuid" });
        }
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
      req.onerror = () => reject(new Error("Error adding task"));
    });
  }

  function updateTask(task) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(task);
      req.onsuccess = () => resolve(task);
      req.onerror = () => reject(new Error("Error updating task"));
    });
  }

  function deleteTask(uuid) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(uuid);
      req.onsuccess = () => resolve(uuid);
      req.onerror = () => reject(new Error("Error deleting task"));
    });
  }

  function getAllTasks() {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = (event) => resolve(event.target.result || []);
      req.onerror = () => reject(new Error("Error fetching tasks"));
    });
  }

  function clearAllTasks() {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(new Error("Error clearing tasks"));
    });
  }

  async function setTaskDeactivated(uuid, deactivated) {
    const all = await getAllTasks();
    const t = all.find(x => x.uuid === uuid);
    if (!t) return false;
    t.deactivated = !!deactivated; // schema-safe optional field
    t.modificationDate = Date.now();
    await updateTask(t);
    return true;
  }

  // Expose for backward compatibility if anything else references it
  window.dbAPI = {
    openDB, addTask, updateTask, deleteTask, getAllTasks,
    clearAllTasks, setTaskDeactivated,
    storeName: STORE_NAME
  };

  // =========================
  // UI / App logic
  // =========================
  document.addEventListener("DOMContentLoaded", async () => {
    await openDB();

    // ---------- DOM handles ----------
    const searchInput = document.getElementById("search-input");
    const sortSelect = document.getElementById("sort-select");
    const addButton = document.getElementById("add-button");
    const exportButton = document.getElementById("export-button");
    const importButton = document.getElementById("import-button");
    const clearButton = document.getElementById("clear-button");
    const importFileInput = document.getElementById("import-file");
    const remindersTableBody = document.querySelector("#reminders-table tbody");

    // Modal elements (existing)
    const modal = document.getElementById("modal");
    const closeModal = document.getElementById("close-modal");
    const reminderForm = document.getElementById("reminder-form");
    const reminderIdField = document.getElementById("reminder-id");
    const reminderCreationDateField = document.getElementById("reminder-creationDate");
    const reminderNameField = document.getElementById("reminder-name");
    const reminderDescField = document.getElementById("reminder-desc");
    const reminderTypeField = document.getElementById("reminder-type");
    const reminderDueDateField = document.getElementById("reminder-dueDate");
    const reminderPriorityField = document.getElementById("reminder-priority");

    // Frequency section (existing)
    const frequencySection = document.getElementById("frequency-section");
    const freqOptionRadios = document.getElementsByName("frequency-option");
    const fixedFrequencyDiv = document.getElementById("fixed-frequency");
    const fixedMonthField = document.getElementById("fixed-month");
    const fixedDayField = document.getElementById("fixed-day");
    const fixedHourField = document.getElementById("fixed-hour");
    const fixedMinuteField = document.getElementById("fixed-minute");
    const fixedDisplayDiv = document.getElementById("fixed-display");

    const cronBuilderDiv = document.getElementById("cron-builder");
    const cronDisplayDiv = document.getElementById("cron-display");
    const cronFieldSelects = document.querySelectorAll(".cron-field");
    const cronInputs = document.querySelectorAll(".cron-input");

    // Inject: deactivated filter toggle + iframe overlay + action fields in form
    const showDeactivatedToggle = injectShowDeactivatedToggle(sortSelect);
    injectIFrameActionOverlay();
    const actionFields = injectActionFieldsIntoForm(reminderForm);

    // Runtime trigger guard (prevents re-trigger loops)
    const firedPunctual = new Set(); // uuid
    const lastFreqFireAt = new Map(); // uuid -> ms (debounce)

    // ---------- Event wiring ----------
    reminderTypeField.addEventListener("change", () => {
      if (reminderTypeField.value === "frequency") {
        frequencySection.style.display = "block";
        reminderDueDateField.style.display = "none";
      } else {
        frequencySection.style.display = "none";
        reminderDueDateField.style.display = "block";
      }
    });
    reminderTypeField.dispatchEvent(new Event("change"));

    Array.from(freqOptionRadios).forEach(radio => {
      radio.addEventListener("change", () => {
        if (radio.value === "fixed" && radio.checked) {
          fixedFrequencyDiv.style.display = "block";
          cronBuilderDiv.style.display = "none";
          updateFixedDisplay();
        } else if (radio.value === "cron" && radio.checked) {
          fixedFrequencyDiv.style.display = "none";
          cronBuilderDiv.style.display = "block";
          updateCronDisplay();
        }
      });
    });

    cronFieldSelects.forEach(select => {
      select.addEventListener("change", () => {
        const field = select.getAttribute("data-field");
        const input = document.querySelector(`.cron-input[data-field="${field}"]`);
        if (select.value === "at") input.style.display = "inline-block";
        else input.style.display = "none";
        updateCronDisplay();
      });
    });
    cronInputs.forEach(input => input.addEventListener("input", updateCronDisplay));
    [fixedMonthField, fixedDayField, fixedHourField, fixedMinuteField].forEach(el => el.addEventListener("input", updateFixedDisplay));

    addButton.addEventListener("click", () => openAddModal());

    closeModal.addEventListener("click", () => { modal.style.display = "none"; });
    window.addEventListener("click", (event) => { if (event.target === modal) modal.style.display = "none"; });

    searchInput.addEventListener("input", loadReminders);
    sortSelect.addEventListener("change", loadReminders);
    showDeactivatedToggle.addEventListener("change", loadReminders);

    reminderForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const now = Date.now();

      const type = reminderTypeField.value;
      let dueTime;
      let frequencyDisplay = "-";

      if (type === "frequency") {
        const selectedOptionEl = document.querySelector('input[name="frequency-option"]:checked');
        const selectedOption = selectedOptionEl ? selectedOptionEl.value : "fixed";

        if (selectedOption === "fixed") {
          const month = parseInt(fixedMonthField.value, 10);
          const day = parseInt(fixedDayField.value, 10);
          const hour = parseInt(fixedHourField.value, 10);
          const minute = parseInt(fixedMinuteField.value, 10);

          if (
            Number.isNaN(month) || month < 1 || month > 12 ||
            Number.isNaN(day) || day < 1 || day > 31 ||
            Number.isNaN(hour) || hour < 0 || hour > 23 ||
            Number.isNaN(minute) || minute < 0 || minute > 59
          ) {
            alert("Please enter valid fixed date values.");
            return;
          }

          dueTime = computeNextOccurrenceFixed(month, day, hour, minute);
          const frequencyMinutes = Math.max(1, Math.round((dueTime - now) / 60000));
          frequencyDisplay = `${frequencyMinutes} min (Fixed: ${minute} ${hour} on ${day}/${month})`;
        } else {
          const cronString = cronDisplayDiv.textContent.replace("Cron: ", "").trim();
          dueTime = computeNextOccurrence(cronString);
          const frequencyMinutes = Math.max(1, Math.round((dueTime - now) / 60000));
          frequencyDisplay = `${frequencyMinutes} min (Cron: ${cronString})`;
        }
      } else {
        const dueDateValue = reminderDueDateField.value;
        if (!dueDateValue) {
          alert("Please select a due date and time.");
          return;
        }
        dueTime = new Date(dueDateValue).getTime();
      }

      // Action model:
      // - actionMode: "none" | "intent" | "iframe-post"
      // - actionUrl: target URL / deep link / intent
      // - actionPayload: string payload (raw or JSON string)
      // - actionAckKey: optional ack key
      const actionMode = actionFields.mode.value || "none";
      let actionUrl = (actionFields.url.value || "").trim();
      const actionPayload = (actionFields.payload.value || "").trim();
      const actionAckKey = (actionFields.ackKey.value || "").trim();

      if (actionMode !== "none") {
        if (!actionUrl) {
          alert("Action requires a target URL / intent.");
          return;
        }
        actionUrl = normalizeUrl(actionUrl);
      } else {
        actionUrl = "";
      }

      // Keep DB record schema stable; only add optional fields
      const reminder = {
        uuid: reminderIdField.value || generateUUID(),
        name: reminderNameField.value,
        description: reminderDescField.value,
        type: type,
        frequency: type === "frequency" ? frequencyDisplay : "-",
        dueTime: dueTime,
        priority: reminderPriorityField.value,
        modificationDate: now,

        // New optional fields (schema-safe)
        deactivated: false,
        actionMode,
        actionUrl,
        actionPayload,
        actionAckKey
      };

      if (reminderIdField.value) {
        // preserve original creation date
        reminder.creationDate = parseInt(reminderCreationDateField.value, 10);
        // preserve existing deactivated unless edited via toggle
        const existing = await getTaskByUuid(reminder.uuid);
        if (existing && typeof existing.deactivated === "boolean") reminder.deactivated = existing.deactivated;
        await updateTask(reminder);
      } else {
        reminder.creationDate = now;
        await addTask(reminder);
      }

      modal.style.display = "none";
      await loadReminders();
    });

    exportButton.addEventListener("click", async () => {
      const reminders = await getAllTasks();
      const dataStr = JSON.stringify(reminders, null, 2);
      const blob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "reminders_export.json";
      a.click();
      URL.revokeObjectURL(url);
    });

    importButton.addEventListener("click", () => importFileInput.click());

    importFileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const importedReminders = JSON.parse(event.target.result);
          const existingReminders = await getAllTasks();
          const existingMap = new Map();
          existingReminders.forEach(r => existingMap.set(r.uuid, r));
          for (const rem of importedReminders) {
            if (!rem || !rem.uuid) continue;
            existingMap.set(rem.uuid, rem);
          }
          const merged = Array.from(existingMap.values());
          for (const rem of merged) {
            if (existingReminders.some(r => r.uuid === rem.uuid)) {
              await updateTask(rem);
            } else {
              await addTask(rem);
            }
          }
          await loadReminders();
        } catch (err) {
          console.error("Error importing reminders:", err);
          alert("Failed to import reminders. Please check the file format.");
        }
      };
      reader.readAsText(file);
      importFileInput.value = "";
    });

    clearButton.addEventListener("click", async () => {
      if (confirm("Are you sure you want to clear all reminders? This cannot be undone.")) {
        try {
          await clearAllTasks();
          alert("All reminders have been cleared.");
          await loadReminders();
        } catch (error) {
          console.error("Error during clear operation:", error);
          alert("Failed to clear reminders.");
        }
      }
    });

    // ---------- Countdown updates + triggering ----------
    setInterval(() => {
      const now = Date.now();
      document.querySelectorAll(".countdown").forEach(cell => {
        let dueTime = parseInt(cell.getAttribute("data-duetime"), 10);
        const type = cell.getAttribute("data-type");
        const uuid = cell.getAttribute("data-uuid");
        const deactivated = cell.getAttribute("data-deactivated") === "true";

        // reschedule frequency tasks when due
        if (type === "frequency" && (dueTime - now <= 0)) {
          const freqOption = cell.getAttribute("data-freq-option");
          if (freqOption === "fixed") {
            const month = parseInt(cell.getAttribute("data-fixed-month"), 10);
            const day = parseInt(cell.getAttribute("data-fixed-day"), 10);
            const hour = parseInt(cell.getAttribute("data-fixed-hour"), 10);
            const minute = parseInt(cell.getAttribute("data-fixed-minute"), 10);
            dueTime = computeNextOccurrenceFixed(month, day, hour, minute);
          } else if (freqOption === "cron") {
            const cronString = cell.getAttribute("data-cron-string");
            dueTime = computeNextOccurrence(cronString);
          }
          cell.setAttribute("data-duetime", String(dueTime));

          // trigger each occurrence (debounced to avoid multiple fires in same second)
          if (!deactivated && uuid) {
            const last = lastFreqFireAt.get(uuid) || 0;
            if (now - last > 1500) {
              lastFreqFireAt.set(uuid, now);
              triggerTaskAction(uuid).catch(() => {});
            }
          }
        }

        // trigger punctual once
        if (type === "punctual" && (dueTime - now <= 0) && uuid && !deactivated) {
          if (!firedPunctual.has(uuid)) {
            firedPunctual.add(uuid);
            triggerTaskAction(uuid).catch(() => {});
          }
        }

        cell.textContent = formatCountdown(dueTime - now);
      });
    }, 1000);

    // ---------- Core load/render ----------
    await loadReminders();

    async function loadReminders() {
      let reminders = await getAllTasks();
      const now = Date.now();

      // Hide deactivated by default
      const showDeactivated = !!showDeactivatedToggle.checked;
      reminders = reminders.filter(r => showDeactivated ? true : !r.deactivated);

      // Search
      const searchTerm = (searchInput.value || "").toLowerCase();
      if (searchTerm) {
        reminders = reminders.filter(r => (r.name || "").toLowerCase().includes(searchTerm));
      }

      // Sort
      const sortValue = sortSelect.value;
      if (sortValue === "remaining-asc") {
        reminders.sort((a, b) => (a.dueTime - now) - (b.dueTime - now));
      } else if (sortValue === "remaining-desc") {
        reminders.sort((a, b) => (b.dueTime - now) - (a.dueTime - now));
      } else if (sortValue === "name-asc") {
        reminders.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      } else if (sortValue === "name-desc") {
        reminders.sort((a, b) => (b.name || "").localeCompare(a.name || ""));
      }

      renderReminders(reminders);
    }

    function renderReminders(reminders) {
      const theadRow = document.querySelector("#reminders-table thead tr");
      if (theadRow) {
        theadRow.innerHTML = `
          <th>Countdown</th>
          <th>Title</th>
          <th>Event Date/Time</th>
          <th>Priority</th>
          <th>Description</th>
          <th>Status</th>
          <th>Action</th>
        `;
      }

      remindersTableBody.innerHTML = "";

      reminders.slice(0, 50).forEach(reminder => {
        const priorityClass =
          reminder.priority === "high" ? "priority priority-high" :
          reminder.priority === "medium" ? "priority priority-medium" :
          "priority priority-low";

        const eventDateString = new Date(reminder.dueTime).toLocaleString();

        // For frequency reminders: keep parsing to reschedule (no schema change)
        let extraDataAttrs = "";
        if (reminder.type === "frequency") {
          if ((reminder.frequency || "").includes("Fixed:")) {
            const fixedPart = reminder.frequency.split("Fixed:")[1]?.trim() || "";
            const parts = fixedPart.split(" ");
            if (parts.length >= 4) {
              const fixedMinute = parts[0];
              const fixedHour = parts[1];
              const dm = parts[3].split("/");
              if (dm.length === 2) {
                const fixedDay = dm[0];
                const fixedMonth = dm[1];
                extraDataAttrs = `data-freq-option="fixed" data-fixed-month="${escapeHtmlAttr(fixedMonth)}" data-fixed-day="${escapeHtmlAttr(fixedDay)}" data-fixed-hour="${escapeHtmlAttr(fixedHour)}" data-fixed-minute="${escapeHtmlAttr(fixedMinute)}"`;
              }
            }
          } else if ((reminder.frequency || "").includes("Cron:")) {
            const cronPart = reminder.frequency.split("Cron:")[1].replace(")", "").trim();
            extraDataAttrs = `data-freq-option="cron" data-cron-string="${escapeHtmlAttr(cronPart)}"`;
          }
        }

        const countdownCell = `
          <td class="countdown"
              data-uuid="${escapeHtmlAttr(reminder.uuid)}"
              data-duetime="${reminder.dueTime}"
              data-type="${escapeHtmlAttr(reminder.type)}"
              data-deactivated="${reminder.deactivated ? "true" : "false"}"
              ${extraDataAttrs}>
            ${formatCountdown(reminder.dueTime - Date.now())}
          </td>
        `;

        const statusLabel = reminder.deactivated ? "Deactivated" : "Active";
        const statusBtnLabel = reminder.deactivated ? "Activate" : "Deactivate";
        const actionLabel = renderActionLabel(reminder);

        const tr = document.createElement("tr");
        tr.classList.add("reminder-row");
        tr.setAttribute("data-uuid", reminder.uuid);

        tr.innerHTML = `
          ${countdownCell}
          <td class="important-data">${escapeHtml(reminder.name || "")}</td>
          <td class="important-data">${escapeHtml(eventDateString)}</td>
          <td class="${priorityClass}">${escapeHtml(reminder.priority || "")}</td>
          <td>${escapeHtml(reminder.description || "")}</td>
          <td>
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="color:${reminder.deactivated ? "#888" : "#ddd"};">${statusLabel}</span>
              <button class="toggle-btn" data-action="toggle-active" style="padding:6px 8px;">
                ${statusBtnLabel}
              </button>
            </div>
          </td>
          <td>${actionLabel}</td>
        `;

        // Edit on row click (excluding buttons)
        tr.addEventListener("click", async (evt) => {
          const target = evt.target;
          if (target && target.closest?.("button")) return;
          const full = await getTaskByUuid(reminder.uuid);
          if (full) openEditModal(full);
        });

        // Deactivate / Activate
        const toggleBtn = tr.querySelector('[data-action="toggle-active"]');
        if (toggleBtn) {
          toggleBtn.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await setTaskDeactivated(reminder.uuid, !reminder.deactivated);
            await loadReminders();
          });
        }

        // Action buttons
        const intentBtn = tr.querySelector('[data-action="intent"]');
        if (intentBtn) {
          intentBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (reminder.actionUrl) window.open(reminder.actionUrl, "_blank", "noopener,noreferrer");
          });
        }

        const iframeBtn = tr.querySelector('[data-action="iframe"]');
        if (iframeBtn) {
          iframeBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            runIFramePostAction({
              url: reminder.actionUrl,
              payloadText: reminder.actionPayload || "",
              ackKey: reminder.actionAckKey || ""
            }).catch(() => {});
          });
        }

        remindersTableBody.appendChild(tr);
      });
    }

    async function getTaskByUuid(uuid) {
      const all = await getAllTasks();
      return all.find(r => r.uuid === uuid) || null;
    }

    async function triggerTaskAction(uuid) {
      const task = await getTaskByUuid(uuid);
      if (!task || task.deactivated) return;

      const mode = task.actionMode || "none";
      const url = (task.actionUrl || "").trim();

      if (mode === "intent") {
        if (!url) return;
        window.open(url, "_blank", "noopener,noreferrer");
        return;
      }

      if (mode === "iframe-post") {
        if (!url) return;
        await runIFramePostAction({
          url,
          payloadText: (task.actionPayload || "").trim(),
          ackKey: (task.actionAckKey || "").trim()
        });
        return;
      }
    }

    // ---------- Modal open helpers ----------
    function openAddModal() {
      reminderForm.reset();
      reminderIdField.value = "";
      reminderCreationDateField.value = "";

      // Frequency defaults
      const fixedRadio = document.querySelector('input[name="frequency-option"][value="fixed"]');
      if (fixedRadio) fixedRadio.checked = true;
      fixedFrequencyDiv.style.display = "block";
      cronBuilderDiv.style.display = "none";
      fixedDisplayDiv.textContent = "";

      cronFieldSelects.forEach(select => {
        select.value = "*";
        const input = document.querySelector(`.cron-input[data-field="${select.getAttribute("data-field")}"]`);
        input.style.display = "none";
        input.value = "";
      });
      updateCronDisplay();

      // Action defaults
      actionFields.mode.value = "none";
      actionFields.url.value = "";
      actionFields.payload.value = "";
      actionFields.ackKey.value = "";
      syncActionFieldsVisibility(actionFields);

      modal.style.display = "block";
    }

    function openEditModal(task) {
      reminderForm.reset();
      reminderIdField.value = task.uuid || "";
      reminderCreationDateField.value = String(task.creationDate || "");

      reminderNameField.value = task.name || "";
      reminderDescField.value = task.description || "";
      reminderTypeField.value = task.type || "punctual";
      reminderPriorityField.value = task.priority || "low";

      // due date for punctual
      if ((task.type || "punctual") === "punctual" && task.dueTime) {
        reminderDueDateField.value = toDatetimeLocalValue(task.dueTime);
      }

      // frequency UI is still derived from stored frequency string
      reminderTypeField.dispatchEvent(new Event("change"));

      // Action fields
      actionFields.mode.value = task.actionMode || "none";
      actionFields.url.value = task.actionUrl || "";
      actionFields.payload.value = task.actionPayload || "";
      actionFields.ackKey.value = task.actionAckKey || "";
      syncActionFieldsVisibility(actionFields);

      modal.style.display = "block";
    }

    // ---------- UI injection: show deactivated toggle ----------
    function injectShowDeactivatedToggle(anchorEl) {
      if (document.getElementById("show-deactivated-toggle")) {
        return document.getElementById("show-deactivated-toggle");
      }
      const wrap = document.createElement("div");
      wrap.style.display = "inline-flex";
      wrap.style.alignItems = "center";
      wrap.style.gap = "8px";
      wrap.style.marginLeft = "10px";

      wrap.innerHTML = `
        <label style="display:inline-flex; align-items:center; gap:6px; font-size:12px; color:#bbb;">
          <input id="show-deactivated-toggle" type="checkbox" />
          Show deactivated
        </label>
      `;

      anchorEl?.parentNode?.insertBefore(wrap, anchorEl.nextSibling);
      return wrap.querySelector("#show-deactivated-toggle");
    }

    // ---------- UI injection: action fields ----------
    function injectActionFieldsIntoForm(formEl) {
      if (document.getElementById("reminder-actionMode")) {
        return {
          mode: document.getElementById("reminder-actionMode"),
          url: document.getElementById("reminder-actionUrl"),
          payload: document.getElementById("reminder-actionPayload"),
          ackKey: document.getElementById("reminder-actionAckKey"),
          blocks: {
            url: document.getElementById("action-url-block"),
            payload: document.getElementById("action-payload-block"),
            ack: document.getElementById("action-ack-block"),
          }
        };
      }

      const wrap = document.createElement("div");
      wrap.style.marginTop = "10px";
      wrap.style.borderTop = "1px solid #333";
      wrap.style.paddingTop = "10px";

      wrap.innerHTML = `
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
          <div style="grid-column: 1 / -1;">
            <label style="display:block; font-size:12px; color:#aaa; margin-bottom:4px;">On reach (action)</label>
            <select id="reminder-actionMode">
              <option value="none" selected>None</option>
              <option value="intent">Intent / deep link</option>
              <option value="iframe-post">Iframe + postMessage + wait ACK</option>
            </select>
          </div>

          <div id="action-url-block" style="grid-column: 1 / -1; display:none;">
            <label style="display:block; font-size:12px; color:#aaa; margin-bottom:4px;">Target URL / Intent</label>
            <input type="text" id="reminder-actionUrl" placeholder="https://... or intent://... or myapp://..." />
          </div>

          <div id="action-payload-block" style="grid-column: 1 / -1; display:none;">
            <label style="display:block; font-size:12px; color:#aaa; margin-bottom:4px;">postMessage payload (string or JSON)</label>
            <textarea id="reminder-actionPayload" rows="5" placeholder='{"type":"ping"} or hello'></textarea>
          </div>

          <div id="action-ack-block" style="grid-column: 1 / -1; display:none;">
            <label style="display:block; font-size:12px; color:#aaa; margin-bottom:4px;">ACK key (optional)</label>
            <input type="text" id="reminder-actionAckKey" placeholder="e.g. confirm, ack, done" />
            <div style="margin-top:6px; font-size:11px; color:#777;">
              The iframe should postMessage back an object containing this key (or {type:'ack'}).
            </div>
          </div>
        </div>
      `;

      formEl.appendChild(wrap);

      const fields = {
        mode: document.getElementById("reminder-actionMode"),
        url: document.getElementById("reminder-actionUrl"),
        payload: document.getElementById("reminder-actionPayload"),
        ackKey: document.getElementById("reminder-actionAckKey"),
        blocks: {
          url: document.getElementById("action-url-block"),
          payload: document.getElementById("action-payload-block"),
          ack: document.getElementById("action-ack-block"),
        }
      };

      fields.mode.addEventListener("change", () => syncActionFieldsVisibility(fields));
      syncActionFieldsVisibility(fields);

      return fields;
    }

    function syncActionFieldsVisibility(fields) {
      const m = fields.mode.value;
      fields.blocks.url.style.display = (m === "intent" || m === "iframe-post") ? "block" : "none";
      fields.blocks.payload.style.display = (m === "iframe-post") ? "block" : "none";
      fields.blocks.ack.style.display = (m === "iframe-post") ? "block" : "none";
    }

    // ---------- Iframe overlay + postMessage + wait ACK ----------
    function injectIFrameActionOverlay() {
      if (document.getElementById("iframe-overlay")) return;

      const overlay = document.createElement("div");
      overlay.id = "iframe-overlay";
      overlay.style.display = "none";
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.zIndex = "1100000";
      overlay.style.background = "rgba(0,0,0,0.55)";

      overlay.innerHTML = `
        <div id="iframe-window"
             style="position:absolute; top:90px; left:90px; width:1000px; height:640px;
                    background:#0f0f0f; border:1px solid #333; border-radius:14px; overflow:hidden;
                    box-shadow: 0 16px 40px rgba(0,0,0,0.45);">
          <div id="iframe-titlebar"
               style="height:42px; display:flex; align-items:center; justify-content:space-between;
                      padding:0 10px; background:#141414; border-bottom:1px solid #333; cursor:move;">
            <div style="font-size:12px; color:#aaa;">Action: iframe + postMessage</div>
            <div style="display:flex; gap:8px;">
              <button id="iframe-send" style="padding:6px 10px;">Send</button>
              <button id="iframe-close" style="padding:6px 10px;">Close</button>
            </div>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 360px; height:calc(100% - 42px);">
            <iframe id="iframe-target" src="about:blank" style="width:100%; height:100%; border:0;"></iframe>
            <div style="border-left:1px solid #333; padding:10px; display:flex; flex-direction:column; gap:10px;">
              <div style="font-size:12px; color:#aaa;">Payload</div>
              <textarea id="iframe-payload" rows="14" style="width:100%; resize:vertical;"></textarea>

              <div style="font-size:12px; color:#aaa;">ACK key (optional)</div>
              <input id="iframe-ackkey" type="text" />

              <div style="font-size:12px; color:#aaa;">Timeout (seconds)</div>
              <input id="iframe-timeout" type="number" min="1" max="600" value="60" />

              <div style="font-size:12px; color:#aaa;">Status</div>
              <div id="iframe-status" style="font-size:12px; color:#ddd;">Idle</div>

              <div style="font-size:11px; color:#777; line-height:1.3;">
                postMessage is asynchronous. The iframe must respond via window.parent.postMessage(...)
                with either {type:'ack'} or an object containing the provided ACK key.
              </div>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      // Drag
      const win = overlay.querySelector("#iframe-window");
      const bar = overlay.querySelector("#iframe-titlebar");
      let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;

      bar.addEventListener("mousedown", (e) => {
        dragging = true;
        const rect = win.getBoundingClientRect();
        startX = e.clientX; startY = e.clientY;
        startLeft = rect.left; startTop = rect.top;
        e.preventDefault();
      });

      window.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        win.style.left = `${Math.max(10, startLeft + dx)}px`;
        win.style.top  = `${Math.max(10, startTop + dy)}px`;
      });

      window.addEventListener("mouseup", () => { dragging = false; });

      // Close
      overlay.querySelector("#iframe-close")?.addEventListener("click", () => closeIFrameOverlay());
      overlay.addEventListener("click", (e) => { if (e.target === overlay) closeIFrameOverlay(); });
    }

    function closeIFrameOverlay() {
      const overlay = document.getElementById("iframe-overlay");
      if (!overlay) return;
      overlay.style.display = "none";
      const iframe = document.getElementById("iframe-target");
      if (iframe) iframe.src = "about:blank";
      const status = document.getElementById("iframe-status");
      if (status) status.textContent = "Idle";
    }

    async function runIFramePostAction({ url, payloadText, ackKey }) {
      const overlay = document.getElementById("iframe-overlay");
      const iframe = document.getElementById("iframe-target");
      const payloadEl = document.getElementById("iframe-payload");
      const ackEl = document.getElementById("iframe-ackkey");
      const timeoutEl = document.getElementById("iframe-timeout");
      const statusEl = document.getElementById("iframe-status");
      const sendBtn = document.getElementById("iframe-send");

      if (!overlay || !iframe || !payloadEl || !ackEl || !timeoutEl || !statusEl || !sendBtn) {
        alert("Iframe overlay not available.");
        return;
      }

      overlay.style.display = "block";
      iframe.src = url || "about:blank";
      payloadEl.value = payloadText || "";
      ackEl.value = ackKey || "";
      statusEl.textContent = "Loaded. Ready to send.";

      const awaitAck = ({ originHint, key, timeoutMs }) => new Promise((resolve, reject) => {
        let timeoutId = null;

        const handler = (event) => {
          // If you want strict origin: compare event.origin to originHint when originHint exists
          if (originHint && event.origin !== originHint) return;

          const data = event.data;
          const isAck =
            (data && typeof data === "object" && (data.type === "ack" || data.type === "confirm")) ||
            (key && data && typeof data === "object" && Object.prototype.hasOwnProperty.call(data, key)) ||
            (typeof data === "string" && (data === "ack" || data === "confirm" || (key && data.includes(key))));

          if (isAck) {
            cleanup();
            resolve(data);
          }
        };

        const cleanup = () => {
          window.removeEventListener("message", handler);
          if (timeoutId) clearTimeout(timeoutId);
        };

        window.addEventListener("message", handler);

        timeoutId = setTimeout(() => {
          cleanup();
          reject(new Error("ACK timeout"));
        }, timeoutMs);
      });

      // derive origin hint for http(s) if possible
      let originHint = null;
      try {
        const u = new URL(url);
        if (u.protocol === "http:" || u.protocol === "https:") originHint = u.origin;
      } catch {
        originHint = null;
      }

      sendBtn.onclick = async () => {
        statusEl.textContent = "Sending payload...";

        let outgoing = payloadEl.value;
        try {
          outgoing = JSON.parse(outgoing);
        } catch {
          // keep as string
        }

        try {
          // If you want to restrict targetOrigin, use originHint when available; otherwise '*'
          iframe.contentWindow?.postMessage(outgoing, originHint || "*");
        } catch (e) {
          statusEl.textContent = "postMessage failed.";
          return;
        }

        statusEl.textContent = "Payload sent. Waiting ACK...";

        const key = (ackEl.value || "").trim();
        const timeoutSec = clampInt(timeoutEl.value, 1, 600, 60);
        const timeoutMs = timeoutSec * 1000;

        try {
          await awaitAck({ originHint, key, timeoutMs });
          statusEl.textContent = "ACK received.";
        } catch {
          statusEl.textContent = "ACK timeout.";
        }
      };
    }

    // ---------- Rendering helpers ----------
    function renderActionLabel(task) {
      const mode = task.actionMode || "none";
      if (mode === "intent" && task.actionUrl) {
        return `<button class="action-btn" data-action="intent" style="padding:6px 8px;">Launch</button>`;
      }
      if (mode === "iframe-post" && task.actionUrl) {
        return `<button class="action-btn" data-action="iframe" style="padding:6px 8px;">Open</button>`;
      }
      return `<span style="color:#777;">-</span>`;
    }

    // ---------- Cron helpers ----------
    function updateCronDisplay() {
      const fields = ["minute", "hour", "dom", "month", "dow"];
      const cronParts = [];
      fields.forEach(field => {
        const select = document.querySelector(`.cron-field[data-field="${field}"]`);
        if (select.value === "*") cronParts.push("*");
        else if (select.value === "?") cronParts.push("?");
        else if (select.value === "at") {
          const input = document.querySelector(`.cron-input[data-field="${field}"]`);
          const val = input.value;
          cronParts.push(val !== "" ? val : "*");
        }
      });
      const cronString = cronParts.join(" ");
      cronDisplayDiv.textContent = `Cron: ${cronString}`;
    }

    function updateFixedDisplay() {
      const m = fixedMonthField.value;
      const d = fixedDayField.value;
      const h = fixedHourField.value;
      const mi = fixedMinuteField.value;
      if (m && d && h !== "" && mi !== "") fixedDisplayDiv.textContent = `Fixed: ${mi} ${h} on ${d}/${m}`;
      else fixedDisplayDiv.textContent = "";
    }

    function computeNextOccurrenceFixed(month, day, hour, minute) {
      const now = new Date();
      let year = now.getFullYear();
      let candidate = new Date(year, month - 1, day, hour, minute, 0);
      while (candidate < now || candidate.getMonth() !== (month - 1) || candidate.getDate() !== day) {
        year++;
        candidate = new Date(year, month - 1, day, hour, minute, 0);
      }
      return candidate.getTime();
    }

    function computeNextOccurrence(cronString) {
      const parts = String(cronString || "").split(" ");
      const now = new Date();
      let candidate = new Date(now);

      // brute-force up to 1 year in minutes
      for (let i = 0; i < 525600; i++) {
        candidate = new Date(now.getTime() + i * 60000);
        let match = true;

        if (parts[0] !== "*" && parts[0] !== "?" && candidate.getMinutes() !== parseInt(parts[0], 10)) match = false;
        if (parts[1] !== "*" && parts[1] !== "?" && candidate.getHours() !== parseInt(parts[1], 10)) match = false;
        if (parts[2] !== "*" && parts[2] !== "?" && candidate.getDate() !== parseInt(parts[2], 10)) match = false;
        if (parts[3] !== "*" && parts[3] !== "?" && (candidate.getMonth() + 1) !== parseInt(parts[3], 10)) match = false;
        if (parts[4] !== "*" && parts[4] !== "?" && candidate.getDay() !== parseInt(parts[4], 10)) match = false;

        if (match && candidate > now) return candidate.getTime();
      }

      return now.getTime();
    }

    // ---------- Utilities ----------
    function formatCountdown(ms) {
      if (ms < 0) return "Due";
      const totalSec = Math.floor(ms / 1000);
      const days = Math.floor(totalSec / (3600 * 24));
      const hours = Math.floor((totalSec % (3600 * 24)) / 3600);
      const minutes = Math.floor((totalSec % 3600) / 60);
      const seconds = totalSec % 60;
      return `${days}d ${hours}h ${minutes}m ${seconds}s`;
    }

    function clampInt(v, min, max, fallback) {
      const n = parseInt(v, 10);
      if (Number.isNaN(n)) return fallback;
      return Math.min(max, Math.max(min, n));
    }

    function normalizeUrl(url) {
      if (!url) return url;
      const u = url.trim();
      // keep custom schemes / intent
      if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(u)) return u;
      if (u.startsWith("intent://") || u.startsWith("myapp://")) return u;
      return `https://${u}`;
    }

    function escapeHtml(s) {
      return String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function escapeHtmlAttr(s) {
      return escapeHtml(s).replaceAll("\n", " ").replaceAll("\r", " ");
    }

    function toDatetimeLocalValue(ms) {
      const d = new Date(ms);
      const pad = (n) => String(n).padStart(2, "0");
      const yyyy = d.getFullYear();
      const MM = pad(d.getMonth() + 1);
      const dd = pad(d.getDate());
      const hh = pad(d.getHours());
      const mm = pad(d.getMinutes());
      return `${yyyy}-${MM}-${dd}T${hh}:${mm}`;
    }

    function generateUUID() {
      // RFC4122 v4-ish (no dependency)
      const buf = new Uint8Array(16);
      crypto.getRandomValues(buf);
      buf[6] = (buf[6] & 0x0f) | 0x40;
      buf[8] = (buf[8] & 0x3f) | 0x80;
      const hex = [...buf].map(b => b.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  });
})();
