// BEACON Portal pages: the use-case menu (landing page) and the pair menu
// (Compare datasets, linked from the Data Catalog).
// - A menu (select.menu) shows only the panel it picks, and keeps the pick in
//   the URL so it can be linked. Without JavaScript, every panel is shown.
// - "Fetch data", "Run METplus" and "Show Report" start jobs on the compute
//   service (src/compute/server.py, reached at /api/ through Caddy) for a use
//   case or a pair, and each panel lists its jobs.
// - "Show Report", and the BEACON Report card for the chosen use case, publish
//   it to the GUI and then open the GUI on it.
// - The red ✕ next to a waiting or running job stops it.
// - "+ Create a new event…", after the event menu, opens a chat
//   (dialog.create-event) in which an open-weight model, or keyword rules if
//   none is running, turns a description of a weather event into an event
//   case. Saying "create event" saves it on the compute service; it joins the
//   event menu under "Made in the chat", with the same buttons as the others.
// - The read-only copy (build_site.py --read-only, for GitHub Pages) has no
//   job buttons or chat and never calls the compute service. Each use case
//   links to the GUI instead, unless the GUI's data is for another case.
// - A compute service that runs only some kinds of job (the read-only copy
//   from make public runs only Show Report) has the other buttons hidden.
const menu = document.querySelector("select.menu");

function panels() {
  return menu ? document.querySelectorAll(`section.${menu.dataset.panels}`) : [];
}

function show(id) {
  for (const panel of panels()) panel.hidden = panel.id !== id;
}

function select(id) {
  if (!menu) return;
  menu.value = id;
  show(menu.value);
  history.replaceState(null, "", `#${menu.value}`);
}

// The panel the URL names, if the menu has it.
function selectLinked() {
  const linked = decodeURIComponent(location.hash.slice(1));
  if ([...menu.options].some((option) => option.value === linked)) menu.value = linked;
  show(menu.value);
}

if (menu) {
  selectLinked();
  menu.addEventListener("change", () => select(menu.value));
}

// Dates are UTC days. Default to the day before yesterday: by then its
// forecasts and observations have all been published. For now the default is
// pinned to a day whose data is already in data/; set it to "" to go back.
const DEFAULT_DAY = "2026-10-21";

function isoDay(daysAgo) {
  return new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
}

const ROOT = new URL("/", location.href);
const API = new URL("api/jobs", ROOT).pathname;
const HEALTH = new URL("api/health", ROOT).pathname;
const CASES_API = new URL("api/cases", ROOT).pathname;
const CHAT_API = new URL("api/chat", ROOT).pathname;
const OFFLINE = "The compute service isn't reachable, so Fetch and Run are off. Start everything with make run.";
const READ_ONLY = "This copy shows results that have already been computed: pick the dates and click Show Report.";
const KINDS = { fetch: "Fetch data", compute: "Run METplus", publish: "Show Report" };
const STATUS = {
  queued: "Waiting", running: "Running", done: "Done", failed: "Failed",
  interrupted: "Interrupted", stopped: "Stopped",
};
// What stopping a running job costs, for the confirmation.
const STOP_NOTE = {
  fetch: "Files already downloaded are kept; Fetch data again carries on.",
  compute: "Its output so far is dropped; Run METplus again to start over.",
};
let online = null;
let kinds = null;
let notice = "";
let timer;

// Elements for one use case or pair: data-target is "case" or "pair", data-id its id.
function matches(el, target, id) {
  return el.dataset.target === target && el.dataset.id === id;
}

function message(target, id, text) {
  for (const el of document.querySelectorAll(".run-message")) {
    if (target === null || matches(el, target, id)) el.textContent = text;
  }
}

function setOnline(value) {
  if (value === online) return;
  online = value;
  for (const button of document.querySelectorAll(".run button")) button.disabled = !value;
  message(null, null, value ? notice : OFFLINE);
}

function showKinds(scope) {
  if (!kinds) return;
  for (const button of scope.querySelectorAll(".run button[data-kind]")) {
    button.hidden = !kinds.includes(button.dataset.kind);
  }
}

