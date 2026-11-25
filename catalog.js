// The Data Catalog page's Candidates table (build_site.candidates_html): shows the
// rows that match the filters above it. Everything is in the page, so this
// works on the read-only copy too.
const form = document.getElementById("catalog-filters");
if (form) {
  const rows = [...document.querySelectorAll("table.catalog tbody tr")];
  const words = rows.map((row) => row.textContent.toLowerCase());
  const count = form.querySelector(".count");
  const controls = [...form.querySelectorAll("[data-filter]")];
  // data-on and data-vars hold space-separated lists; the rest one value each.
  const LISTS = new Set(["on", "vars"]);

  function apply() {
    const want = {};
    for (const c of controls) want[c.dataset.filter] = c.type === "checkbox" ? c.checked : c.value.trim();
    const text = (want.text || "").toLowerCase();
    let shown = 0;
    rows.forEach((row, i) => {
      const d = row.dataset;
      let ok = (!text || words[i].includes(text)) && (!want.new || !d.beacon);
      for (const key of ["source", "kind", "on", "vars", "access"]) {
        if (!ok || !want[key]) continue;
        ok = LISTS.has(key) ? d[key].split(" ").includes(want[key]) : d[key] === want[key];
      }
      row.hidden = !ok;
      if (ok) shown += 1;
    });
    count.textContent = `${shown.toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")} shown`;
  }

  form.addEventListener("input", apply);
  form.addEventListener("submit", (event) => event.preventDefault());
  apply();
}
