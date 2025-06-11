const modal = document.getElementById("signup-modal");
const webAppUrl =
  "https://script.google.com/macros/s/AKfycbz42Lwplk3twZ2QoNXWdOcBLWAQlTrkAijaOGr5fjNxLWM3RadofU4ESSjIDcJCQTNHWw/exec";

let globalSchedule = {};
let globalMembers = [];
let selectedSlots = {}; // { "2025-06-08": ["18", "19"] }
let currentUser = ""; // Track currently selected user

function openModal() {
  modal.style.display = "flex";
}

window.addEventListener("click", (e) => {
  if (e.target === modal) modal.style.display = "none";
});

// Convert TCT time to user's local timezone
function convertTCTToLocal(date, hour) {
  // TCT is GMT/UTC (same as GMT+0), browser will convert to local timezone
  const tctDate = new Date(`${date}T${hour.toString().padStart(2, '0')}:00:00+00:00`);
  return tctDate;
}

function formatTimeForUser(date, hour) {
  const localDate = convertTCTToLocal(date, hour);
  const timeStr = localDate.toLocaleTimeString([], { 
    hour: '2-digit', 
    minute: '2-digit', 
    hour12: false 
  });
  const tctTime = `${hour.toString().padStart(2, '0')}:00`;
  return `${timeStr} (${tctTime} TCT)`;
}
async function loadSchedule() {
  try {
    console.log("Loading schedule from:", webAppUrl);
    const res = await fetch(webAppUrl);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    console.log("Schedule loaded successfully:", Object.keys(data));
    globalSchedule = data;

    const container = document.getElementById("schedule-table");
    container.innerHTML = "";
    const table = document.createElement("table");

    const dates = Object.keys(data).sort();
    console.log("Available dates:", dates);

    // Extract members from first available date/hour
    let members = [];
    if (dates.length > 0) {
      const firstDate = dates[0];
      const hours = Object.keys(data[firstDate]);
      if (hours.length > 0) {
        members = Object.keys(data[firstDate][hours[0]]).sort();
      }
    }

    console.log("Available members:", members);
    globalMembers = members;

    // Build the schedule table
    const row1 = document.createElement("tr");
    row1.appendChild(document.createElement("th")).textContent = "Name";
    for (const date of dates) {
      const th = document.createElement("th");
      th.colSpan = Object.keys(data[date]).length;
      th.textContent = date;
      row1.appendChild(th);
    }
    table.appendChild(row1);

    const row2 = document.createElement("tr");
    row2.appendChild(document.createElement("th")).textContent = "Local Time (TCT)";
    for (const date of dates) {
      const hours = Object.keys(data[date]).sort(
        (a, b) => parseInt(a) - parseInt(b)
      );
      for (const hour of hours) {
        const th = document.createElement("th");
        const localDate = convertTCTToLocal(date, parseInt(hour));
        const localTime = localDate.toLocaleTimeString([], { 
          hour: '2-digit', 
          minute: '2-digit', 
          hour12: false 
        });
        th.innerHTML = `${localTime}<br><small>(${hour.padStart(2, "0")}:00)</small>`;
        th.style.fontSize = "12px";
        row2.appendChild(th);
      }
    }
    table.appendChild(row2);

    const row3 = document.createElement("tr");
    row3.appendChild(document.createElement("th")).textContent = "# Signups";
    for (const date of dates) {
      const hours = Object.keys(data[date]).sort(
        (a, b) => parseInt(a) - parseInt(b)
      );
      for (const hour of hours) {
        const users = data[date][hour];
        const count = Object.values(users).filter((v) => v === true).length;
        const td = document.createElement("td");
        td.textContent = count;
        // Color code based on capacity
        if (count >= 3) {
          td.style.backgroundColor = "#ffcccb"; // Light red for full
          td.style.fontWeight = "bold";
        } else if (count >= 2) {
          td.style.backgroundColor = "#fff176"; // Yellow for almost full
        }
        row3.appendChild(td);
      }
    }
    table.appendChild(row3);

    for (const member of members) {
      const row = document.createElement("tr");
      const tdName = document.createElement("td");
      tdName.textContent = member;
      row.appendChild(tdName);
      for (const date of dates) {
        const hours = Object.keys(data[date]).sort(
          (a, b) => parseInt(a) - parseInt(b)
        );
        for (const hour of hours) {
          const td = document.createElement("td");
          td.textContent = data[date][hour][member] ? "✅" : "";
          row.appendChild(td);
        }
      }
      table.appendChild(row);
    }

    container.appendChild(table);

    // Populate user dropdown
    const userSelect = document.getElementById("user");
    userSelect.innerHTML =
      '<option value="">Select your name</option>' +
      members
        .map((name) => `<option value="${name}">${name}</option>`)
        .join("");

    console.log("User dropdown populated with", members.length, "members");

    // Populate date dropdown
    const dateSelect = document.getElementById("date");
    dateSelect.innerHTML =
      '<option value="">Select date</option>' +
      dates.map((d) => `<option value="${d}">${d}</option>`).join("");

    console.log("Date dropdown populated with", dates.length, "dates");

    // Clear hour checkboxes
    document.getElementById("hour-checkboxes").innerHTML = "";
  } catch (error) {
    console.error("Error loading schedule:", error);
    document.getElementById(
      "schedule-table"
    ).innerHTML = `<p style="color: red;">Failed to load schedule: ${error.message}</p>`;
  }
}