// Hide the buttons for kinds of job the compute service doesn't run, and
// offer the chat if it can make events. Returns the service's health.
async function loadKinds() {
  try {
    const response = await fetch(HEALTH, { cache: "no-store" });
    const health = response.ok ? await response.json() : {};
    if (!Array.isArray(health.kinds)) return null;
    kinds = health.kinds;
    showKinds(document);
    notice = kinds.includes("fetch") && kinds.includes("compute") ? "" : READ_ONLY;
    if (online) message(null, null, notice);
    return health;
  } catch {
    // The service isn't reachable; refresh() says so.
    return null;
  }
}

// Returns the job, or null if it couldn't be started.
async function submit(run, kind) {
  const { target, id } = run.dataset;
  let job = null;
  const body = {
    kind, [target]: id,
    start: run.querySelector("[name=start]").value,
    end: run.querySelector("[name=end]").value,
  };
  message(target, id, "");
  try {
    const response = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status >= 502) throw new Error(OFFLINE);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    message(target, id, response.status === 200 ? "That job is already waiting or running." : `${KINDS[kind]} queued.`);
    job = result;
  } catch (error) {
    message(target, id, `Couldn't start: ${error.message}`);
  }
  refresh();
  return job;
}

// The job once it has stopped (done, failed or interrupted).
async function finished(id) {
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      const response = await fetch(API, { cache: "no-store" });
      const job = (await response.json()).find((j) => j.id === id);
      if (job && job.status !== "queued" && job.status !== "running") return job;
    } catch {
      // The service may be restarting; keep waiting.
    }
  }
}

function note(tab, text) {
  try {
    tab.document.title = "BEACON Report";
    tab.document.body.textContent = text;
  } catch {
    // The tab already shows the GUI (another origin); it's sent there again below.
  }
}

// The GUI's address, asked for once.
let guiAddress = null;
function guiUrl() {
  guiAddress ??= fetch(new URL("gui-url", ROOT), { cache: "no-store" })
    .then((response) => response.text())
    .catch(() => "");
  return guiAddress;
}

// Publish a use case or pair, then open the GUI on it, in one tab named
// beacon-gui. The tab is opened during the click, or popup blockers stop it,
// and goes to the GUI once the job has stopped. The GUI opens even if the job
// failed (it then shows what it had); the message says why.
async function showInGui(run) {
  const { target, id } = run.dataset;
  const tab = window.open("", "beacon-gui");
  note(tab, "Updating the BEACON Report…");
  const job = await submit(run, "publish");
  const done = job && (await finished(job.id));
  if (done) {
    message(target, id, done.status === "done" ? "The BEACON Report shows it now."
      : `Couldn't update the BEACON Report: ${done.summary || STATUS[done.status]}`);
  }
  const gui = await guiUrl();
  if (!gui) return message(target, id, "Couldn't find the BEACON Report's address.");
  // A use case opens on its event page; pairs open on Standing.
  const url = new URL(gui, location.href);
  if (target === "case") url.search = new URLSearchParams({ v: "events", ev: id });
  if (tab) tab.location.href = url.href;
  else window.open(url.href, "beacon-gui");
}

// Waiting jobs can always be stopped; running ones unless they're Show Report (seconds).
function stoppable(job) {
  return job.status === "queued" || (job.status === "running" && job.kind !== "publish");
}

async function stop(job, target, id) {
  const what = KINDS[job.kind] || job.kind;
  const note = job.status === "running" ? `\n\n${STOP_NOTE[job.kind] || ""}` : "";
  if (!confirm(`Stop ${what} (${job.start === job.end ? job.start : `${job.start} to ${job.end}`})?${note}`)) return;
  try {
    const response = await fetch(`${API}/${encodeURIComponent(job.id)}/stop`, { method: "POST" });
    if (response.status >= 502) throw new Error(OFFLINE);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    message(target, id, response.status === 202 ? `Stopping ${what}…` : `${what} stopped.`);
  } catch (error) {
    message(target, id, `Couldn't stop: ${error.message}`);
  }
  refresh();
}

function row(cells, tag = "td") {
  const tr = document.createElement("tr");
  for (const content of cells) {
    const cell = document.createElement(tag);
    if (content instanceof Node) cell.append(content);
    else cell.textContent = content;
    tr.append(cell);
  }
  return tr;
}

