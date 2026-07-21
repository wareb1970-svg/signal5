async function loadSignal() {
  const response = await fetch("data.json");
  const data = await response.json();

  document.getElementById("updated").textContent = data.updated;
  document.getElementById("overall-score").textContent = data.overall.score;
  document.getElementById("overall-level").textContent = data.overall.level;
  document.getElementById("overall-summary").textContent = data.overall.summary;
  document.getElementById("overall-confidence").textContent =
    data.overall.confidence;

  const grid = document.getElementById("category-grid");

  grid.innerHTML = data.categories
    .map(
      (item) => `
        <article>
          <p class="eyebrow">${item.name}</p>
          <div class="category-score">${item.score}/100</div>
          <p>${item.summary}</p>
        </article>
      `
    )
    .join("");
}

loadSignal().catch(() => {
  document.getElementById("overall-level").textContent =
    "Unable to load demo data";
});
