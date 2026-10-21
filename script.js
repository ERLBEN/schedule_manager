const USERS_KEY = "ssmUsers";
const SESSION_KEY = "ssmSession";
const byId = id => document.getElementById(id);

function readStore(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

let users = readStore(USERS_KEY, []);
if (!Array.isArray(users)) users = [];

let sessionId = null;
try { sessionId = localStorage.getItem(SESSION_KEY); } catch {}

const currentUser = users.find(u => u.id === sessionId) || null;
const USER_ID = currentUser ? currentUser.id : "guest";

byId("authScreen").hidden = !!currentUser;
document.querySelector(".app").hidden = !currentUser;

if (currentUser) {
  byId("userName").textContent = currentUser.name;
  byId("profileInitial").textContent = currentUser.name.charAt(0).toUpperCase();
}

async function hashPassword(password, salt) {
  const text = salt + password;
  if (window.crypto && crypto.subtle) {
    const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (Math.imul(31, hash) + text.charCodeAt(i)) | 0;
  return "x" + hash;
}

const newSalt = () =>
  Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

function authError(message) {
  byId("authError").textContent = message;
  byId("authError").hidden = !message;
}

function startSession(id) {
  try {
    localStorage.setItem(SESSION_KEY, id);
  } catch {
    authError("Unable to save your login. Please check your browser storage.");
    return;
  }
  location.reload();
}

document.querySelectorAll("[data-auth-tab]").forEach(tab => {
  tab.addEventListener("click", () => {
    const signup = tab.dataset.authTab === "signup";
    document.querySelectorAll("[data-auth-tab]").forEach(t =>
      t.classList.toggle("active", t === tab));
    byId("loginForm").hidden = signup;
    byId("signupForm").hidden = !signup;
    byId("authSub").textContent = signup
      ? "Create your own student profile."
      : "Log in to see your own schedule.";
    authError("");
  });
});

byId("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  const email = byId("loginEmail").value.trim().toLowerCase();
  const user = users.find(u => u.email === email);
  const hash = user ? await hashPassword(byId("loginPassword").value, user.salt) : null;

  if (!user || hash !== user.hash) {
    authError("Incorrect email or password.");
    return;
  }
  startSession(user.id);
});

byId("signupForm").addEventListener("submit", async event => {
  event.preventDefault();
  const name = byId("signupName").value.trim();
  const email = byId("signupEmail").value.trim().toLowerCase();
  const password = byId("signupPassword").value;

  if (!name) return authError("Please enter your name.");
  if (password.length < 6) return authError("Password must be at least 6 characters.");
  if (password !== byId("signupConfirm").value) return authError("Passwords don't match.");
  if (users.some(u => u.email === email)) return authError("An account with that email already exists.");

  const salt = newSalt();
  const user = {
    id: Date.now().toString(),
    name,
    email,
    salt,
    hash: await hashPassword(password, salt)
  };

  try {
    // First account adopts any schedule data saved before accounts existed.
    if (users.length === 0) {
      ["studentScheduleManager", "ssmTeachers", "ssmTasks", "ssmReadNotifs"].forEach(key => {
        const old = localStorage.getItem(key);
        if (old !== null) localStorage.setItem(key + ":" + user.id, old);
      });
    }
    localStorage.setItem(USERS_KEY, JSON.stringify([...users, user]));
  } catch {
    return authError("Unable to save your account. Please check your browser storage.");
  }
  startSession(user.id);
});

byId("logoutBtn").addEventListener("click", () => {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
  location.reload();
});

const STORAGE_KEY = "studentScheduleManager:" + USER_ID;

let schedules = [];

try {
  schedules = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  if (!Array.isArray(schedules)) schedules = [];
} catch {
  schedules = [];
}

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const colors = ["blue", "lavender", "pink", "purple"];

const $ = id => document.getElementById(id);

const dialog = $("scheduleDialog");
const form = $("scheduleForm");

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function saveSchedules() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(schedules));
    return true;
  } catch (error) {
    alert("Unable to save. Please check your browser storage.");
    return false;
  }
}

