// The Metadata page's Downloaded column and sections: what Fetch data has put
// in data/input/, from the compute service's GET /api/downloads
// (beacon_metadata.downloads), read each time the page opens.
const API = new URL("api/downloads", new URL("/", location.href)).pathname;
const OFFLINE = "The compute service isn't reachable, so what's downloaded can't be shown. "
  + "Start everything with make run.";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function size(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} kB`;
}

function count(n, one, many = `${one}s`) {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

// "4–16 Mar 2025", "30 Mar – 2 Apr 2025", "14 Mar 2025".
function dates(first, last) {
  const [y1, m1, d1] = first.split("-").map(Number);
  const [y2, m2, d2] = last.split("-").map(Number);
  if (first === last) return `${d1} ${MONTHS[m1 - 1]} ${y1}`;
  if (y1 === y2 && m1 === m2) return `${d1}–${d2} ${MONTHS[m1 - 1]} ${y1}`;
  if (y1 === y2) return `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]} ${y1}`;
  return `${d1} ${MONTHS[m1 - 1]} ${y1} – ${d2} ${MONTHS[m2 - 1]} ${y2}`;
}

function times(span, kind) {
  const hours = span.hours.map((h) => String(h).padStart(2, "0")).join(", ");
  return `${count(span.times, kind === "forecast" ? "run" : "time")} at ${hours}Z`;
}

function table(headers, rows) {
  const wrap = el("div", undefined, "table-wrap");
  const t = wrap.appendChild(el("table"));
  const head = t.appendChild(el("thead")).appendChild(el("tr"));
  for (const h of headers) head.append(el("th", h));
  const body = t.appendChild(el("tbody"));
  for (const row of rows) {
    const tr = body.appendChild(el("tr"));
    for (const cell of row) {
      const td = tr.appendChild(el("td"));
      // A list of lines, or one line.
      for (const [i, line] of [cell].flat().entries()) td.append(...(i ? [el("br"), line] : [line]));
    }
  }
  return wrap;
}

// A span's fields, one per line, saying which only some of its files have.
function fields(span) {
  const listed = span.files - span.unlisted;
  const lines = span.fields.map((f) => (f.files === listed ? f.label
    : `${f.label} (${f.files.toLocaleString("en-US")} of ${count(listed, "file")})`));
  if (span.unlisted === span.files) lines.push("not listed (downloaded before BEACON listed each file's fields)");
  else if (span.unlisted) lines.push(`${count(span.unlisted, "file")} not listed`);
  return lines;
}

function section(box, id, found) {
  box.replaceChildren();
  const folder = el("code", `data/input/${id}/`);
  if (!found) {
    const none = el("p", "Nothing downloaded yet. Fetch data puts this dataset's files in ");
    none.append(folder, ".");
    box.append(none);
    return;
  }
  const lead = el("p", `${count(found.files, "file")}, ${size(found.bytes)} in `);
  lead.append(folder, ".");
  box.append(lead);
  const rows = [];
  for (const key of found.keys) {
    for (const span of key.spans) {
      rows.push([
        key.key, dates(span.first, span.last), times(span, key.kind),
        span.leads ? `${span.leads[0]}–${span.leads[1]} h` : "—",
        span.files.toLocaleString("en-US"), size(span.bytes), fields(span),
      ]);
    }
  }
  box.append(table(["File", "Dates", "Runs or times", "Leads", "Files", "Size", "Fields"], rows));
  if (found.keys.some((key) => key.kind === "forecast")) {
    box.append(el("p", "Forecasts are listed by the day of their run; their valid times run on to the longest lead.", "small"));
  }
}

async function fill() {
  const boxes = document.querySelectorAll(".downloaded[data-dataset]");
  const totals = document.querySelectorAll(".downloaded-total[data-dataset]");
  let datasets;
  try {
    const response = await fetch(API, { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    datasets = (await response.json()).datasets;
  } catch {
    for (const box of boxes) box.replaceChildren(el("p", OFFLINE, "small"));
    for (const total of totals) {
      total.textContent = "—";
      total.title = OFFLINE;
    }
    return;
  }
  for (const box of boxes) section(box, box.dataset.dataset, datasets[box.dataset.dataset]);
  for (const total of totals) {
    const found = datasets[total.dataset.dataset];
    total.textContent = found ? `${count(found.files, "file")}, ${size(found.bytes)}` : "none";
  }
}

fill();