function render(jobs) {
  for (const box of document.querySelectorAll(".jobs")) {
    const { target, id } = box.dataset;
    const mine = jobs.filter((job) => job[target] === id);
    if (!mine.length) {
      box.replaceChildren();
      continue;
    }
    const table = document.createElement("table");
    table.append(row(["Job", "Dates", "Started", "Status", "Result", ""], "th"));
    for (const job of mine) {
      const status = document.createElement("span");
      status.className = `status ${job.status}`;
      status.textContent = STATUS[job.status] || job.status;
      if (stoppable(job)) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "stop";
        button.textContent = "✕";
        button.title = `Stop ${KINDS[job.kind] || job.kind}`;
        button.setAttribute("aria-label", button.title);
        button.addEventListener("click", () => stop(job, target, id));
        status.append(button);
      }
      const log = document.createElement("a");
      log.href = `${API}/${encodeURIComponent(job.id)}/log`;
      log.target = "_blank";
      log.textContent = "log";
      const dates = job.start === job.end ? job.start : `${job.start} to ${job.end}`;
      const started = (job.started || job.created || "").replace("T", " ").replace("Z", " UTC");
      table.append(row([KINDS[job.kind] || job.kind, dates, started, status, job.summary || "", log]));
    }
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    wrap.append(table);
    box.replaceChildren(wrap);
  }
}