function formatTime(hour) {
  const h = Number(hour);
  const suffix = h >= 12 ? "PM" : "AM";
  const displayHour = h % 12 || 12;
  return `${displayHour}:00 ${suffix}`;
}

function renderSchedules() {
  days.forEach(day => {
    $(day).innerHTML = "";
  });

  schedules.forEach(schedule => {
    const column = $(schedule.day);
    if (!column) return;

    const card = document.createElement("article");
    const color = colors[
      Math.abs(schedule.subject.length) % colors.length
    ];

    card.className = `class-card ${color}`;

    card.innerHTML = `
      <h5>${escapeHTML(schedule.subject)}</h5>
      <p>${escapeHTML(schedule.type)}</p>
      <p class="class-time">
        ${formatTime(schedule.start)}
        - ${formatTime(Number(schedule.start) + Number(schedule.duration))}
      </p>
      <button type="button" aria-label="Delete schedule">×</button>
    `;

    card.querySelector("button").style.cssText =
      "float:right;border:0;background:transparent;color:inherit;cursor:pointer";

    card.querySelector("button").addEventListener("click", () => {
      if (!confirm(`Delete ${schedule.subject}?`)) return;

      const oldSchedules = schedules;
      schedules = schedules.filter(item => item.id !== schedule.id);

      if (!saveSchedules()) {
        schedules = oldSchedules;
        return;
      }

      renderAll();
    });

    column.appendChild(card);
  });

  renderUpcoming();
}

function renderUpcoming() {
  const container = $("upcomingEvents");

  if (schedules.length === 0) {
    container.innerHTML =
      '<p class="empty">No schedules added yet.</p>';
    return;
  }

  container.innerHTML = schedules.slice(0, 6).map(schedule => `
    <article class="event-item">
      <div class="event-date">
        ${escapeHTML(schedule.day.slice(0, 3))}
      </div>
      <div class="event-info">
        <h4>${escapeHTML(schedule.subject)}</h4>
        <p>${formatTime(schedule.start)} · ${escapeHTML(schedule.type)}</p>
      </div>
    </article>
  `).join("");
}

function renderCalendar() {
  const calendar = $("calendar");
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  $("monthTitle").textContent = now.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric"
  });

  const weekdays = ["S", "M", "T", "W", "T", "F", "S"];
  const firstDay = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();

  let html = weekdays.map(day =>
    `<span>${day}</span>`
  ).join("");

  for (let i = 0; i < firstDay; i++) {
    html += "<span></span>";
  }

  for (let day = 1; day <= totalDays; day++) {
    const today = day === now.getDate() ? "today" : "";
    html += `<button type="button" class="${today}">${day}</button>`;
  }

  calendar.innerHTML = html;
}

function renderAll() {
  renderSchedules();
  renderCalendar();
  renderOthers();
}

$("openForm").addEventListener("click", () => {
  form.reset();
  dialog.showModal();
});

$("cancelForm").addEventListener("click", () => {
  dialog.close();
});

form.addEventListener("submit", event => {
  event.preventDefault();

  const subject = $("subject").value.trim();
  const day = $("day").value;
  const start = Number($("startTime").value);
  const duration = Number($("duration").value);
  const type = $("type").value;

  if (!subject) {
    alert("Please enter a subject or activity name.");
    return;
  }

  if (start + duration > 18) {
    alert("Please choose a duration that ends by 6 PM.");
    return;
  }

  const newSchedule = {
    id: Date.now().toString(),
    subject,
    day,
    start,
    duration,
    type
  };

  const oldSchedules = schedules;
  schedules = [...schedules, newSchedule];

  if (!saveSchedules()) {
    schedules = oldSchedules;
    return;
  }

  renderAll();
  dialog.close();
  form.reset();
});

$("todayBtn").addEventListener("click", () => {
  renderAll();
});


/* ---------- Extra pages ---------- */
const KEY_TEACHERS = "ssmTeachers:" + USER_ID;
const KEY_TASKS = "ssmTasks:" + USER_ID;

function loadList(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function storeList(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    alert("Unable to save. Please check your browser storage.");
    return false;
  }
}

