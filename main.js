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