async function refresh() {
  clearTimeout(timer);
  let busy = false;
  try {
    const response = await fetch(API, { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    const jobs = await response.json();
    setOnline(true);
    render(jobs);
    busy = jobs.some((job) => job.status === "queued" || job.status === "running");
  } catch {
    setOnline(false);
  }
  timer = setTimeout(refresh, busy ? 2000 : 10000);
}

// Dates and buttons of one use case or pair.
function wireRun(run) {
  for (const input of run.querySelectorAll("input[type=date]")) {
    input.max = isoDay(1);
    // An event case's own dates, then a pinned day, replace whatever the
    // browser restored on reload.
    if (input.defaultValue) input.value = input.defaultValue;
    else if (DEFAULT_DAY) input.value = DEFAULT_DAY;
    else if (!input.value) input.value = isoDay(2);
  }
  for (const button of run.querySelectorAll("button")) {
    if (online !== null) button.disabled = !online;
    const kind = button.dataset.kind;
    button.addEventListener("click", () => (kind === "publish" ? showInGui(run) : submit(run, kind)));
  }
  showKinds(run);
}

for (const run of document.querySelectorAll(".run")) wireRun(run);

// The BEACON Report card does what Show Report does for the chosen use case. With
// the compute service off (buttons disabled), it's a plain link to the GUI.
const guiCard = document.querySelector("a.gui-card");
if (guiCard && menu) {
  guiCard.addEventListener("click", (event) => {
    const run = document.querySelector(`.run[data-target="case"][data-id="${CSS.escape(menu.value)}"]`);
    if (!run || run.querySelector("button").disabled) return;
    event.preventDefault();
    showInGui(run);
  });
}

// Read-only copy: its GUI shows the one case published with it, named by the
// event in the GUI's manifest. The other cases say so instead of linking.
const guiLinks = document.querySelectorAll(".gui-link[data-case]");
if (guiLinks.length) {
  fetch(new URL("data/manifest.json", guiLinks[0].querySelector("a").href), { cache: "no-cache" })
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
    .then((manifest) => {
      for (const link of guiLinks) {
        if (link.dataset.case !== manifest.event) link.textContent = "This copy has no results for this case.";
      }
    })
    .catch(() => {
      // The GUI's data couldn't be read: leave the links.
    });
}

// ---------------------------------------------------------------------------
// Events made in the chat: panels from the compute service (GET /api/cases),
// rendered by the same build_site.py code as the others.
// ---------------------------------------------------------------------------
const useCases = document.querySelector("section.use-cases");
let createdGroup = null;
// Whether this compute service makes events (not the read-only copy from make public).
let canMake = false;

function createdOption(id) {
  return createdGroup && [...createdGroup.children].find((option) => option.value === id);
}

async function deleteCreated(id, title) {
  if (!confirm(`Delete "${title}"?\n\nIts downloads and METplus output stay in data/; only the event goes.`)) return;
  try {
    const response = await fetch(`${CASES_API}/${encodeURIComponent(id)}/delete`, { method: "POST" });
    if (response.status >= 502) throw new Error(OFFLINE);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
  } catch (error) {
    message("case", id, `Couldn't delete it: ${error.message}`);
    return;
  }
  removeCreated(id);
  select(menu.options[0].value);
}

function removeCreated(id) {
  document.getElementById(id)?.remove();
  createdOption(id)?.remove();
  if (createdGroup && !createdGroup.children.length) {
    createdGroup.remove();
    createdGroup = null;
  }
}

// Add the events made in the chat that the page doesn't show yet. Returns the
// chat's greeting, from the service.
async function loadCreated() {
  if (!menu || !useCases) return null;
  let data;
  try {
    const response = await fetch(CASES_API, { cache: "no-store" });
    if (!response.ok) return null;
    data = await response.json();
  } catch {
    return null;
  }
  const ids = new Set(data.cases.map((c) => c.id));
  for (const section of useCases.querySelectorAll("section.case[data-created]")) {
    if (!ids.has(section.id)) removeCreated(section.id);
  }
  const gui = await guiUrl();
  for (const created of [...data.cases].reverse()) {
    if (document.getElementById(created.id)) continue;
    if (!createdGroup) {
      createdGroup = document.createElement("optgroup");
      createdGroup.label = "Made in the chat"; // loader.MADE_EVENTS, as in the GUI's menu
      menu.append(createdGroup);
    }
    createdGroup.prepend(new Option(created.short_name, created.id));
    const template = document.createElement("template");
    template.innerHTML = created.html.trim();
    const section = template.content.firstElementChild;
    section.dataset.created = "";
    section.hidden = menu.value !== created.id;
    for (const link of section.querySelectorAll('a[target="beacon-gui"]')) if (gui) link.href = gui;
    const actions = document.createElement("p");
    actions.className = "created-actions small";
    actions.append("Made in the Create Event chat.");
    if (canMake) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "delete-event";
      remove.textContent = "Delete this event";
      remove.addEventListener("click", () => deleteCreated(created.id, created.title));
      actions.append(" ", remove);
    }
    section.querySelector("h2").after(actions);
    useCases.append(section);
    const run = section.querySelector(".run");
    if (run) wireRun(run);
  }
  return data.greeting || null;
}

// ---------------------------------------------------------------------------
// The Create Event chat
// ---------------------------------------------------------------------------
const createButton = document.querySelector("button.create-event");
const dialog = document.querySelector("dialog.create-event");
// "create event", "create it", "yes, create the event" ... sent as a message.
const CREATE_WORDS = /^\s*(?:please\s+)?(?:(?:yes|ok|okay|great)[,.!]?\s*)?(?:go ahead and\s+)?create(?:\s+(?:the|this|it|an|my))?(?:\s+event)?(?:\s+now)?(?:,?\s*please)?[.!]*\s*$/i;
const chat = { messages: [], form: null, ready: false, busy: false, greeting: "", problems: [], model: null };

function chatPart(selector) {
  return dialog.querySelector(selector);
}

function bubble(role, text) {
  const el = document.createElement("div");
  el.className = `chat-msg ${role}`;
  el.textContent = text;
  const log = chatPart(".chat-log");
  log.append(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

function renderProposal(proposal) {
  const facts = chatPart(".proposal-facts");
  facts.replaceChildren();
  for (const [label, text] of proposal?.facts || []) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = text;
    facts.append(dt, dd);
  }
  for (const note of proposal?.notes || []) {
    const dt = document.createElement("dt");
    dt.textContent = "Assumed";
    const dd = document.createElement("dd");
    dd.textContent = note;
    facts.append(dt, dd);
  }
  const problems = chatPart(".proposal-problems");
  problems.replaceChildren(...(proposal?.problems || []).map((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    return li;
  }));
  const stations = chatPart(".proposal-stations");
  const list = proposal?.stations || [];
  stations.hidden = !list.length;
  stations.querySelector("summary").textContent = `Stations (${list.length})`;
  stations.querySelector("p").textContent = list.map(([id, name]) => `${id} ${name}`).join(" · ");
  chatPart(".proposal-empty").hidden = Boolean(facts.children.length || problems.children.length);
  chat.ready = Boolean(proposal?.ready);
  chat.problems = proposal?.problems || [];
  chatPart("button.create").disabled = !chat.ready || chat.busy;
}

function setBusy(value) {
  chat.busy = value;
  chatPart("button.send").disabled = value;
  chatPart("button.create").disabled = value || !chat.ready;
  chatPart("#chat-text").disabled = value;
  if (!value) chatPart("#chat-text").focus();
}

async function chatStatus() {
  const health = await loadKinds();
  const status = health?.chat;
  chat.model = status?.model || null;
  chatPart(".chat-status").textContent = !status ? "The compute service isn't reachable."
    : status.model ? `Read by ${status.model}, an open-weight model running with BEACON, and by keyword rules.`
      : status.loading ? "The model is still loading, so keyword rules read your messages for now."
        : status.configured ? "The model isn't answering, so keyword rules read your messages."
          : "No model is running (make llm-model, then make pod), so keyword rules read your messages.";
}

function startOver() {
  chat.messages = [];
  chat.form = null;
  chatPart(".chat-log").replaceChildren();
  renderProposal(null);
  bubble("assistant", chat.greeting);
}

async function post(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status >= 502) throw new Error("the compute service isn't reachable");
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}

async function createEvent() {
  if (!chat.ready) {
    bubble("assistant", `Not yet: ${chat.problems[0] || "describe the event first."}`);
    return;
  }
  setBusy(true);
  const waiting = bubble("assistant pending", "Creating the event…");
  try {
    const created = await post(CASES_API, { messages: chat.messages, form: chat.form });
    await loadCreated();
    select(created.id);
    message("case", created.id, "Created. Next: Fetch data, then Run METplus, then Show Report for its event report.");
    dialog.close();
    startOver();
    refresh();
    document.getElementById(created.id)?.scrollIntoView?.({ block: "start" });
  } catch (error) {
    waiting.className = "chat-msg assistant";
    waiting.textContent = `Couldn't create it: ${error.message}`;
  } finally {
    setBusy(false);
  }
}

async function send() {
  const box = chatPart("#chat-text");
  const text = box.value.trim();
  if (!text || chat.busy) return;
  box.value = "";
  bubble("user", text);
  if (CREATE_WORDS.test(text)) return createEvent();
  chat.messages.push({ role: "user", content: text });
  setBusy(true);
  // On a few CPU cores the model takes seconds to a minute; keyword rules answer at once.
  const waiting = bubble("assistant pending", chat.model ? `${chat.model} is reading it… (up to a minute)` : "Reading…");
  try {
    const result = await post(CHAT_API, { messages: chat.messages, form: chat.form });
    chat.form = result.form;
    chat.messages.push({ role: "assistant", content: result.reply });
    waiting.className = "chat-msg assistant";
    waiting.textContent = result.reply;
    if (result.note) bubble("note", result.note);
    renderProposal(result.proposal);
  } catch (error) {
    chat.messages.pop();
    waiting.className = "chat-msg note";
    waiting.textContent = `Couldn't read that: ${error.message}. Try again.`;
  } finally {
    setBusy(false);
  }
}

if (createButton && dialog && menu) {
  (async () => {
    const health = await loadKinds();
    canMake = Boolean(health?.chat?.enabled);
    const greeting = await loadCreated();
    selectLinked();
    refresh();
    if (!canMake) return;
    chat.greeting = greeting || "Describe the weather event you want to check the forecasts for.";
    createButton.closest(".create-choice").hidden = false;
    startOver();
  })();
  createButton.addEventListener("click", () => {
    dialog.showModal();
    chatStatus();
    chatPart("#chat-text").focus();
  });
  chatPart("button.close").addEventListener("click", () => dialog.close());
  chatPart("button.send").addEventListener("click", send);
  chatPart("button.create").addEventListener("click", createEvent);
  chatPart("button.start-over").addEventListener("click", () => {
    if (!chat.messages.length || confirm("Start over? This chat will be cleared.")) startOver();
  });
  chatPart("#chat-text").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send();
    }
  });
}

if (document.querySelector(".run") || createButton) {
  if (!createButton) loadKinds();
  refresh();
}