let teachers = loadList(KEY_TEACHERS);
let tasks = loadList(KEY_TASKS);
let taskKind = "homework";

const titles = {
  dashboard: ["Dashboard", "Your week at a glance"],
  schedule: ["Schedule", "Manage your classes and activities"],
  teachers: ["Teachers", "Link a teacher to each of your subjects"],
  homework: ["Homework", "Remind yourself what's due"],
  tests: ["Tests", "Keep track of upcoming tests"],
  notifications: ["Notifications", "Reminders for what's due soon"],
  courses: ["My Courses", "Every subject on your schedule"]
};

function showView(name) {
  if (!titles[name]) name = "dashboard";
  document.querySelectorAll(".view").forEach(v => {
    v.hidden = v.id !== "view-" + name;
  });
  document.querySelectorAll(".nav-link").forEach(link => {
    link.classList.toggle("active", link.dataset.view === name);
  });
  $("pageTitle").textContent = titles[name][0];
  $("pageSub").textContent = titles[name][1];
}

document.querySelectorAll("[data-view]").forEach(el => {
  el.addEventListener("click", event => {
    event.preventDefault();
    showView(el.dataset.view);
  });
});

const subjects = () => [...new Set(schedules.map(s => s.subject))];
const dateStr = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysUntil = str =>
  Math.round((new Date(str + "T00:00") - new Date(dateStr(new Date()) + "T00:00")) / 864e5);
const dueLabel = n =>
  n < 0 ? `Overdue by ${-n} day${n === -1 ? "" : "s"}`
  : n === 0 ? "Due today"
  : n === 1 ? "Due tomorrow"
  : `Due in ${n} days`;
const todayName = () => ["Sunday", ...days, "Saturday"][new Date().getDay()];
const subjectOptions = extra =>
  (extra || "") + subjects().map(s =>
    `<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`).join("");

const row = (badge, title, sub, right = "") => `
  <div class="row">
    <div class="badge">${badge}</div>
    <div class="grow"><h4>${title}</h4><p>${sub}</p></div>
    ${right}
  </div>`;

function taskRow(task) {
  const n = daysUntil(task.due);
  const soon = !task.done && n <= 1 ? "soon" : "";
  return `
    <div class="row${task.done ? " done" : ""}">
      <input type="checkbox" data-act="toggle" data-id="${task.id}"
        ${task.done ? "checked" : ""} aria-label="Mark as done">
      <div class="grow">
        <h4>${escapeHTML(task.title)}</h4>
        <p>${escapeHTML(task.subject)} · <span class="${soon}">${dueLabel(n)}</span> (${escapeHTML(task.due)})</p>
      </div>
      <button type="button" class="x-btn" data-act="delTask" data-id="${task.id}"
        aria-label="Delete">×</button>
    </div>`;
}

function renderDashboard() {
  const pending = tasks.filter(t => !t.done)
    .sort((a, b) => a.due.localeCompare(b.due));
  const today = schedules.filter(s => s.day === todayName())
    .sort((a, b) => a.start - b.start);
  const stat = (n, label) =>
    `<div class="stat"><b>${n}</b><span>${label}</span></div>`;

  const firstName = currentUser ? currentUser.name.split(" ")[0] : "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const dateText = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric"
  });

  $("dashboardContent").innerHTML = `
    <div class="hero">
      <h2>${greeting}, ${escapeHTML(firstName)}! 👋</h2>
      <p>${dateText} · ${today.length
        ? `You have ${today.length} class${today.length === 1 ? "" : "es"} today`
        : "No classes today, enjoy the breathing room"}</p>
    </div>
    <div class="stats">
      ${stat(schedules.length, "Classes per week")}
      ${stat(subjects().length, "Courses")}
      ${stat(pending.filter(t => t.kind === "homework").length, "Homework pending")}
      ${stat(pending.filter(t => t.kind === "test").length, "Tests coming up")}
    </div>
    <div class="two-col">
      <div class="card-box">
        <h3>Today's Classes</h3>
        ${today.length ? today.map(s => row(
          formatTime(s.start), escapeHTML(s.subject), escapeHTML(s.type))).join("")
          : '<p class="empty">No classes today.</p>'}
      </div>
      <div class="card-box">
        <h3>Next Due</h3>
        ${pending.length ? pending.slice(0, 5).map(t => row(
          t.kind === "test" ? "Test" : "HW", escapeHTML(t.title),
          `${escapeHTML(t.subject)} · ${dueLabel(daysUntil(t.due))}`)).join("")
          : '<p class="empty">Nothing due. Nice!</p>'}
      </div>
    </div>`;
}

