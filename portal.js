// BEACON Portal pages: the use-case menu (landing page) and the pair menu
// (Datasets).
// - A menu (select.menu) shows only the panel it picks, and keeps the pick in
//   the URL so it can be linked. Without JavaScript, every panel is shown.
// - "Fetch data", "Run METplus" and "Show in GUI" start jobs on the compute
//   service (src/compute/server.py, reached at /api/ through Caddy) for a use
//   case or a pair, and each panel lists its jobs.
// - "Show in GUI", and the BEACON GUI card for the chosen use case, publish
//   it to the GUI and then open the GUI on it.
// - The red ✕ next to a waiting or running job stops it.
// - The read-only copy (build_site.py --read-only, for GitHub Pages) has no
//   job buttons and never calls the compute service. Each use case links to
//   the GUI instead, unless the GUI's data is for another case.
const menu = document.querySelector("select.menu");
const panels = menu ? document.querySelectorAll(`section.${menu.dataset.panels}`) : [];

function show(id) {
  for (const panel of panels) panel.hidden = panel.id !== id;
}

if (menu) {
  const linked = decodeURIComponent(location.hash.slice(1));
  if ([...menu.options].some((option) => option.value === linked)) menu.value = linked;
  show(menu.value);
  menu.addEventListener("change", () => {
    show(menu.value);
    history.replaceState(null, "", `#${menu.value}`);
  });
}

// Dates are UTC days. Default to the day before yesterday: by then its
// forecasts and observations have all been published. For now the default is
// pinned to a day whose data is already in data/; set it to "" to go back.
const DEFAULT_DAY = "2026-10-21";

function isoDay(daysAgo) {
  return new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
}

const API = new URL("api/jobs", new URL("/", location.href)).pathname;
const OFFLINE = "The compute service isn't reachable, so Fetch and Run are off. Start everything with make run.";
const KINDS = { fetch: "Fetch data", compute: "Run METplus", publish: "Show in GUI" };
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
  message(null, null, value ? "" : OFFLINE);
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
    tab.document.title = "BEACON GUI";
    tab.document.body.textContent = text;
  } catch {
    // The tab already shows the GUI (another origin); it's sent there again below.
  }
}

// Publish a use case or pair, then open the GUI on it, in one tab named
// beacon-gui. The tab is opened during the click, or popup blockers stop it,
// and goes to the GUI once the job has stopped. The GUI opens even if the job
// failed (it then shows what it had); the message says why.
async function showInGui(run) {
  const { target, id } = run.dataset;
  const tab = window.open("", "beacon-gui");
  note(tab, "Updating the BEACON GUI…");
  const job = await submit(run, "publish");
  const done = job && (await finished(job.id));
  if (done) {
    message(target, id, done.status === "done" ? "The BEACON GUI shows it now."
      : `Couldn't update the BEACON GUI: ${done.summary || STATUS[done.status]}`);
  }
  const gui = await fetch(new URL("gui-url", new URL("/", location.href)), { cache: "no-store" })
    .then((response) => response.text())
    .catch(() => "");
  if (!gui) return message(target, id, "Couldn't find the BEACON GUI's address.");
  // A use case opens on its event page; pairs open on Standing.
  const url = new URL(gui, location.href);
  if (target === "case") url.search = new URLSearchParams({ v: "events", ev: id });
  if (tab) tab.location.href = url.href;
  else window.open(url.href, "beacon-gui");
}

// Waiting jobs can always be stopped; running ones unless they're Show in GUI (seconds).
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

for (const run of document.querySelectorAll(".run")) {
  for (const input of run.querySelectorAll("input[type=date]")) {
    input.max = isoDay(1);
    // An event case's own dates, then a pinned day, replace whatever the
    // browser restored on reload.
    if (input.defaultValue) input.value = input.defaultValue;
    else if (DEFAULT_DAY) input.value = DEFAULT_DAY;
    else if (!input.value) input.value = isoDay(2);
  }
  for (const button of run.querySelectorAll("button")) {
    const kind = button.dataset.kind;
    button.addEventListener("click", () => (kind === "publish" ? showInGui(run) : submit(run, kind)));
  }
}
if (document.querySelector(".run")) refresh();

// The BEACON GUI card does what Show in GUI does for the chosen use case. With
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