function updateAvailableHours() {
  const selectedDate = document.getElementById("date").value;
  const container = document.getElementById("hour-checkboxes");
  container.innerHTML = "";

  console.log("Updating hours for date:", selectedDate);

  if (!selectedDate || !globalSchedule[selectedDate]) {
    console.log("No valid date selected or no data for date");
    return;
  }

  const hours = Object.keys(globalSchedule[selectedDate]).sort(
    (a, b) => parseInt(a) - parseInt(b)
  );
  console.log("Available hours for", selectedDate, ":", hours);

  hours.forEach((hour) => {
    const div = document.createElement("div");
    div.style.display = "flex";
    div.style.alignItems = "center";
    div.style.marginBottom = "5px";
    div.style.padding = "5px";
    div.style.border = "1px solid #ddd";
    div.style.borderRadius = "4px";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = `hour-${hour}`;
    checkbox.name = "hours";
    checkbox.value = hour;
    checkbox.style.marginRight = "8px";

    // Check if current user already has this slot booked
    const isCurrentlyBooked = currentUser && 
      globalSchedule[selectedDate][hour][currentUser] === true;
    
    // Check how many people are signed up for this slot
    const signupCount = Object.values(globalSchedule[selectedDate][hour])
      .filter(v => v === true).length;
    
    // Disable if slot is full (3+ people) and user isn't already booked
    const isSlotFull = signupCount >= 3 && !isCurrentlyBooked;

    if (isCurrentlyBooked) {
      checkbox.checked = true;
    }

    if (isSlotFull) {
      checkbox.disabled = true;
      div.style.backgroundColor = "#f5f5f5";
      div.style.opacity = "0.6";
    }

    const label = document.createElement("label");
    label.htmlFor = `hour-${hour}`;
    label.textContent = formatTimeForUser(selectedDate, parseInt(hour));
    label.style.cursor = isSlotFull ? "not-allowed" : "pointer";
    label.style.flex = "1";

    // Add signup count indicator
    const countSpan = document.createElement("span");
    countSpan.textContent = `(${signupCount}/3)`;
    countSpan.style.marginLeft = "10px";
    countSpan.style.fontSize = "12px";
    countSpan.style.color = signupCount >= 3 ? "red" : signupCount >= 2 ? "orange" : "green";

    if (isSlotFull) {
      const fullLabel = document.createElement("span");
      fullLabel.textContent = " FULL";
      fullLabel.style.color = "red";
      fullLabel.style.fontWeight = "bold";
      fullLabel.style.marginLeft = "5px";
      label.appendChild(fullLabel);
    }

    // Event listener for individual checkbox
    checkbox.addEventListener("change", function () {
      updateSelectedSlots();
    });

    div.appendChild(checkbox);
    div.appendChild(label);
    div.appendChild(countSpan);
    container.appendChild(div);
  });

  // Don't restore previous selections when user changes - show current bookings instead
}

function updateSelectedSlots() {
  const date = document.getElementById("date").value;
  if (!date) return;

  const checkedHours = Array.from(
    document.querySelectorAll('#hour-checkboxes input[name="hours"]:checked')
  ).map((cb) => cb.value);

  selectedSlots[date] = checkedHours;
  console.log("Updated selectedSlots:", selectedSlots);
}

// Event listeners
document.getElementById("date").addEventListener("change", function () {
  const date = this.value;
  console.log("Date changed to:", date);

  if (date && !selectedSlots[date]) {
    selectedSlots[date] = [];
  }

  updateAvailableHours();
});

// Update when user changes
document.getElementById("user").addEventListener("change", function () {
  currentUser = this.value;
  console.log("User changed to:", currentUser);
  
  // Reset selected slots when user changes
  selectedSlots = {};
  
  // Update hours display to show current user's bookings
  updateAvailableHours();
});

