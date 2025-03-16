document.addEventListener('DOMContentLoaded', async () => {
  const dbInstance = await window.dbAPI.openDB();
  const storeName = window.dbAPI.storeName || 'tasks';
  loadReminders();

  const searchInput = document.getElementById('search-input');
  const sortSelect = document.getElementById('sort-select');
  const addButton = document.getElementById('add-button');
  const exportButton = document.getElementById('export-button');
  const importButton = document.getElementById('import-button');
  const clearButton = document.getElementById('clear-button');
  const importFileInput = document.getElementById('import-file');
  const remindersTableBody = document.querySelector('#reminders-table tbody');

  // Modal elements
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

  // Frequency section elements (shown when type == frequency)
  const frequencySection = document.getElementById('frequency-section');
  // Radio buttons for fixed vs. cron options:
  const freqOptionRadios = document.getElementsByName('frequency-option');
  // Fixed date inputs:
  const fixedFrequencyDiv = document.getElementById('fixed-frequency');
  const fixedMonthField = document.getElementById('fixed-month');
  const fixedDayField = document.getElementById('fixed-day');
  const fixedHourField = document.getElementById('fixed-hour');
  const fixedMinuteField = document.getElementById('fixed-minute');
  const fixedDisplayDiv = document.getElementById('fixed-display');
  // Cron builder elements:
  const cronBuilderDiv = document.getElementById('cron-builder');
  const cronDisplayDiv = document.getElementById('cron-display');
  const cronFieldSelects = document.querySelectorAll('.cron-field');
  const cronInputs = document.querySelectorAll('.cron-input');

  // Show/hide frequency section based on reminder type
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

  // Toggle between fixed and cron options using radio buttons
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

  // For each cron field select, show/hide corresponding input
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
  cronInputs.forEach(input => {
    input.addEventListener('input', updateCronDisplay);
  });

  function updateCronDisplay() {
    // Build cron string from five fields.
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
  [fixedMonthField, fixedDayField, fixedHourField, fixedMinuteField].forEach(el => {
    el.addEventListener('input', updateFixedDisplay);
  });

  // Open modal for new reminder
  addButton.addEventListener('click', () => {
    reminderForm.reset();
    reminderIdField.value = "";
    reminderCreationDateField.value = "";
    // Reset frequency section: default to fixed option
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
    modal.style.display = 'block';
  });

  // Close modal
  closeModal.addEventListener('click', () => {
    modal.style.display = 'none';
  });
  window.addEventListener('click', (event) => {
    if (event.target === modal) {
      modal.style.display = 'none';
    }
  });

  // Compute next occurrence for fixed mode (specific date)
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

  // Naïve next-occurrence computation from a cron string
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
    return now;
  }

  reminderForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const now = Date.now();
    let dueTime;
    let frequencyMinutes = null;
    let frequencyDisplay = "";
    const type = reminderTypeField.value;
    if (type === 'frequency') {
      // Determine which option is chosen: fixed or cron
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
        frequencyMinutes = Math.round((dueTime - now) / 60000);
        frequencyDisplay = `${frequencyMinutes} min (Fixed: ${minute} ${hour} on ${day}/${month})`;
      } else {
        const cronString = cronDisplayDiv.textContent.replace("Cron: ", "");
        dueTime = computeNextOccurrence(cronString);
        frequencyMinutes = Math.round((dueTime - now) / 60000);
        frequencyDisplay = `${frequencyMinutes} min (Cron: ${cronString})`;
      }
    } else {
      const dueDateValue = reminderDueDateField.value;
      if (!dueDateValue) {
        alert("Please select a due date and time.");
        return;
      }
      dueTime = new Date(dueDateValue).getTime();
      frequencyDisplay = "-";
    }
    const reminder = {
      uuid: reminderIdField.value || generateUUID(),
      name: reminderNameField.value,
      description: reminderDescField.value,
      type: type,
      frequency: type === 'frequency' ? frequencyDisplay : '-',
      dueTime: dueTime,
      priority: reminderPriorityField.value,
      modificationDate: now
    };
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

  // Update list on search/sort changes
  searchInput.addEventListener('input', loadReminders);
  sortSelect.addEventListener('change', loadReminders);
  async function loadReminders() {
    let reminders = await window.dbAPI.getAllTasks();
    const now = Date.now();
    // Filter out punctual reminders more than one week past due
    reminders = reminders.filter(reminder => {
      if (reminder.type === 'punctual') {
        return now <= (reminder.dueTime + 7 * 24 * 60 * 60000);
      }
      return true;
    });
    const searchTerm = searchInput.value.toLowerCase();
    if (searchTerm) {
      reminders = reminders.filter(r => r.name.toLowerCase().includes(searchTerm));
    }
    const sortValue = sortSelect.value;
    if (sortValue === 'remaining-asc') {
      reminders.sort((a, b) => (a.dueTime - now) - (b.dueTime - now));
    } else if (sortValue === 'remaining-desc') {
      reminders.sort((a, b) => (b.dueTime - now) - (a.dueTime - now));
    } else if (sortValue === 'name-asc') {
      reminders.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortValue === 'name-desc') {
      reminders.sort((a, b) => b.name.localeCompare(a.name));
    }
    renderReminders(reminders);
  }

  // In renderReminders(), when building each reminder row,
  // add extra data attributes for frequency reminders so that
  // we can recalculate the next occurrence later.
  function renderReminders(reminders) {
    remindersTableBody.innerHTML = '';
    reminders.slice(0, 20).forEach(reminder => {
      let priorityClass = '';
      if (reminder.priority === 'high') {
        priorityClass = 'priority priority-high';
      } else if (reminder.priority === 'medium') {
        priorityClass = 'priority priority-medium';
      } else {
        priorityClass = 'priority priority-low';
      }
    
      // Format event date/time
      const eventDate = new Date(reminder.dueTime);
      const eventDateString = eventDate.toLocaleString();      

      // For frequency reminders, parse the stored frequency display string to extract
      // fixed or cron configuration.
      let extraDataAttrs = '';
      if (reminder.type === 'frequency') {
        if (reminder.frequency.includes("Fixed:")) {
          // Expected format: "X min (Fixed: minute hour on day/month)"
          const fixedPart = reminder.frequency.split("Fixed:")[1].trim();
          const parts = fixedPart.split(" ");
          if (parts.length >= 4) {
            const fixedMinute = parts[0];
            const fixedHour = parts[1];
            const dm = parts[3].split("/");
            if(dm.length === 2) {
              const fixedDay = dm[0];
              const fixedMonth = dm[1];
              extraDataAttrs = `data-freq-option="fixed" data-fixed-month="${fixedMonth}" data-fixed-day="${fixedDay}" data-fixed-hour="${fixedHour}" data-fixed-minute="${fixedMinute}"`;
            }
          }
        } else if (reminder.frequency.includes("Cron:")) {
          const cronPart = reminder.frequency.split("Cron:")[1].replace(")", "").trim();
          extraDataAttrs = `data-freq-option="cron" data-cron-string="${cronPart}"`;
        }
      }
      
      // Build countdown cell.
      const countdownCell = `<td class="countdown" data-duetime="${reminder.dueTime}" data-type="${reminder.type}" ${extraDataAttrs}>
        ${formatCountdown(reminder.dueTime - Date.now())}
      </td>`;
      
      const tr = document.createElement('tr');
      tr.innerHTML = `
        ${countdownCell}
        <td class="important-data">${reminder.name}</td>
        <td class="important-data">${eventDateString}</td>
        <td class="${priorityClass}">${reminder.priority}</td>
        <td>${reminder.description}</td>
        <td>${reminder.uuid}</td>
        <td>${reminder.frequency}</td>
        <td>${reminder.type}</td>
        <td>${reminder.creationDate ? new Date(reminder.creationDate).toLocaleString() : '-'}</td>
        <td>${new Date(reminder.modificationDate).toLocaleString()}</td>
        <td>
          <button onclick="editReminder('${reminder.uuid}')">Edit</button>
          <button onclick="deleteReminder('${reminder.uuid}')">Delete</button>
        </td>
      `;
      remindersTableBody.appendChild(tr);
    });
  }

  // Update the countdown every second, recalculating for frequency reminders when needed.
  setInterval(() => {
    document.querySelectorAll('.countdown').forEach(cell => {
      let dueTime = parseInt(cell.getAttribute('data-duetime'));
      const type = cell.getAttribute('data-type');
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

  window.editReminder = async (uuid) => {
    const reminders = await window.dbAPI.getAllTasks();
    const reminder = reminders.find(r => r.uuid === uuid);
    if (reminder) {
      reminderIdField.value = reminder.uuid;
      reminderCreationDateField.value = reminder.creationDate;
      reminderNameField.value = reminder.name;
      reminderDescField.value = reminder.description;
      reminderTypeField.value = reminder.type;
      reminderPriorityField.value = reminder.priority;
      if (reminder.type === 'frequency') {
        frequencySection.style.display = 'block';
        reminderDueDateField.style.display = 'none';
        if (reminder.frequency.indexOf("Fixed:") !== -1) {
          document.querySelector('input[name="frequency-option"][value="fixed"]').checked = true;
          fixedFrequencyDiv.style.display = 'block';
          cronBuilderDiv.style.display = 'none';
          const fixedPart = reminder.frequency.split("Fixed:")[1];
          if (fixedPart) {
            const parts = fixedPart.trim().split(" ");
            fixedMinuteField.value = parts[0];
            fixedHourField.value = parts[1];
            const dm = parts[3].split("/");
            fixedDayField.value = dm[0];
            fixedMonthField.value = dm[1];
          }
          updateFixedDisplay();
        } else {
          document.querySelector('input[name="frequency-option"][value="cron"]').checked = true;
          fixedFrequencyDiv.style.display = 'none';
          cronBuilderDiv.style.display = 'block';
          const freqParts = reminder.frequency.split("(");
          if (freqParts.length >= 2) {
            const cronPart = freqParts[1].replace(")", "").replace("Cron:", "").trim();
            const cronVals = cronPart.split(" ");
            const fields = ['minute', 'hour', 'dom', 'month', 'dow'];
            fields.forEach(field => {
              const select = document.querySelector(`.cron-field[data-field="${field}"]`);
              const input = document.querySelector(`.cron-input[data-field="${field}"]`);
              const val = cronVals.shift() || "*";
              if (val === "*" || val === "?") {
                select.value = val;
                input.style.display = 'none';
                input.value = "";
              } else {
                select.value = "at";
                input.style.display = 'inline-block';
                input.value = val;
              }
            });
            updateCronDisplay();
          }
        }
      } else {
        frequencySection.style.display = 'none';
        reminderDueDateField.style.display = 'block';
        const dt = new Date(reminder.dueTime);
        reminderDueDateField.value = dt.toISOString().slice(0,16);
      }
      modal.style.display = 'block';
    }
  };

  window.deleteReminder = async (uuid) => {
    await window.dbAPI.deleteTask(uuid);
    loadReminders();
  };

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

  importButton.addEventListener('click', () => {
    importFileInput.click();
  });

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
        const mergedReminders = Array.from(existingMap.values());
        for (const rem of mergedReminders) {
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
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js')
    .then(reg => console.log('Service Worker Registered:', reg))
    .catch(err => console.error('Service Worker Registration Failed:', err));
}

function formatCountdown(ms) {
  if (ms < 0) return "Due";
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / (3600 * 24));
  const hours = Math.floor((totalSec % (3600 * 24)) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