function renderTeachers() {
  const list = teachers.filter(t => subjects().includes(t.subject));
  const missing = subjects().filter(s => !teachers.some(t => t.subject === s));
  let html = list.map(t => row(
    escapeHTML(t.name.charAt(0).toUpperCase()),
    escapeHTML(t.name),
    `${escapeHTML(t.subject)}${t.email ? " · " + escapeHTML(t.email) : ""}`,
    `<button type="button" class="x-btn" data-act="delTeacher" data-id="${t.id}"
      aria-label="Remove teacher">×</button>`)).join("");

  if (!subjects().length) {
    html = '<p class="empty">Add a subject in your Schedule first, then link a teacher to it here.</p>';
  } else if (!list.length) {
    html = '<p class="empty">No teachers added yet.</p>';
  }
  if (missing.length && subjects().length) {
    html += `<p class="hint">No teacher yet for: ${missing.map(escapeHTML).join(", ")}</p>`;
  }
  $("teacherList").innerHTML = html;
}

function renderTasks() {
  [["homework", "homeworkList", "No homework reminders yet."],
   ["test", "testList", "No tests added yet."]].forEach(([kind, id, empty]) => {
    const items = tasks.filter(t => t.kind === kind)
      .sort((a, b) => Number(a.done) - Number(b.done) || a.due.localeCompare(b.due));
    $(id).innerHTML = items.length
      ? items.map(taskRow).join("")
      : `<p class="empty">${empty}</p>`;
  });
}

const KEY_READ = "ssmReadNotifs:" + USER_ID;
let readIds = loadList(KEY_READ);

function renderNotifications() {
  const items = tasks.filter(t => !t.done && daysUntil(t.due) <= 1)
    .sort((a, b) => a.due.localeCompare(b.due));
  const unread = items.filter(t => !readIds.includes(t.id)).length;

  $("notifBadge").textContent = unread;
  $("notifBadge").hidden = unread === 0;
  $("readAllBtn").disabled = unread === 0;

  $("notifList").innerHTML = items.length
    ? items.map(t => {
        const isRead = readIds.includes(t.id);
        const kind = t.kind === "test" ? "Test" : "Homework";
        return `
          <div class="row notif ${isRead ? "read" : "unread"}" role="button" tabindex="0"
            data-act="readNotif" data-id="${t.id}"
            aria-label="${isRead ? "Read" : "Unread"} reminder: ${escapeHTML(t.title)}">
            <div class="badge">${t.kind === "test" ? "Test" : "HW"}</div>
            <div class="grow">
              <h4>${kind}: ${escapeHTML(t.title)}</h4>
              <p>${escapeHTML(t.subject)} · <span class="soon">${dueLabel(daysUntil(t.due))}</span></p>
            </div>
            <span class="dot" title="Unread"></span>
          </div>`;
      }).join("")
    : '<p class="empty">You\'re all caught up. Nothing is due today or tomorrow.</p>';
}

function renderCourses() {
  const subs = subjects();
  $("courseList").innerHTML = subs.length ? subs.map(name => {
    const items = schedules.filter(s => s.subject === name);
    const hours = items.reduce((sum, s) => sum + Number(s.duration), 0);
    const who = teachers.filter(t => t.subject === name)
      .map(t => escapeHTML(t.name)).join(", ") || "No teacher yet";
    const due = tasks.filter(t => !t.done && t.subject === name).length;
    const when = items.map(s =>
      `${escapeHTML(s.day.slice(0, 3))} ${formatTime(s.start)}`).join(" · ");
    return `
      <article class="class-card course ${colors[name.length % colors.length]}">
        <h5>${escapeHTML(name)}</h5>
        <p>Teacher: ${who}</p>
        <p>${items.length} class${items.length === 1 ? "" : "es"} · ${hours} hr/week</p>
        <p>${when}</p>
        <p>${due} pending reminder${due === 1 ? "" : "s"}</p>
      </article>`;
  }).join("") : '<p class="empty">No courses yet. Add a class to your Schedule and it will appear here.</p>';
}

