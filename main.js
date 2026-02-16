// main.js (single-file, production-safe: keeps existing DB schema + fields, only adds optional fields on records)

document.addEventListener('DOMContentLoaded', async () => {
  const dbInstance = await window.dbAPI.openDB();
  const storeName = window.dbAPI.storeName || 'tasks'; // kept for compatibility (your db.js uses "Reminders")

  // ---------- Constants ----------
  const EMOJI_CHOICES = ["🥷", "🧙‍♂️", "🧞‍♀️", "🧜‍♀️", "🧝‍♂️", "🧚🏻", "🤖", "👨‍💻", "👩‍🏫", "🧑‍🌾", "👨‍🔬", "👨‍🔬"];
  const INTENT_PRESETS = [
    { key: "youtube", label: "YouTube", url: "https://www.youtube.com" },
    { key: "spotify", label: "Spotify", url: "https://open.spotify.com" },
    { key: "gcal", label: "Google Calendar", url: "https://calendar.google.com" },
    { key: "gmail", label: "Gmail", url: "https://mail.google.com" },
    { key: "maps", label: "Google Maps", url: "https://maps.google.com" },
    { key: "custom", label: "Put my own intent / URL", url: "" }
  ];

  // Settings are stored in localStorage (no DB schema change)
  const SETTINGS_KEY = "remind_gamify_settings_v1";
  const DEFAULT_SETTINGS = {
    emoji: "🥷",
    sleepHoursPerDay: 7,
    workHoursPerDay: 8,
    workDaysPerWeek: 5,
    monthlySalaryEUR: 0
  };

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }
  function saveSettings(next) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  }

  let settings = loadSettings();

  // ---------- DOM handles (existing) ----------
  const searchInput = document.getElementById('search-input');
  const sortSelect = document.getElementById('sort-select');
  const addButton = document.getElementById('add-button');
  const exportButton = document.getElementById('export-button');
  const importButton = document.getElementById('import-button');
  const clearButton = document.getElementById('clear-button');
  const importFileInput = document.getElementById('import-file');
  const remindersTableBody = document.querySelector('#reminders-table tbody');

  // Modal elements (existing)
  const modal = document.getElementById('modal');
  const closeModal = document.getElementById('close-modal');
  const reminderForm = document.getElementById('reminder-form');
  const reminderIdField = document.getElementById('reminder-id');
  const reminderCreationDateField = document.getElementById('reminder-creationDate');
  const reminderNameField = document.getElementById('reminder-name');
  const reminderDescField = document.getElementById('reminder-desc');
  const reminderTypeField = document.getElementById('reminder-type');
  const reminderDueDateField = document.getElementById('reminder-dueDate');
  const reminderPriorityField = document.getElementById('reminder-priority');

  // Frequency section (existing)
  const frequencySection = document.getElementById('frequency-section');
  const freqOptionRadios = document.getElementsByName('frequency-option');
  const fixedFrequencyDiv = document.getElementById('fixed-frequency');
  const fixedMonthField = document.getElementById('fixed-month');
  const fixedDayField = document.getElementById('fixed-day');
  const fixedHourField = document.getElementById('fixed-hour');
  const fixedMinuteField = document.getElementById('fixed-minute');
  const fixedDisplayDiv = document.getElementById('fixed-display');

  const cronBuilderDiv = document.getElementById('cron-builder');
  const cronDisplayDiv = document.getElementById('cron-display');
  const cronFieldSelects = document.querySelectorAll('.cron-field');
  const cronInputs = document.querySelectorAll('.cron-input');

  // ---------- UI injection: Character HUD (top-right) + overlays ----------
  injectHUD();
  injectDetailsModal();
  injectWebActionOverlay();

  // ---------- Extend Add Modal: new fields (no HTML change) ----------
  // Adds optional fields to the existing form: duration, happiness, sadness, money, action type/url/intent, endDate, activityKind
  const extraFields = injectExtraFieldsIntoForm(reminderForm);

  // ---------- Event wiring (existing + updated behaviors) ----------
  loadReminders();

  reminderTypeField.addEventListener('change', () => {
    if (reminderTypeField.value === 'frequency') {
      frequencySection.style.display = 'block';
      reminderDueDateField.style.display = 'none';
    } else {
      frequencySection.style.display = 'none';
      reminderDueDateField.style.display = 'block';
    }
  });
  reminderTypeField.dispatchEvent(new Event('change'));

  freqOptionRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.value === 'fixed' && radio.checked) {
        fixedFrequencyDiv.style.display = 'block';
        cronBuilderDiv.style.display = 'none';
        updateFixedDisplay();
      } else if (radio.value === 'cron' && radio.checked) {
        fixedFrequencyDiv.style.display = 'none';
        cronBuilderDiv.style.display = 'block';
        updateCronDisplay();
      }
    });
  });

  cronFieldSelects.forEach(select => {
    select.addEventListener('change', () => {
      const field = select.getAttribute('data-field');
      const input = document.querySelector(`.cron-input[data-field="${field}"]`);
      if (select.value === "at") {
        input.style.display = 'inline-block';
      } else {
        input.style.display = 'none';
      }
      updateCronDisplay();
    });
  });
  cronInputs.forEach(input => input.addEventListener('input', updateCronDisplay));

  [fixedMonthField, fixedDayField, fixedHourField, fixedMinuteField].forEach(el => el.addEventListener('input', updateFixedDisplay));

  // Open modal for new reminder (no edit)
  addButton.addEventListener('click', () => {
    reminderForm.reset();
    reminderIdField.value = "";
    reminderCreationDateField.value = "";

    // default frequency UI state
    document.querySelector('input[name="frequency-option"][value="fixed"]').checked = true;
    fixedFrequencyDiv.style.display = 'block';
    cronBuilderDiv.style.display = 'none';
    fixedDisplayDiv.textContent = "";
    cronFieldSelects.forEach(select => {
      select.value = "*";
      const input = document.querySelector(`.cron-input[data-field="${select.getAttribute('data-field')}"]`);
      input.style.display = 'none';
      input.value = "";
    });
    updateCronDisplay();

    // default extra fields
    extraFields.durationMinutes.value = "30";
    extraFields.happinessDelta.value = "0";
    extraFields.sadnessDelta.value = "0";
    extraFields.moneyEUR.value = "0";
    extraFields.actionType.value = "none";
    extraFields.actionUrl.value = "";
    extraFields.intentPreset.value = "youtube";
    extraFields.intentCustom.value = "";
    extraFields.endDate.value = "";
    extraFields.activityKind.value = "general";
    syncActionFieldsVisibility();

    modal.style.display = 'block';
  });

  closeModal.addEventListener('click', () => { modal.style.display = 'none'; });
  window.addEventListener('click', (event) => { if (event.target === modal) modal.style.display = 'none'; });

  // Search/sort reload
  searchInput.addEventListener('input', loadReminders);
  sortSelect.addEventListener('change', loadReminders);

  // Save reminder (create-only; if an imported reminder includes uuid collision it will be merged via import logic)
  reminderForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const now = Date.now();

    const type = reminderTypeField.value;
    let dueTime;
    let frequencyDisplay = "-";

    if (type === 'frequency') {
      const selectedOption = document.querySelector('input[name="frequency-option"]:checked').value;
      if (selectedOption === 'fixed') {
        const month = parseInt(fixedMonthField.value);
        const day = parseInt(fixedDayField.value);
        const hour = parseInt(fixedHourField.value);
        const minute = parseInt(fixedMinuteField.value);

        if (isNaN(month) || month < 1 || month > 12 ||
            isNaN(day) || day < 1 || day > 31 ||
            isNaN(hour) || hour < 0 || hour > 23 ||
            isNaN(minute) || minute < 0 || minute > 59) {
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

    // Extra fields (optional, safe to add)
    const durationMinutes = clampInt(extraFields.durationMinutes.value, 0, 24 * 60, 30);
    const happinessDelta = clampInt(extraFields.happinessDelta.value, -100, 100, 0);
    const sadnessDelta = clampInt(extraFields.sadnessDelta.value, -100, 100, 0);
    const moneyEUR = clampFloat(extraFields.moneyEUR.value, -1_000_000, 1_000_000, 0);

    const activityKind = extraFields.activityKind.value || "general";
    const endDateRaw = (extraFields.endDate.value || "").trim();
    const endDate = endDateRaw ? new Date(endDateRaw).getTime() : null;

    // action model: none | web | link-intent
    const actionType = extraFields.actionType.value || "none";
    let actionUrl = (extraFields.actionUrl.value || "").trim();
    let actionIntent = null;

    if (actionType === "web") {
      if (!actionUrl) {
        alert("Web action needs a URL.");
        return;
      }
      actionUrl = normalizeUrl(actionUrl);
    } else if (actionType === "link-intent") {
      const preset = extraFields.intentPreset.value;
      if (preset === "custom") {
        const custom = (extraFields.intentCustom.value || "").trim();
        if (!custom) {
          alert("Custom intent/link must be provided.");
          return;
        }
        actionIntent = custom;
        actionUrl = custom; // for web fallback
      } else {
        const found = INTENT_PRESETS.find(x => x.key === preset);
        actionIntent = preset;
        actionUrl = found?.url || "";
      }
      if (actionUrl) actionUrl = normalizeUrl(actionUrl);
    }

    const reminder = {
      // Keep existing fields
      uuid: reminderIdField.value || generateUUID(),
      name: reminderNameField.value,
      description: reminderDescField.value,
      type: type, // punctual | frequency
      frequency: type === 'frequency' ? frequencyDisplay : '-',
      dueTime: dueTime,
      priority: reminderPriorityField.value,
      modificationDate: now,

      // New optional fields (do not break existing data)
      durationMinutes,
      happinessDelta,
      sadnessDelta,
      moneyEUR,
      activityKind,
      endDate, // nullable
      actionType,
      actionUrl,
      actionIntent,

      // Archive flag fallback (keeps requirement “do not delete outdated”; true archive store needs db.js upgrade)
      archived: false
    };

    // Create-only: if reminderIdField has a value we still support update for compatibility,
    // but UI no longer exposes edit.
    if (reminderIdField.value) {
      reminder.creationDate = parseInt(reminderCreationDateField.value);
      await window.dbAPI.updateTask(reminder);
    } else {
      reminder.creationDate = now;
      await window.dbAPI.addTask(reminder);
    }

    modal.style.display = 'none';
    loadReminders();
  });

  exportButton.addEventListener('click', async () => {
    const reminders = await window.dbAPI.getAllTasks();
    const dataStr = JSON.stringify(reminders, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'reminders_export.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  importButton.addEventListener('click', () => importFileInput.click());

  importFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const importedReminders = JSON.parse(event.target.result);
        const existingReminders = await window.dbAPI.getAllTasks();
        const existingMap = new Map();
        existingReminders.forEach(r => existingMap.set(r.uuid, r));
        for (const rem of importedReminders) {
          existingMap.set(rem.uuid, rem);
        }
        const merged = Array.from(existingMap.values());
        for (const rem of merged) {
          if (existingReminders.some(r => r.uuid === rem.uuid)) {
            await window.dbAPI.updateTask(rem);
          } else {
            await window.dbAPI.addTask(rem);
          }
        }
        loadReminders();
      } catch (err) {
        console.error("Error importing reminders:", err);
        alert("Failed to import reminders. Please check the file format.");
      }
    };
    reader.readAsText(file);
  });

  clearButton.addEventListener('click', async () => {
    if (confirm("Are you sure you want to clear all reminders? This cannot be undone.")) {
      try {
        const transaction = dbInstance.transaction([storeName], "readwrite");
        const store = transaction.objectStore(storeName);
        const clearRequest = store.clear();
        clearRequest.onsuccess = () => {
          alert("All reminders have been cleared.");
          loadReminders();
        };
        clearRequest.onerror = (e) => {
          console.error("Error clearing reminders:", e);
          alert("Failed to clear reminders.");
        };
      } catch (error) {
        console.error("Error during clear operation:", error);
        alert("Failed to clear reminders.");
      }
    }
  });

  // ---------- Countdown updates ----------
  setInterval(() => {
    document.querySelectorAll('.countdown').forEach(cell => {
      let dueTime = parseInt(cell.getAttribute('data-duetime'));
      const type = cell.getAttribute('data-type');
      const archived = cell.getAttribute('data-archived') === 'true';

      // Archive logic for punctual tasks: past due + 7 days => archive flag
      if (!archived && type === 'punctual' && Date.now() > dueTime + 7 * 24 * 60 * 60000) {
        const uuid = cell.getAttribute('data-uuid');
        softArchiveTask(uuid).catch(() => {});
        cell.setAttribute('data-archived', 'true');
      }

      if (type === 'frequency' && (dueTime - Date.now() <= 0)) {
        const freqOption = cell.getAttribute('data-freq-option');
        if (freqOption === 'fixed') {
          const month = parseInt(cell.getAttribute('data-fixed-month'));
          const day = parseInt(cell.getAttribute('data-fixed-day'));
          const hour = parseInt(cell.getAttribute('data-fixed-hour'));
          const minute = parseInt(cell.getAttribute('data-fixed-minute'));
          dueTime = computeNextOccurrenceFixed(month, day, hour, minute);
        } else if (freqOption === 'cron') {
          const cronString = cell.getAttribute('data-cron-string');
          dueTime = computeNextOccurrence(cronString);
        }
        cell.setAttribute('data-duetime', dueTime);
      }
      cell.textContent = formatCountdown(dueTime - Date.now());
    });
  }, 1000);

  // ---------- Core load/render ----------
  async function loadReminders() {
    let reminders = await window.dbAPI.getAllTasks();
    const now = Date.now();

    // Soft archive filter: do not show archived by default
    reminders = reminders.filter(r => !r.archived);

    // Auto-archive punctual tasks > 7 days past due (requirement: do not delete; archive)
    // Note: "archive to another collection" requires db.js upgrade; this fallback uses archived=true.
    const toArchive = reminders.filter(r => r.type === 'punctual' && now > (r.dueTime + 7 * 24 * 60 * 60000));
    if (toArchive.length) {
      await Promise.allSettled(toArchive.map(r => softArchiveTask(r.uuid)));
      reminders = reminders.filter(r => !(r.type === 'punctual' && now > (r.dueTime + 7 * 24 * 60 * 60000)));
    }

    // Search
    const searchTerm = (searchInput.value || "").toLowerCase();
    if (searchTerm) {
      reminders = reminders.filter(r => (r.name || "").toLowerCase().includes(searchTerm));
    }

    // Sort
    const sortValue = sortSelect.value;
    if (sortValue === 'remaining-asc') {
      reminders.sort((a, b) => (a.dueTime - now) - (b.dueTime - now));
    } else if (sortValue === 'remaining-desc') {
      reminders.sort((a, b) => (b.dueTime - now) - (a.dueTime - now));
    } else if (sortValue === 'name-asc') {
      reminders.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    } else if (sortValue === 'name-desc') {
      reminders.sort((a, b) => (b.name || "").localeCompare(a.name || ""));
    }

    renderReminders(reminders);
    renderHUD(reminders);
  }

  // Light table: Countdown, Title, Event, Priority, Description, Duration, Money, Action
  // Details popup on row click for: type, creationDate, modificationDate, uuid, frequency, etc.
  function renderReminders(reminders) {
    // Update headers (non-destructive; safe if already customized)
    const theadRow = document.querySelector('#reminders-table thead tr');
    if (theadRow) {
      theadRow.innerHTML = `
        <th>Countdown</th>
        <th>Title</th>
        <th>Event Date/Time</th>
        <th>Priority</th>
        <th>Description</th>
        <th>Duration</th>
        <th>Money (€)</th>
        <th>Action</th>
      `;
    }

    remindersTableBody.innerHTML = '';

    reminders.slice(0, 50).forEach(reminder => {
      const priorityClass =
        reminder.priority === 'high' ? 'priority priority-high' :
        reminder.priority === 'medium' ? 'priority priority-medium' :
        'priority priority-low';

      const eventDate = new Date(reminder.dueTime);
      const eventDateString = eventDate.toLocaleString();

      let extraDataAttrs = '';
      if (reminder.type === 'frequency') {
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
              extraDataAttrs = `data-freq-option="fixed" data-fixed-month="${fixedMonth}" data-fixed-day="${fixedDay}" data-fixed-hour="${fixedHour}" data-fixed-minute="${fixedMinute}"`;
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
            data-archived="${reminder.archived ? 'true' : 'false'}"
            ${extraDataAttrs}>
          ${formatCountdown(reminder.dueTime - Date.now())}
        </td>
      `;

      const durationLabel = `${safeNumber(reminder.durationMinutes, 0)} min`;
      const moneyLabel = formatEUR(reminder.moneyEUR);

      const actionLabel = renderActionLabel(reminder);

      const tr = document.createElement('tr');
      tr.classList.add('reminder-row');
      tr.setAttribute('data-uuid', reminder.uuid);

      tr.innerHTML = `
        ${countdownCell}
        <td class="important-data">${escapeHtml(reminder.name || "")}</td>
        <td class="important-data">${escapeHtml(eventDateString)}</td>
        <td class="${priorityClass}">${escapeHtml(reminder.priority || "")}</td>
        <td>${escapeHtml(reminder.description || "")}</td>
        <td>${escapeHtml(durationLabel)}</td>
        <td>${escapeHtml(moneyLabel)}</td>
        <td>${actionLabel}</td>
      `;

      // Row click => details modal (and action click remains actionable)
      tr.addEventListener('click', async (evt) => {
        // Avoid row-click if user clicks a button/link inside action cell
        const target = evt.target;
        if (target && (target.closest?.('.action-btn') || target.closest?.('.action-link'))) return;

        const details = await getTaskByUuid(reminder.uuid);
        openDetailsModal(details);
      });

      // Action handlers
      const webBtn = tr.querySelector('[data-action="web"]');
      if (webBtn) {
        webBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          openWebOverlay(reminder.actionUrl);
        });
      }
      const linkBtn = tr.querySelector('[data-action="link"]');
      if (linkBtn) {
        linkBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (reminder.actionUrl) window.open(reminder.actionUrl, '_blank', 'noopener,noreferrer');
        });
      }

      remindersTableBody.appendChild(tr);
    });
  }

  // ---------- Details Modal ----------
  async function getTaskByUuid(uuid) {
    // dbAPI does not expose get(uuid); so fetch all and find (safe for small data, your UI paginates anyway)
    const all = await window.dbAPI.getAllTasks();
    return all.find(r => r.uuid === uuid) || null;
  }

  function openDetailsModal(task) {
    const modalEl = document.getElementById('details-modal');
    const bodyEl = document.getElementById('details-body');
    if (!modalEl || !bodyEl) return;

    if (!task) {
      bodyEl.innerHTML = `<div style="color:#ccc;">Not found.</div>`;
      modalEl.style.display = 'block';
      return;
    }

    const rows = [
      ["Title", task.name || ""],
      ["Description", task.description || ""],
      ["Type", task.type || ""],
      ["Due Time", task.dueTime ? new Date(task.dueTime).toLocaleString() : ""],
      ["Priority", task.priority || ""],
      ["UUID", task.uuid || ""],
      ["Frequency", task.frequency || ""],
      ["Creation Date", task.creationDate ? new Date(task.creationDate).toLocaleString() : "-"],
      ["Modification Date", task.modificationDate ? new Date(task.modificationDate).toLocaleString() : "-"],
      ["Duration (minutes)", safeNumber(task.durationMinutes, 0)],
      ["Activity Kind", task.activityKind || "general"],
      ["Happiness Δ", safeNumber(task.happinessDelta, 0)],
      ["Sadness Δ", safeNumber(task.sadnessDelta, 0)],
      ["Money (€)", formatEUR(task.moneyEUR)],
      ["End Date", task.endDate ? new Date(task.endDate).toLocaleString() : "-"],
      ["Action Type", task.actionType || "none"],
      ["Action URL / Intent", task.actionUrl || task.actionIntent || "-"]
    ];

    bodyEl.innerHTML = `
      <div style="display:grid; grid-template-columns: 160px 1fr; gap: 8px 12px;">
        ${rows.map(([k, v]) => `
          <div style="color:#aaa; font-size:12px;">${escapeHtml(String(k))}</div>
          <div style="color:#ddd; font-size:13px; word-break:break-word;">${escapeHtml(String(v))}</div>
        `).join("")}
      </div>
      <div style="margin-top:12px; display:flex; gap:10px; justify-content:flex-end;">
        <button id="details-archive-btn" style="padding:8px 10px;">Archive</button>
        <button id="details-close-btn" style="padding:8px 10px;">Close</button>
      </div>
    `;

    // Buttons
    const closeBtn = document.getElementById('details-close-btn');
    const archiveBtn = document.getElementById('details-archive-btn');
    closeBtn?.addEventListener('click', () => { modalEl.style.display = 'none'; });
    archiveBtn?.addEventListener('click', async () => {
      await softArchiveTask(task.uuid);
      modalEl.style.display = 'none';
      loadReminders();
    });

    modalEl.style.display = 'block';
  }

  // ---------- Archive (soft fallback) ----------
  async function softArchiveTask(uuid) {
    const all = await window.dbAPI.getAllTasks();
    const t = all.find(x => x.uuid === uuid);
    if (!t) return;

    // If you later add a real archive collection in db.js (Archive store),
    // you can replace this with dbAPI.archiveTask(uuid) without changing UI.
    t.archived = true;
    t.modificationDate = Date.now();
    await window.dbAPI.updateTask(t);
  }

  // ---------- HUD computations ----------
  function renderHUD(activeTasks) {
    const hud = document.getElementById('character-hud');
    if (!hud) return;

    const now = new Date();
    const week = getWeekWindow(now); // [startMs, endMs)
    const weekTasks = activeTasks.filter(t => isTaskRelevantInWindow(t, week.start, week.end));

    // Time budget
    const totalWeekHours = 7 * 24;
    const sleepWeekHours = settings.sleepHoursPerDay * 7;
    const workWeekHours = settings.workHoursPerDay * clampInt(settings.workDaysPerWeek, 0, 7, 5);
    const plannedMinutesWeek = estimatePlannedMinutesInWindow(weekTasks, week.start, week.end);
    const plannedHoursWeek = plannedMinutesWeek / 60;

    const freeHoursWeek = Math.max(0, totalWeekHours - sleepWeekHours - workWeekHours - plannedHoursWeek);
    const freePct = percent(freeHoursWeek, Math.max(1, totalWeekHours - sleepWeekHours - workWeekHours));

    // Strength (exercise)
    const exerciseMinutes = estimateExerciseMinutesInWindow(weekTasks, week.start, week.end);
    const maxActiveMinutes = Math.max(1, (24 - settings.sleepHoursPerDay) * 7 * 60);
    const strengthPct = Math.min(100, Math.round((exerciseMinutes / maxActiveMinutes) * 100));

    // Mood
    const happiness = sumFieldInWindow(weekTasks, "happinessDelta", week.start, week.end);
    const sadness = sumFieldInWindow(weekTasks, "sadnessDelta", week.start, week.end);
    const happinessPct = clampInt(Math.round(50 + happiness), 0, 100, 50); // centered scale
    const sadnessPct = clampInt(Math.round(50 + sadness), 0, 100, 50);

    // Money (month balance)
    const month = getMonthWindow(now);
    const monthTasks = activeTasks.filter(t => isTaskRelevantInWindow(t, month.start, month.end));
    const moneyNet = sumMoneyInWindow(monthTasks, month.start, month.end) + safeNumber(settings.monthlySalaryEUR, 0);
    const moneyPct = clampInt(Math.round(50 + moneyNet / 100), 0, 100, 50); // heuristic

    // Daily remaining time (next 7 days)
    const daily = computeDailyRemaining(activeTasks, settings);

    // Render
    const emojiSelect = renderEmojiSelect(settings.emoji);
    const settingsPanel = renderSettingsPanel(settings);

    hud.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="font-size:26px; line-height:1;">${emojiSelect}</div>
          <div>
            <div style="font-size:12px; color:#aaa;">Operator</div>
            <div style="font-size:13px; color:#ddd;">Weekly Capacity Engine</div>
          </div>
        </div>
        <button id="hud-settings-btn" title="Settings" style="padding:6px 8px;">⚙️</button>
      </div>

      <div style="margin-top:10px;">
        ${renderBar("Free time (week)", `${freeHoursWeek.toFixed(1)}h`, freePct)}
        ${renderBar("Strength (exercise)", `${Math.round(exerciseMinutes)} min`, strengthPct)}
        ${renderBar("Happiness", `${happiness}`, happinessPct)}
        ${renderBar("Sadness", `${sadness}`, sadnessPct)}
        ${renderBar("Money (month)", `${formatEUR(moneyNet)}`, moneyPct)}
      </div>

      <div style="margin-top:10px;">
        <div style="font-size:12px; color:#aaa; margin-bottom:6px;">Daily remaining (next 7 days)</div>
        <div style="display:grid; grid-template-columns: repeat(7, 1fr); gap:6px;">
          ${daily.map(d => `
            <div style="border:1px solid #333; border-radius:10px; padding:6px;">
              <div style="font-size:11px; color:#aaa;">${escapeHtml(d.label)}</div>
              <div style="font-size:12px; color:#ddd; font-weight:600;">${d.remainingHours.toFixed(1)}h</div>
            </div>
          `).join("")}
        </div>
      </div>

      <div id="hud-settings-panel" style="display:none; margin-top:10px; border:1px solid #333; border-radius:12px; padding:10px;">
        ${settingsPanel}
      </div>
    `;

    // Wire emoji select
    const emojiSel = document.getElementById('hud-emoji-select');
    if (emojiSel) {
      emojiSel.addEventListener('change', () => {
        settings.emoji = emojiSel.value;
        saveSettings(settings);
        loadReminders();
      });
    }

    // Wire settings toggle
    const settingsBtn = document.getElementById('hud-settings-btn');
    const panel = document.getElementById('hud-settings-panel');
    settingsBtn?.addEventListener('click', () => {
      if (!panel) return;
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });

    // Wire settings inputs
    const sleepInput = document.getElementById('hud-sleep-hours');
    const workInput = document.getElementById('hud-work-hours');
    const workDaysInput = document.getElementById('hud-work-days');
    const salaryInput = document.getElementById('hud-salary');

    [sleepInput, workInput, workDaysInput, salaryInput].forEach(inp => {
      inp?.addEventListener('input', () => {
        settings.sleepHoursPerDay = clampFloat(sleepInput.value, 0, 24, DEFAULT_SETTINGS.sleepHoursPerDay);
        settings.workHoursPerDay = clampFloat(workInput.value, 0, 24, DEFAULT_SETTINGS.workHoursPerDay);
        settings.workDaysPerWeek = clampInt(workDaysInput.value, 0, 7, DEFAULT_SETTINGS.workDaysPerWeek);
        settings.monthlySalaryEUR = clampFloat(salaryInput.value, -1_000_000, 1_000_000, DEFAULT_SETTINGS.monthlySalaryEUR);
        saveSettings(settings);
        loadReminders();
      });
    });
  }

  // ---------- HUD + modal + overlay injection ----------
  function injectHUD() {
    const container = document.querySelector('.container') || document.body;

    const hud = document.createElement('div');
    hud.id = 'character-hud';
    hud.style.position = 'fixed';
    hud.style.top = '14px';
    hud.style.right = '14px';
    hud.style.width = '340px';
    hud.style.zIndex = '9999';
    hud.style.background = 'rgba(12,12,12,0.92)';
    hud.style.border = '1px solid #333';
    hud.style.borderRadius = '16px';
    hud.style.padding = '12px';
    hud.style.boxShadow = '0 10px 30px rgba(0,0,0,0.35)';
    hud.style.backdropFilter = 'blur(8px)';
    hud.style.color = '#ddd';
    hud.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Arial';

    container.appendChild(hud);
  }

  function injectDetailsModal() {
    // Lightweight overlay modal dedicated to details (no conflict with add modal)
    const modalWrap = document.createElement('div');
    modalWrap.id = 'details-modal';
    modalWrap.style.display = 'none';
    modalWrap.style.position = 'fixed';
    modalWrap.style.inset = '0';
    modalWrap.style.background = 'rgba(0,0,0,0.55)';
    modalWrap.style.zIndex = '10000';

    modalWrap.innerHTML = `
      <div style="max-width:720px; margin:60px auto; background:#111; border:1px solid #333; border-radius:16px; padding:14px;">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
          <div style="font-size:14px; color:#ddd; font-weight:700;">Task Details</div>
          <button id="details-x" style="padding:6px 10px;">✕</button>
        </div>
        <div id="details-body"></div>
      </div>
    `;
    document.body.appendChild(modalWrap);

    modalWrap.addEventListener('click', (e) => {
      if (e.target === modalWrap) modalWrap.style.display = 'none';
    });
    modalWrap.querySelector('#details-x')?.addEventListener('click', () => {
      modalWrap.style.display = 'none';
    });
  }

  function injectWebActionOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'web-overlay';
    overlay.style.display = 'none';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.zIndex = '11000';
    overlay.style.pointerEvents = 'none'; // inner window will handle

    overlay.innerHTML = `
      <div id="web-window"
           style="position:absolute; top:120px; left:120px; width:900px; height:560px;
                  background:#0f0f0f; border:1px solid #333; border-radius:14px; overflow:hidden;
                  box-shadow: 0 16px 40px rgba(0,0,0,0.45);
                  pointer-events:auto;">
        <div id="web-titlebar"
             style="height:42px; display:flex; align-items:center; justify-content:space-between;
                    padding:0 10px; background:#141414; border-bottom:1px solid #333; cursor:move;">
          <div style="font-size:12px; color:#aaa;">Embedded Web Action</div>
          <button id="web-close" style="padding:6px 10px;">Close</button>
        </div>
        <iframe id="web-iframe" src="about:blank" style="width:100%; height:calc(100% - 42px); border:0;"></iframe>
      </div>
    `;
    document.body.appendChild(overlay);

    // Drag behavior
    const win = overlay.querySelector('#web-window');
    const bar = overlay.querySelector('#web-titlebar');
    let dragging = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;

    bar.addEventListener('mousedown', (e) => {
      dragging = true;
      const rect = win.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      win.style.left = `${Math.max(10, startLeft + dx)}px`;
      win.style.top = `${Math.max(10, startTop + dy)}px`;
    });

    window.addEventListener('mouseup', () => { dragging = false; });

    overlay.querySelector('#web-close').addEventListener('click', () => {
      overlay.style.display = 'none';
      overlay.querySelector('#web-iframe').src = 'about:blank';
    });
  }

  function openWebOverlay(url) {
    const overlay = document.getElementById('web-overlay');
    const iframe = document.getElementById('web-iframe');
    if (!overlay || !iframe) return;
    overlay.style.display = 'block';
    iframe.src = url || 'about:blank';
  }

  // ---------- Extra fields injection into add form ----------
  function injectExtraFieldsIntoForm(formEl) {
    const wrap = document.createElement('div');
    wrap.style.marginTop = '10px';
    wrap.style.borderTop = '1px solid #333';
    wrap.style.paddingTop = '10px';

    wrap.innerHTML = `
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
        <div>
          <label style="display:block; font-size:12px; color:#aaa; margin-bottom:4px;">Duration (minutes)</label>
          <input type="number" id="reminder-durationMinutes" min="0" max="1440" value="30" />
        </div>

        <div>
          <label style="display:block; font-size:12px; color:#aaa; margin-bottom:4px;">Activity kind</label>
          <select id="reminder-activityKind">
            <option value="general" selected>General</option>
            <option value="exercise">Exercise</option>
            <option value="work">Work</option>
            <option value="sleep">Sleep</option>
            <option value="leisure">Leisure</option>
            <option value="admin">Admin</option>
          </select>
        </div>

        <div>
          <label style="display:block; font-size:12px; color:#aaa; margin-bottom:4px;">Happiness Δ (−100..100)</label>
          <input type="number" id="reminder-happinessDelta" min="-100" max="100" value="0" />
        </div>

        <div>
          <label style="display:block; font-size:12px; color:#aaa; margin-bottom:4px;">Sadness Δ (−100..100)</label>
          <input type="number" id="reminder-sadnessDelta" min="-100" max="100" value="0" />
        </div>

        <div>
          <label style="display:block; font-size:12px; color:#aaa; margin-bottom:4px;">Money (€) (negative = cost)</label>
          <input type="number" id="reminder-moneyEUR" step="0.01" value="0" />
        </div>

        <div>
          <label style="display:block; font-size:12px; color:#aaa; margin-bottom:4px;">End date (optional)</label>
          <input type="datetime-local" id="reminder-endDate" />
        </div>

        <div style="grid-column: 1 / -1;">
          <label style="display:block; font-size:12px; color:#aaa; margin-bottom:4px;">Action type</label>
          <select id="reminder-actionType">
            <option value="none" selected>None</option>
            <option value="web">Web action (draggable iframe)</option>
            <option value="link-intent">Link / Intent</option>
          </select>
        </div>

        <div id="action-url-block" style="grid-column: 1 / -1; display:none;">
          <label style="display:block; font-size:12px; color:#aaa; margin-bottom:4px;">Action URL</label>
          <input type="text" id="reminder-actionUrl" placeholder="https://..." />
        </div>

        <div id="intent-block" style="grid-column: 1 / -1; display:none;">
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
            <div>
              <label style="display:block; font-size:12px; color:#aaa; margin-bottom:4px;">Preset</label>
              <select id="reminder-intentPreset">
                ${INTENT_PRESETS.map(p => `<option value="${p.key}">${escapeHtml(p.label)}</option>`).join("")}
              </select>
            </div>
            <div id="intent-custom-block" style="display:none;">
              <label style="display:block; font-size:12px; color:#aaa; margin-bottom:4px;">Custom intent / URL</label>
              <input type="text" id="reminder-intentCustom" placeholder="myapp://..., intent://..., https://..." />
            </div>
          </div>
          <div style="margin-top:6px; font-size:11px; color:#777;">
            Note: on desktop/PWA, intents behave as links. Native iOS/Android handling depends on installed apps and OS routing.
          </div>
        </div>
      </div>
    `;

    formEl.appendChild(wrap);

    const fields = {
      durationMinutes: document.getElementById('reminder-durationMinutes'),
      activityKind: document.getElementById('reminder-activityKind'),
      happinessDelta: document.getElementById('reminder-happinessDelta'),
      sadnessDelta: document.getElementById('reminder-sadnessDelta'),
      moneyEUR: document.getElementById('reminder-moneyEUR'),
      endDate: document.getElementById('reminder-endDate'),
      actionType: document.getElementById('reminder-actionType'),
      actionUrl: document.getElementById('reminder-actionUrl'),
      intentPreset: document.getElementById('reminder-intentPreset'),
      intentCustom: document.getElementById('reminder-intentCustom'),
      blocks: {
        actionUrl: document.getElementById('action-url-block'),
        intent: document.getElementById('intent-block'),
        intentCustom: document.getElementById('intent-custom-block')
      }
    };

    fields.actionType.addEventListener('change', syncActionFieldsVisibility);
    fields.intentPreset.addEventListener('change', syncActionFieldsVisibility);

    function syncActionFieldsVisibility() {
      const t = fields.actionType.value;
      fields.blocks.actionUrl.style.display = t === 'web' ? 'block' : 'none';
      fields.blocks.intent.style.display = t === 'link-intent' ? 'block' : 'none';
      const preset = fields.intentPreset.value;
      fields.blocks.intentCustom.style.display = (t === 'link-intent' && preset === 'custom') ? 'block' : 'none';
    }
    // expose to outer scope
    window.syncActionFieldsVisibility = syncActionFieldsVisibility;
    syncActionFieldsVisibility();

    return fields;
  }

  function syncActionFieldsVisibility() {
    // placeholder replaced by injected function
    if (typeof window.syncActionFieldsVisibility === "function") window.syncActionFieldsVisibility();
  }

  // ---------- Cron helpers (existing logic preserved) ----------
  function updateCronDisplay() {
    const fields = ['minute', 'hour', 'dom', 'month', 'dow'];
    let cronParts = [];
    fields.forEach(field => {
      const select = document.querySelector(`.cron-field[data-field="${field}"]`);
      if (select.value === "*") {
        cronParts.push("*");
      } else if (select.value === "?") {
        cronParts.push("?");
      } else if (select.value === "at") {
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
    if (m && d && h !== "" && mi !== "") {
      fixedDisplayDiv.textContent = `Fixed: ${mi} ${h} on ${d}/${m}`;
    } else {
      fixedDisplayDiv.textContent = "";
    }
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
    const parts = cronString.split(" ");
    const now = new Date();
    let candidate = new Date(now);
    for (let i = 0; i < 525600; i++) {
      candidate = new Date(now.getTime() + i * 60000);
      let match = true;
      if (parts[0] !== "*" && parts[0] !== "?" && candidate.getMinutes() !== parseInt(parts[0])) match = false;
      if (parts[1] !== "*" && parts[1] !== "?" && candidate.getHours() !== parseInt(parts[1])) match = false;
      if (parts[2] !== "*" && parts[2] !== "?" && candidate.getDate() !== parseInt(parts[2])) match = false;
      if (parts[3] !== "*" && parts[3] !== "?" && (candidate.getMonth() + 1) !== parseInt(parts[3])) match = false;
      if (parts[4] !== "*" && parts[4] !== "?" && candidate.getDay() !== parseInt(parts[4])) match = false;
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
  function clampFloat(v, min, max, fallback) {
    const n = parseFloat(v);
    if (Number.isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }
  function safeNumber(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  function formatEUR(v) {
    const n = safeNumber(v, 0);
    // Avoid Intl assumptions; keep stable formatting
    const sign = n < 0 ? "-" : "";
    const abs = Math.abs(n);
    return `${sign}${abs.toFixed(2)}`;
  }
  function normalizeUrl(url) {
    if (!url) return url;
    const u = url.trim();
    if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(u)) return u; // already has scheme
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
  function percent(value, denom) {
    if (!denom) return 0;
    return clampInt(Math.round((value / denom) * 100), 0, 100, 0);
  }

  function renderBar(label, valueText, pct) {
    return `
      <div style="margin:10px 0 8px;">
        <div style="display:flex; justify-content:space-between; align-items:baseline; gap:10px;">
          <div style="font-size:12px; color:#aaa;">${escapeHtml(label)}</div>
          <div style="font-size:12px; color:#ddd; font-weight:600;">${escapeHtml(valueText)}</div>
        </div>
        <div style="height:10px; background:#1b1b1b; border:1px solid #333; border-radius:999px; overflow:hidden; margin-top:6px;">
          <div style="height:100%; width:${pct}%; background:#2a7; border-radius:999px;"></div>
        </div>
      </div>
    `;
  }

  function renderEmojiSelect(selected) {
    return `
      <select id="hud-emoji-select" style="font-size:18px; background:#111; color:#ddd; border:1px solid #333; border-radius:10px; padding:4px 8px;">
        ${EMOJI_CHOICES.map(e => `<option value="${e}" ${e === selected ? "selected" : ""}>${e}</option>`).join("")}
      </select>
    `;
  }

  function renderSettingsPanel(s) {
    return `
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
        <div>
          <label style="display:block; font-size:12px; color:#aaa; margin-bottom:4px;">Sleep hours/day</label>
          <input id="hud-sleep-hours" type="number" min="0" max="24" value="${escapeHtmlAttr(s.sleepHoursPerDay)}" />
        </div>
        <div>
          <label style="display:block; font-size:12px; color:#aaa; margin-bottom:4px;">Work hours/day</label>
          <input id="hud-work-hours" type="number" min="0" max="24" value="${escapeHtmlAttr(s.workHoursPerDay)}" />
        </div>
        <div>
          <label style="display:block; font-size:12px; color:#aaa; margin-bottom:4px;">Work days/week</label>
          <input id="hud-work-days" type="number" min="0" max="7" value="${escapeHtmlAttr(s.workDaysPerWeek)}" />
        </div>
        <div>
          <label style="display:block; font-size:12px; color:#aaa; margin-bottom:4px;">Monthly salary (€)</label>
          <input id="hud-salary" type="number" step="0.01" value="${escapeHtmlAttr(s.monthlySalaryEUR)}" />
        </div>
      </div>
    `;
  }

  function renderActionLabel(task) {
    const t = task.actionType || "none";
    if (t === "web" && task.actionUrl) {
      return `<button class="action-btn" data-action="web" style="padding:6px 8px;">Open</button>`;
    }
    if (t === "link-intent" && task.actionUrl) {
      return `<button class="action-btn" data-action="link" style="padding:6px 8px;">Launch</button>`;
    }
    return `<span style="color:#777;">-</span>`;
  }

  // ---------- Time windows / estimation ----------
  function getWeekWindow(dateObj) {
    // Monday-based week
    const d = new Date(dateObj);
    const day = d.getDay(); // 0..6 (Sun..Sat)
    const diffToMonday = (day === 0 ? -6 : 1) - day;
    const start = new Date(d);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() + diffToMonday);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start: start.getTime(), end: end.getTime() };
  }

  function getMonthWindow(dateObj) {
    const d = new Date(dateObj);
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return { start: start.getTime(), end: end.getTime() };
  }

  function isTaskRelevantInWindow(task, startMs, endMs) {
    if (!task || task.archived) return false;

    // End date: if exists and already passed before window start, ignore
    if (task.endDate && task.endDate < startMs) return false;

    if (task.type === "punctual") {
      return task.dueTime >= startMs && task.dueTime < endMs;
    }
    if (task.type === "frequency") {
      // relevant if next due is inside, or if frequency suggests recurring within window
      if (task.dueTime >= startMs && task.dueTime < endMs) return true;

      // For frequency tasks, treat as ongoing unless endDate stops it
      return task.dueTime < endMs;
    }
    return false;
  }

  function estimatePlannedMinutesInWindow(tasks, startMs, endMs) {
    // Punctual: sum duration if dueTime in window
    // Frequency: estimate occurrences based on stored "X min (...)" prefix (best-effort, bounded)
    let total = 0;
    for (const t of tasks) {
      const dur = safeNumber(t.durationMinutes, 0);
      if (t.type === "punctual") {
        if (t.dueTime >= startMs && t.dueTime < endMs) total += dur;
      } else if (t.type === "frequency") {
        const freqMins = parseLeadingFrequencyMinutes(t.frequency);
        if (freqMins && freqMins > 0) {
          const windowMins = Math.max(0, Math.round((endMs - startMs) / 60000));
          const occ = Math.min(200, Math.max(1, Math.floor(windowMins / freqMins)));
          total += dur * occ;
        } else {
          // fallback: count once per window
          total += dur;
        }
      }
    }
    return total;
  }

  function estimateExerciseMinutesInWindow(tasks, startMs, endMs) {
    const exercise = tasks.filter(t => (t.activityKind || "").toLowerCase() === "exercise" || looksLikeExercise(t));
    return estimatePlannedMinutesInWindow(exercise, startMs, endMs);
  }

  function looksLikeExercise(task) {
    const s = `${task.name || ""} ${task.description || ""}`.toLowerCase();
    return ["sport", "gym", "run", "jog", "workout", "training", "swim", "cycle", "yoga", "cardio"].some(k => s.includes(k));
  }

  function sumFieldInWindow(tasks, field, startMs, endMs) {
    let total = 0;
    for (const t of tasks) {
      const v = safeNumber(t[field], 0);
      if (t.type === "punctual") {
        if (t.dueTime >= startMs && t.dueTime < endMs) total += v;
      } else if (t.type === "frequency") {
        const freqMins = parseLeadingFrequencyMinutes(t.frequency);
        if (freqMins && freqMins > 0) {
          const windowMins = Math.max(0, Math.round((endMs - startMs) / 60000));
          const occ = Math.min(200, Math.max(1, Math.floor(windowMins / freqMins)));
          total += v * occ;
        } else {
          total += v;
        }
      }
    }
    return total;
  }

  function sumMoneyInWindow(tasks, startMs, endMs) {
    let total = 0;
    for (const t of tasks) {
      const v = safeNumber(t.moneyEUR, 0);
      if (t.type === "punctual") {
        if (t.dueTime >= startMs && t.dueTime < endMs) total += v;
      } else if (t.type === "frequency") {
        const freqMins = parseLeadingFrequencyMinutes(t.frequency);
        if (freqMins && freqMins > 0) {
          const windowMins = Math.max(0, Math.round((endMs - startMs) / 60000));
          const occ = Math.min(200, Math.max(1, Math.floor(windowMins / freqMins)));
          total += v * occ;
        } else {
          total += v;
        }
      }
    }
    return total;
  }

  function parseLeadingFrequencyMinutes(freqDisplay) {
    if (!freqDisplay) return null;
    // expected: "X min (Fixed: ...)" or "X min (Cron: ...)"
    const m = String(freqDisplay).match(/^(\d+)\s*min\b/i);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function computeDailyRemaining(allTasks, s) {
    const out = [];
    const now = new Date();
    for (let i = 0; i < 7; i++) {
      const day = new Date(now);
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() + i);

      const start = day.getTime();
      const end = start + 24 * 60 * 60000;

      const dayTasks = allTasks.filter(t => !t.archived && isTaskRelevantInWindow(t, start, end));

      // planned minutes for that day
      const planned = estimatePlannedMinutesInWindow(dayTasks, start, end);

      // daily baseline
      const sleep = clampFloat(s.sleepHoursPerDay, 0, 24, DEFAULT_SETTINGS.sleepHoursPerDay) * 60;
      const isWorkDay = isWithinWorkPattern(day, s.workDaysPerWeek);
      const work = isWorkDay ? clampFloat(s.workHoursPerDay, 0, 24, DEFAULT_SETTINGS.workHoursPerDay) * 60 : 0;

      const remainingMinutes = Math.max(0, 24 * 60 - sleep - work - planned);

      out.push({
        label: day.toLocaleDateString(undefined, { weekday: "short" }),
        remainingHours: remainingMinutes / 60
      });
    }
    return out;
  }

  function isWithinWorkPattern(dayDate, workDaysPerWeek) {
    // Simple pattern: first N weekdays Mon..Sun
    const n = clampInt(workDaysPerWeek, 0, 7, 5);
    if (n === 0) return false;

    // dayIndex Monday=0..Sunday=6
    const jsDay = dayDate.getDay(); // Sun=0
    const dayIndex = jsDay === 0 ? 6 : jsDay - 1;
    return dayIndex < n;
  }