// ENHANCED SUBMISSION CODE - Handles booking AND unbooking
document
  .getElementById("signup-form")
  .addEventListener("submit", async function (e) {
    e.preventDefault();

    const userElement = document.getElementById("user");
    const user = userElement.value;
    const feedback = document.getElementById("feedback");

    console.log("=== SUBMISSION ATTEMPT ===");
    console.log("Selected user:", user);

    if (!user || user === "") {
      feedback.textContent = "Please select your name.";
      feedback.style.color = "red";
      return;
    }

    const selectedDate = document.getElementById("date").value;
    if (!selectedDate) {
      feedback.textContent = "Please select a date.";
      feedback.style.color = "red";
      return;
    }

    // Get current state of checkboxes
    const currentlyCheckedHours = Array.from(
      document.querySelectorAll('#hour-checkboxes input[name="hours"]:checked')
    ).map((cb) => parseInt(cb.value));

    // Get user's previous bookings for this date
    const previousBookings = [];
    if (globalSchedule[selectedDate]) {
      Object.keys(globalSchedule[selectedDate]).forEach(hour => {
        if (globalSchedule[selectedDate][hour][user] === true) {
          previousBookings.push(parseInt(hour));
        }
      });
    }

    console.log("Currently checked hours:", currentlyCheckedHours);
    console.log("Previous bookings:", previousBookings);

    // Find changes
    const hoursToBook = currentlyCheckedHours.filter(h => !previousBookings.includes(h));
    const hoursToUnbook = previousBookings.filter(h => !currentlyCheckedHours.includes(h));

    console.log("Hours to book:", hoursToBook);
    console.log("Hours to unbook:", hoursToUnbook);

    if (hoursToBook.length === 0 && hoursToUnbook.length === 0) {
      feedback.textContent = "No changes to make.";
      feedback.style.color = "orange";
      return;
    }

    // Check for slot capacity before booking
    for (const hour of hoursToBook) {
      const signupCount = Object.values(globalSchedule[selectedDate][hour])
        .filter(v => v === true).length;
      if (signupCount >= 3) {
        feedback.textContent = `Sorry, the ${formatTimeForUser(selectedDate, hour)} slot is full (3/3 people).`;
        feedback.style.color = "red";
        return;
      }
    }

    feedback.textContent = "Submitting...";
    feedback.style.color = "blue";

    try {
      const submissions = [];

      // Handle bookings
      if (hoursToBook.length > 0) {
        const bookParams = new URLSearchParams({
          action: 'signup',
          user: user,
          date: selectedDate,
          hours: JSON.stringify(hoursToBook)
        });

        submissions.push(
          fetch(`${webAppUrl}?${bookParams.toString()}`, { method: "GET" })
            .then(response => response.text())
            .then(text => ({ type: 'book', hours: hoursToBook, result: text }))
        );
      }

      // Handle unbookings  
      if (hoursToUnbook.length > 0) {
        const unbookParams = new URLSearchParams({
          action: 'unbook',
          user: user,
          date: selectedDate,
          hours: JSON.stringify(hoursToUnbook)
        });

        submissions.push(
          fetch(`${webAppUrl}?${unbookParams.toString()}`, { method: "GET" })
            .then(response => response.text())
            .then(text => ({ type: 'unbook', hours: hoursToUnbook, result: text }))
        );
      }

      const results = await Promise.all(submissions);
      console.log("All submission results:", results);

      const failures = results.filter(r => 
        !r.result.includes("Signup recorded") && 
        !r.result.includes("Unbook recorded")
      );

      if (failures.length === 0) {
        let message = "";
        if (hoursToBook.length > 0) {
          message += `✅ Booked: ${hoursToBook.map(h => `${h}:00 TCT`).join(", ")}`;
        }
        if (hoursToUnbook.length > 0) {
          if (message) message += "\n";
          message += `❌ Removed: ${hoursToUnbook.map(h => `${h}:00 TCT`).join(", ")}`;
        }
        
        feedback.textContent = message;
        feedback.style.color = "green";
        feedback.style.whiteSpace = "pre-line";

        setTimeout(() => {
          modal.style.display = "none";
          loadSchedule();
        }, 2000);
      } else {
        feedback.textContent = `Some changes failed: ${failures.map(f => f.result).join(", ")}`;
        feedback.style.color = "red";
      }
    } catch (error) {
      console.error("Submission error:", error);
      feedback.textContent = `Failed: ${error.message}`;
      feedback.style.color = "red";
    }
  });

// Initialize when page loads
document.addEventListener("DOMContentLoaded", function () {
  console.log("Page loaded, initializing...");
  loadSchedule();
});

// Also try loading immediately if DOM is already ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", loadSchedule);
} else {
  loadSchedule();
}