function renderOthers() {
  renderDashboard();
  renderTeachers();
  renderTasks();
  renderNotifications();
  renderCourses();
}

document.addEventListener("keydown", event => {
  if ((event.key === "Enter" || event.key === " ") && event.target.matches(".notif")) {
    event.preventDefault();
    event.target.click();
  }
});

/* Delete / toggle buttons */
document.addEventListener("click", event => {
  const btn = event.target.closest("[data-act]");
  if (!btn) return;
  const id = btn.dataset.id;

  if (btn.dataset.act === "delTeacher") {
    if (!confirm("Remove this teacher?")) return;
    const next = teachers.filter(t => t.id !== id);
    if (!storeList(KEY_TEACHERS, next)) return;
    teachers = next;
  } else if (btn.dataset.act === "delTask") {
    if (!confirm("Delete this reminder?")) return;
    const next = tasks.filter(t => t.id !== id);
    if (!storeList(KEY_TASKS, next)) return;
    tasks = next;
  } else if (btn.dataset.act === "readNotif" || btn.dataset.act === "readAll") {
    const ids = btn.dataset.act === "readAll"
      ? tasks.filter(t => !t.done && daysUntil(t.due) <= 1).map(t => t.id)
      : [id];
    const next = [...new Set([...readIds, ...ids])];
    if (!storeList(KEY_READ, next)) return;
    readIds = next;
  } else if (btn.dataset.act === "toggle") {
    const next = tasks.map(t => t.id === id ? { ...t, done: !t.done } : t);
    if (!storeList(KEY_TASKS, next)) {
      renderOthers();
      return;
    }
    tasks = next;
  }
  renderOthers();
});

document.querySelectorAll("[data-close]").forEach(btn => {
  btn.addEventListener("click", () => $(btn.dataset.close).close());
});

/* Teacher form */
$("addTeacher").addEventListener("click", () => {
  if (!subjects().length) {
    alert("Add a subject to your Schedule first, then you can link a teacher to it.");
    return;
  }
  $("teacherForm").reset();
  $("teacherSubject").innerHTML = subjectOptions();
  $("teacherDialog").showModal();
});

$("teacherForm").addEventListener("submit", event => {
  event.preventDefault();
  const name = $("teacherName").value.trim();
  if (!name) return;
  const next = [...teachers, {
    id: Date.now().toString(),
    subject: $("teacherSubject").value,
    name,
    email: $("teacherEmail").value.trim()
  }];
  if (!storeList(KEY_TEACHERS, next)) return;
  teachers = next;
  renderOthers();
  $("teacherDialog").close();
});

/* Homework / test form */
function openTaskDialog(kind) {
  taskKind = kind;
  $("taskForm").reset();
  $("taskHeading").textContent = kind === "test" ? "Add Test" : "Add Homework";
  $("taskSubject").innerHTML = subjectOptions('<option value="General">General</option>');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  $("taskDue").value = dateStr(tomorrow);
  $("taskDialog").showModal();
}

$("addHomework").addEventListener("click", () => openTaskDialog("homework"));
$("addTest").addEventListener("click", () => openTaskDialog("test"));

$("taskForm").addEventListener("submit", event => {
  event.preventDefault();
  const title = $("taskTitle").value.trim();
  if (!title) return;
  const next = [...tasks, {
    id: Date.now().toString(),
    kind: taskKind,
    title,
    subject: $("taskSubject").value,
    due: $("taskDue").value,
    done: false
  }];
  if (!storeList(KEY_TASKS, next)) return;
  tasks = next;
  renderOthers();
  $("taskDialog").close();
});

renderAll();
showView("dashboard");
