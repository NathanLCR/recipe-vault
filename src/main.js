import "./style.css";
import { supabase, CLOUD_ENABLED } from "./supabase.js";

const LS_KEY = "recipe_vault_data";
const AI_MODELS = ["", "ChatGPT", "Claude", "Gemini", "Other"];
const RECIPE_STATUS = ["want", "tried", "approved"];
const ATTEMPT_RESULTS = ["untested", "success", "partial", "fail"];
const DIFFICULTIES = ["", "easy", "medium", "hard"];
const COST_LEVELS = ["", "low", "medium", "high"];

let recipes = [];
let formRating = 0;
let editingId = null;
let formVersionContext = null;

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const uuid = () => crypto.randomUUID();

function nowIso() {
  return new Date().toISOString();
}

function esc(value) {
  const el = document.createElement("span");
  el.textContent = value ?? "";
  return el.innerHTML;
}

function clampRating(value) {
  return Math.max(0, Math.min(5, Number(value) || 0));
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseInteger(value) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeStatus(value) {
  return RECIPE_STATUS.includes(value) ? value : "want";
}

function normalizeAttemptResult(value, status) {
  if (ATTEMPT_RESULTS.includes(value)) return value;
  if (status === "approved") return "success";
  if (status === "tried") return "partial";
  return "untested";
}

function normalizeRecipe(raw = {}) {
  const id = raw.id || uuid();
  const status = normalizeStatus(raw.status);
  const favorite = Boolean(raw.favorite);
  const versionGroupId = raw.versionGroupId || raw.parentRecipeId || id;

  return {
    id,
    title: String(raw.title || "Untitled recipe").trim(),
    cuisine: String(raw.cuisine || "").trim(),
    source: String(raw.source || "").trim(),
    aiModel:
      AI_MODELS.includes(raw.aiModel) && raw.aiModel
        ? raw.aiModel
        : AI_MODELS.includes(raw.source)
          ? raw.source
          : "",
    prompt: String(raw.prompt || "").trim(),
    sourceText: String(raw.sourceText || "").trim(),
    pantrySnapshot: normalizeStringArray(raw.pantrySnapshot),
    craving: String(raw.craving || "").trim(),
    ingredients: normalizeStringArray(raw.ingredients),
    instructions: normalizeStringArray(raw.instructions),
    tags: normalizeStringArray(raw.tags),
    status,
    favorite,
    rating: clampRating(raw.rating),
    review: String(raw.review || "").trim(),
    whatWorked: String(raw.whatWorked || "").trim(),
    whatDidnt: String(raw.whatDidnt || "").trim(),
    changesNextTime: String(raw.changesNextTime || "").trim(),
    occasion: String(raw.occasion || "").trim(),
    attemptResult: normalizeAttemptResult(raw.attemptResult, status),
    wouldRepeat:
      raw.wouldRepeat === true || raw.wouldRepeat === false
        ? raw.wouldRepeat
        : null,
    actualTimeMinutes: parseInteger(raw.actualTimeMinutes),
    difficulty: DIFFICULTIES.includes(raw.difficulty) ? raw.difficulty : "",
    cost: COST_LEVELS.includes(raw.cost) ? raw.cost : "",
    versionGroupId,
    versionName: String(raw.versionName || "v1").trim() || "v1",
    parentRecipeId: raw.parentRecipeId || null,
    createdAt: raw.createdAt || raw.created_at || nowIso(),
    updatedAt: raw.updatedAt || raw.updated_at || nowIso(),
  };
}

function saveLocal() {
  localStorage.setItem(LS_KEY, JSON.stringify(recipes));
}

function loadLocal() {
  try {
    const stored = JSON.parse(localStorage.getItem(LS_KEY)) || [];
    return stored.map(normalizeRecipe);
  } catch {
    return [];
  }
}

function toast(message) {
  const container = $("#toast-container");
  if (!container) return;

  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<span class="material-symbols-rounded">check_circle</span>${esc(message)}`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(value));
}

function humanize(value) {
  if (!value) return "—";
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function starsHTML(rating, size = 16) {
  let html = '<span class="stars">';
  for (let i = 1; i <= 5; i += 1) {
    html += `<span class="material-symbols-rounded${i <= rating ? " filled" : ""}" style="font-size:${size}px;">star</span>`;
  }
  return `${html}</span>`;
}

function dbToLocal(row) {
  return normalizeRecipe({
    id: row.id,
    title: row.title,
    cuisine: row.cuisine,
    source: row.source,
    aiModel: row.ai_model,
    prompt: row.prompt,
    sourceText: row.source_text,
    pantrySnapshot: row.pantry_snapshot,
    craving: row.craving,
    ingredients: row.ingredients,
    instructions: row.instructions,
    tags: row.tags,
    status: row.status,
    favorite: row.favorite,
    rating: row.rating,
    review: row.review,
    whatWorked: row.what_worked,
    whatDidnt: row.what_didnt,
    changesNextTime: row.changes_next_time,
    occasion: row.occasion,
    attemptResult: row.attempt_result,
    wouldRepeat: row.would_repeat,
    actualTimeMinutes: row.actual_time_minutes,
    difficulty: row.difficulty,
    cost: row.cost,
    versionGroupId: row.version_group_id,
    versionName: row.version_name,
    parentRecipeId: row.parent_recipe_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function localToDb(recipe) {
  return {
    id: recipe.id,
    title: recipe.title,
    cuisine: recipe.cuisine || null,
    source: recipe.source || null,
    ai_model: recipe.aiModel || null,
    prompt: recipe.prompt || null,
    source_text: recipe.sourceText || null,
    pantry_snapshot: recipe.pantrySnapshot,
    craving: recipe.craving || null,
    ingredients: recipe.ingredients,
    instructions: recipe.instructions,
    tags: recipe.tags,
    status: recipe.status,
    favorite: recipe.favorite,
    rating: recipe.rating,
    review: recipe.review || null,
    what_worked: recipe.whatWorked || null,
    what_didnt: recipe.whatDidnt || null,
    changes_next_time: recipe.changesNextTime || null,
    occasion: recipe.occasion || null,
    attempt_result: recipe.attemptResult,
    would_repeat: recipe.wouldRepeat,
    actual_time_minutes: recipe.actualTimeMinutes,
    difficulty: recipe.difficulty || null,
    cost: recipe.cost || null,
    version_group_id: recipe.versionGroupId,
    version_name: recipe.versionName || null,
    parent_recipe_id: recipe.parentRecipeId,
    created_at: recipe.createdAt,
    updated_at: recipe.updatedAt,
  };
}

async function loadFromCloud() {
  if (!CLOUD_ENABLED) return false;

  try {
    const { data, error } = await supabase
      .from("recipes")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    recipes = data.map(dbToLocal);
    saveLocal();
    return true;
  } catch (error) {
    console.warn("Cloud load failed:", error);
    return false;
  }
}

async function saveToCloud(recipe) {
  if (!CLOUD_ENABLED) return;

  try {
    const { error } = await supabase.from("recipes").upsert(localToDb(recipe));
    if (error) throw error;
  } catch (error) {
    console.warn("Cloud save failed:", error);
  }
}

async function deleteFromCloud(id) {
  if (!CLOUD_ENABLED) return;

  try {
    const { error } = await supabase.from("recipes").delete().eq("id", id);
    if (error) throw error;
  } catch (error) {
    console.warn("Cloud delete failed:", error);
  }
}

function updateSyncIndicator(cloudOk) {
  const indicator = $("#sync-indicator");
  if (cloudOk) {
    indicator.className = "sync-indicator cloud";
    indicator.innerHTML =
      '<span class="material-symbols-rounded">cloud_done</span>Cloud';
    return;
  }

  indicator.className = "sync-indicator local";
  indicator.innerHTML = CLOUD_ENABLED
    ? '<span class="material-symbols-rounded">cloud_off</span>Offline'
    : '<span class="material-symbols-rounded">smartphone</span>Local';
}

async function init() {
  const cloudOk = await loadFromCloud();
  if (!cloudOk) recipes = loadLocal();
  updateSyncIndicator(cloudOk);
  document.body.classList.remove("loading");
  fullRender();
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function populateSelect(id, values, allLabel) {
  const select = $(id);
  const current = select.value;
  select.innerHTML =
    `<option value="">${allLabel}</option>` +
    values.map((value) => `<option value="${esc(value)}">${esc(value)}</option>`).join("");
  select.value = values.includes(current) ? current : "";
}

function renderFilterOptions() {
  populateSelect(
    "#filter-cuisine",
    uniqueSorted(recipes.map((recipe) => recipe.cuisine)),
    "All cuisines",
  );
  populateSelect(
    "#filter-tag",
    uniqueSorted(recipes.flatMap((recipe) => recipe.tags)),
    "All tags",
  );
  populateSelect(
    "#filter-ai",
    uniqueSorted(recipes.map((recipe) => recipe.aiModel)),
    "Any AI model",
  );
}

function recipeMatchesSearch(recipe, search) {
  if (!search) return true;

  const haystack = [
    recipe.title,
    recipe.cuisine,
    recipe.source,
    recipe.aiModel,
    recipe.review,
    recipe.craving,
    recipe.versionName,
    recipe.tags.join(" "),
    recipe.ingredients.join(" "),
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(search);
}

function getPantryTerms() {
  return splitCsv($("#ingredient-match-input").value.toLowerCase());
}

function normalizeIngredientText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[0-9/().,-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getIngredientCoverage(recipe, pantryTerms = getPantryTerms()) {
  const ingredients = recipe.ingredients || [];
  if (!pantryTerms.length || !ingredients.length) {
    return {
      total: ingredients.length,
      matched: 0,
      missing: ingredients,
      ratio: 0,
      matchedList: [],
    };
  }

  const matchedList = [];
  const missing = [];

  ingredients.forEach((ingredient) => {
    const normalizedIngredient = normalizeIngredientText(ingredient);
    const matched = pantryTerms.some(
      (term) =>
        normalizedIngredient.includes(term) || term.includes(normalizedIngredient),
    );

    if (matched) matchedList.push(ingredient);
    else missing.push(ingredient);
  });

  return {
    total: ingredients.length,
    matched: matchedList.length,
    missing,
    ratio: ingredients.length ? matchedList.length / ingredients.length : 0,
    matchedList,
  };
}

function getFilteredRecipes() {
  const search = $("#search-input").value.trim().toLowerCase();
  const cuisine = $("#filter-cuisine").value;
  const ratingFilter = $("#filter-rating").value;
  const status = $("#filter-status").value;
  const tag = $("#filter-tag").value;
  const aiModel = $("#filter-ai").value;
  const matchMode = $("#filter-match").value;
  const pantryTerms = getPantryTerms();

  let filtered = recipes.filter((recipe) => {
    if (!recipeMatchesSearch(recipe, search)) return false;
    if (cuisine && recipe.cuisine !== cuisine) return false;
    if (status && recipe.status !== status) return false;
    if (tag && !recipe.tags.includes(tag)) return false;
    if (aiModel && recipe.aiModel !== aiModel) return false;

    if (ratingFilter) {
      const minRating = parseInt(ratingFilter, 10);
      if (minRating === 0 && recipe.rating > 0) return false;
      if (minRating > 0 && recipe.rating < minRating) return false;
    }

    const coverage = getIngredientCoverage(recipe, pantryTerms);
    if (matchMode === "only-full" && pantryTerms.length && coverage.missing.length)
      return false;
    if (matchMode === "only-close" && pantryTerms.length && coverage.matched === 0)
      return false;

    return true;
  });

  filtered.sort((a, b) => {
    const pantryA = getIngredientCoverage(a, pantryTerms);
    const pantryB = getIngredientCoverage(b, pantryTerms);

    if (pantryA.ratio !== pantryB.ratio) return pantryB.ratio - pantryA.ratio;
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    if (a.status !== b.status) {
      const order = { approved: 0, tried: 1, want: 2 };
      return order[a.status] - order[b.status];
    }
    if (a.rating !== b.rating) return b.rating - a.rating;
    return new Date(b.updatedAt) - new Date(a.updatedAt);
  });

  return filtered;
}

function renderStats() {
  const rated = recipes.filter((recipe) => recipe.rating > 0);
  const approved = recipes.filter((recipe) => recipe.status === "approved").length;
  const successes = recipes.filter(
    (recipe) => recipe.attemptResult === "success",
  ).length;
  const tested = recipes.filter((recipe) => recipe.attemptResult !== "untested");
  const aiCounter = {};

  recipes.forEach((recipe) => {
    if (recipe.aiModel) aiCounter[recipe.aiModel] = (aiCounter[recipe.aiModel] || 0) + 1;
  });

  const bestAi = Object.entries(aiCounter).sort((a, b) => b[1] - a[1])[0];
  const avgRating = rated.length
    ? (rated.reduce((sum, recipe) => sum + recipe.rating, 0) / rated.length).toFixed(1)
    : "—";
  const successRate = tested.length
    ? `${Math.round((successes / tested.length) * 100)}%`
    : "—";

  $("#stat-total").textContent = recipes.length;
  $("#stat-approved").textContent = approved;
  $("#stat-success-rate").textContent = successRate;
  $("#stat-top-ai").textContent = bestAi ? bestAi[0] : "—";
  $("#stat-avg-rating").innerHTML =
    avgRating === "—" ? "—" : `${avgRating} ${starsHTML(Math.round(Number(avgRating)), 14)}`;
}

function getInsights() {
  if (!recipes.length) {
    return [
      "Comece salvando uma receita com o prompt e o que você tinha em casa para o histórico ficar realmente útil.",
      "Use o import rápido para colar uma resposta inteira do ChatGPT, Claude ou Gemini e revisar depois.",
    ];
  }

  const insights = [];
  const favoriteTags = Object.entries(
    recipes.reduce((acc, recipe) => {
      if (recipe.rating >= 4 || recipe.status === "approved") {
        recipe.tags.forEach((tag) => {
          acc[tag] = (acc[tag] || 0) + 1;
        });
      }
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);

  if (favoriteTags[0]) {
    insights.push(
      `Suas melhores notas se concentram em "${favoriteTags[0][0]}". Vale explorar mais variações nessa linha.`,
    );
  }

  const aiScores = Object.entries(
    recipes.reduce((acc, recipe) => {
      if (!recipe.aiModel || recipe.rating === 0) return acc;
      acc[recipe.aiModel] ||= { total: 0, count: 0 };
      acc[recipe.aiModel].total += recipe.rating;
      acc[recipe.aiModel].count += 1;
      return acc;
    }, {}),
  )
    .map(([ai, stats]) => ({ ai, avg: stats.total / stats.count }))
    .sort((a, b) => b.avg - a.avg);

  if (aiScores[0]) {
    insights.push(
      `${aiScores[0].ai} está gerando suas receitas mais bem avaliadas até agora.`,
    );
  }

  const repeatable = recipes
    .filter((recipe) => recipe.wouldRepeat === true)
    .sort((a, b) => b.rating - a.rating);

  if (repeatable[0]) {
    insights.push(
      `"${repeatable[0].title}" já parece estar na sua rotação fixa. Talvez valha marcar como favorita.`,
    );
  }

  const needsRetest = recipes.filter(
    (recipe) =>
      recipe.attemptResult === "partial" &&
      recipe.changesNextTime &&
      recipe.status !== "approved",
  );

  if (needsRetest[0]) {
    insights.push(
      `Você tem receita pronta para nova tentativa: "${needsRetest[0].title}" já tem ajustes anotados para a próxima versão.`,
    );
  }

  return insights.slice(0, 4);
}

function renderInsights() {
  const insights = getInsights();
  $("#insights-list").innerHTML = insights
    .map(
      (insight) => `
        <article class="insight-card">
          <span class="material-symbols-rounded">tips_and_updates</span>
          <p>${esc(insight)}</p>
        </article>`,
    )
    .join("");
}

function renderGrid() {
  const grid = $("#recipe-grid");
  const filtered = getFilteredRecipes();
  const pantryTerms = getPantryTerms();

  if (!filtered.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <span class="material-symbols-rounded">restaurant</span>
        <h3>${recipes.length ? "No recipes match those filters" : "No recipes yet"}</h3>
        <p>${recipes.length ? "Try changing the pantry match or filters." : "Save your first AI-generated recipe to start learning what works."}</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered
    .map((recipe) => {
      const coverage = getIngredientCoverage(recipe, pantryTerms);
      const statusLabel = {
        want: "Want to try",
        tried: "Tried",
        approved: "Approved",
      }[recipe.status];

      return `
        <article class="recipe-card" data-id="${recipe.id}" tabindex="0">
          <div class="card-header">
            <div>
              <div class="card-title-row">
                <h3 class="card-title">${esc(recipe.title)}</h3>
                ${recipe.favorite ? '<span class="material-symbols-rounded favorite-icon">favorite</span>' : ""}
              </div>
              <p class="card-subtitle">${esc(recipe.versionName)} · ${esc(recipe.aiModel || recipe.source || "Personal")}</p>
            </div>
            ${recipe.rating > 0 ? starsHTML(recipe.rating) : ""}
          </div>

          <div class="card-meta">
            <span class="badge badge-status badge-${recipe.status}">${statusLabel}</span>
            ${recipe.attemptResult !== "untested" ? `<span class="badge badge-result">${esc(humanize(recipe.attemptResult))}</span>` : ""}
            ${recipe.cuisine ? `<span class="badge">${esc(recipe.cuisine)}</span>` : ""}
          </div>

          ${recipe.tags.length ? `<p class="tag-row">${recipe.tags.slice(0, 4).map((tag) => `<span>#${esc(tag)}</span>`).join("")}</p>` : ""}
          ${recipe.craving ? `<p class="card-note"><strong>Wanted:</strong> ${esc(recipe.craving)}</p>` : ""}
          ${recipe.review ? `<p class="card-note"><strong>Takeaway:</strong> ${esc(recipe.review)}</p>` : ""}

          <div class="card-footer">
            <span>${recipe.ingredients.length} ingredients</span>
            ${
              pantryTerms.length
                ? `<span class="match-pill ${coverage.missing.length ? "partial" : "full"}">${coverage.matched}/${coverage.total || 0} pantry matches</span>`
                : recipe.actualTimeMinutes
                  ? `<span>${recipe.actualTimeMinutes} min real time</span>`
                  : `<span>${esc(humanize(recipe.difficulty || "pending"))}</span>`
            }
          </div>
        </article>
      `;
    })
    .join("");

  $$(".recipe-card", grid).forEach((card) => {
    card.addEventListener("click", () => openDetail(card.dataset.id));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter") openDetail(card.dataset.id);
    });
  });
}

function renderVersionComparison(recipe) {
  const versions = recipes
    .filter((item) => item.versionGroupId === recipe.versionGroupId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  if (versions.length <= 1) {
    return "<p class=\"muted-copy\">No alternate versions yet. Create one after your next test so you can compare results.</p>";
  }

  return `
    <div class="comparison-list">
      ${versions
        .map(
          (item) => `
            <button class="comparison-item${item.id === recipe.id ? " active" : ""}" data-open-id="${item.id}">
              <strong>${esc(item.versionName)}</strong>
              <span>${esc(humanize(item.attemptResult))} · ${item.rating ? `${item.rating}/5` : "Unrated"}</span>
              <span>${item.actualTimeMinutes ? `${item.actualTimeMinutes} min` : "No timing yet"}</span>
            </button>`,
        )
        .join("")}
    </div>
  `;
}

function renderSimilarRecipes(recipe) {
  const titleTerms = recipe.title
    .toLowerCase()
    .split(/\W+/)
    .filter((term) => term.length > 3);

  const similar = recipes
    .filter((candidate) => candidate.id !== recipe.id)
    .map((candidate) => {
      const overlap = titleTerms.filter((term) =>
        candidate.title.toLowerCase().includes(term),
      ).length;
      const tagOverlap = candidate.tags.filter((tag) => recipe.tags.includes(tag)).length;
      return { candidate, score: overlap * 2 + tagOverlap };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (!similar.length) {
    return "<p class=\"muted-copy\">As you save related recipes, comparisons will start showing up here.</p>";
  }

  return `
    <div class="comparison-list">
      ${similar
        .map(
          ({ candidate }) => `
            <button class="comparison-item" data-open-id="${candidate.id}">
              <strong>${esc(candidate.title)}</strong>
              <span>${esc(candidate.versionName)} · ${candidate.rating ? `${candidate.rating}/5` : "Unrated"}</span>
              <span>${esc(candidate.aiModel || candidate.source || "Manual")}</span>
            </button>`,
        )
        .join("")}
    </div>
  `;
}

function openDetail(id) {
  const recipe = recipes.find((item) => item.id === id);
  if (!recipe) return;

  const coverage = getIngredientCoverage(recipe);
  const body = $("#detail-body");
  body.innerHTML = `
    <section class="detail-hero">
      <div>
        <p class="eyebrow">${esc(recipe.versionName)} · saved ${formatDate(recipe.createdAt)}</p>
        <h2 class="detail-title">${esc(recipe.title)}</h2>
        <div class="detail-badges">
          <span class="badge badge-status badge-${recipe.status}">${esc(humanize(recipe.status))}</span>
          ${recipe.favorite ? '<span class="badge badge-favorite">Favorite</span>' : ""}
          ${recipe.aiModel ? `<span class="badge">${esc(recipe.aiModel)}</span>` : ""}
          ${recipe.source ? `<span class="badge">${esc(recipe.source)}</span>` : ""}
          ${recipe.cuisine ? `<span class="badge">${esc(recipe.cuisine)}</span>` : ""}
        </div>
      </div>
      <div class="detail-rating">
        <span class="detail-label">Rating</span>
        <div class="stars stars-interactive" id="detail-stars" data-id="${recipe.id}">
          ${[1, 2, 3, 4, 5]
            .map(
              (star) =>
                `<span class="material-symbols-rounded${star <= recipe.rating ? " filled" : ""}" data-star="${star}">star</span>`,
            )
            .join("")}
        </div>
      </div>
    </section>

    <section class="detail-grid">
      <article class="detail-panel">
        <h3>Prompt context</h3>
        <p><strong>Wanted to eat:</strong> ${esc(recipe.craving || "—")}</p>
        <p><strong>Had at home:</strong> ${esc(recipe.pantrySnapshot.join(", ") || "—")}</p>
        <p><strong>Prompt:</strong> ${esc(recipe.prompt || "—")}</p>
        <p><strong>Original response:</strong> ${esc(recipe.sourceText || "—")}</p>
      </article>

      <article class="detail-panel">
        <h3>Real test result</h3>
        <p><strong>Outcome:</strong> ${esc(humanize(recipe.attemptResult))}</p>
        <p><strong>Would repeat:</strong> ${recipe.wouldRepeat === null ? "—" : recipe.wouldRepeat ? "Yes" : "No"}</p>
        <p><strong>Real time:</strong> ${recipe.actualTimeMinutes ? `${recipe.actualTimeMinutes} min` : "—"}</p>
        <p><strong>Difficulty:</strong> ${esc(humanize(recipe.difficulty))}</p>
        <p><strong>Cost:</strong> ${esc(humanize(recipe.cost))}</p>
      </article>
    </section>

    <section class="detail-grid">
      <article class="detail-panel">
        <h3>Ingredients</h3>
        <ul class="ingredient-list">
          ${recipe.ingredients.map((ingredient) => `<li>${esc(ingredient)}</li>`).join("")}
        </ul>
        ${
          getPantryTerms().length
            ? `<p class="detail-inline-note"><strong>Pantry match:</strong> ${coverage.matched}/${coverage.total || 0} matched${coverage.missing.length ? ` · Missing: ${esc(coverage.missing.join(", "))}` : ""}</p>`
            : ""
        }
      </article>

      <article class="detail-panel">
        <h3>Instructions</h3>
        <ol class="instruction-list">
          ${recipe.instructions.map((step) => `<li>${esc(step)}</li>`).join("")}
        </ol>
      </article>
    </section>

    <section class="detail-grid">
      <article class="detail-panel">
        <h3>What you learned</h3>
        <p><strong>Review:</strong> ${esc(recipe.review || "—")}</p>
        <p><strong>What worked:</strong> ${esc(recipe.whatWorked || "—")}</p>
        <p><strong>What didn't:</strong> ${esc(recipe.whatDidnt || "—")}</p>
        <p><strong>Next change:</strong> ${esc(recipe.changesNextTime || "—")}</p>
        <p><strong>Occasion:</strong> ${esc(recipe.occasion || "—")}</p>
      </article>

      <article class="detail-panel">
        <h3>Tags and lineage</h3>
        <p><strong>Tags:</strong> ${esc(recipe.tags.join(", ") || "—")}</p>
        <p><strong>Parent version:</strong> ${esc(recipe.parentRecipeId || "—")}</p>
        <p><strong>Version group:</strong> ${esc(recipe.versionGroupId)}</p>
        <p><strong>Updated:</strong> ${formatDate(recipe.updatedAt)}</p>
      </article>
    </section>

    <section class="detail-panel">
      <h3>Version comparison</h3>
      ${renderVersionComparison(recipe)}
    </section>

    <section class="detail-panel">
      <h3>Similar recipes</h3>
      ${renderSimilarRecipes(recipe)}
    </section>

    <div class="detail-actions">
      <button class="btn" id="detail-toggle-status" data-id="${recipe.id}">
        <span class="material-symbols-rounded">task_alt</span>
        Cycle status
      </button>
      <button class="btn" id="detail-toggle-favorite" data-id="${recipe.id}">
        <span class="material-symbols-rounded">${recipe.favorite ? "heart_minus" : "favorite"}</span>
        ${recipe.favorite ? "Remove favorite" : "Mark favorite"}
      </button>
      <button class="btn" id="detail-new-version" data-id="${recipe.id}">
        <span class="material-symbols-rounded">difference</span>
        New version
      </button>
      <button class="btn" id="detail-edit" data-id="${recipe.id}">
        <span class="material-symbols-rounded">edit</span>
        Edit
      </button>
      <button class="btn btn-danger" id="detail-delete" data-id="${recipe.id}">
        <span class="material-symbols-rounded">delete</span>
        Delete
      </button>
    </div>
  `;

  $$("#detail-stars .material-symbols-rounded").forEach((star) => {
    star.addEventListener("click", () => {
      recipe.rating =
        recipe.rating === parseInt(star.dataset.star, 10)
          ? 0
          : parseInt(star.dataset.star, 10);
      recipe.updatedAt = nowIso();
      saveLocal();
      saveToCloud(recipe);
      openDetail(recipe.id);
      fullRender();
    });
  });

  $$(".comparison-item").forEach((item) => {
    item.addEventListener("click", () => openDetail(item.dataset.openId));
  });

  $("#detail-toggle-status").addEventListener("click", () => {
    const order = ["want", "tried", "approved"];
    const nextStatus = order[(order.indexOf(recipe.status) + 1) % order.length];
    recipe.status = nextStatus;
    if (nextStatus === "approved" && recipe.attemptResult === "untested") {
      recipe.attemptResult = "success";
    }
    recipe.updatedAt = nowIso();
    saveLocal();
    saveToCloud(recipe);
    openDetail(recipe.id);
    fullRender();
    toast(`Status changed to ${humanize(nextStatus)}`);
  });

  $("#detail-toggle-favorite").addEventListener("click", () => {
    recipe.favorite = !recipe.favorite;
    recipe.updatedAt = nowIso();
    saveLocal();
    saveToCloud(recipe);
    openDetail(recipe.id);
    fullRender();
    toast(recipe.favorite ? "Marked as favorite" : "Favorite removed");
  });

  $("#detail-new-version").addEventListener("click", () => {
    closeModal("detail-modal");
    openEditForm(recipe, { asNewVersion: true });
  });

  $("#detail-edit").addEventListener("click", () => {
    closeModal("detail-modal");
    openEditForm(recipe);
  });

  $("#detail-delete").addEventListener("click", async () => {
    if (!confirm(`Delete "${recipe.title}"?`)) return;
    recipes = recipes.filter((item) => item.id !== recipe.id);
    saveLocal();
    await deleteFromCloud(recipe.id);
    closeModal("detail-modal");
    fullRender();
    toast("Recipe deleted");
  });

  openModal("detail-modal");
}

function getNextVersionName(versionGroupId) {
  const versions = recipes.filter((recipe) => recipe.versionGroupId === versionGroupId);
  return `v${versions.length + 1}`;
}

function updateFormStars() {
  $$("#form-stars .material-symbols-rounded").forEach((star) => {
    star.classList.toggle("filled", parseInt(star.dataset.star, 10) <= formRating);
  });
}

function resetForm() {
  editingId = null;
  formVersionContext = null;
  formRating = 0;
  $("#recipe-save-form").reset();
  $("#recipe-id").value = "";
  $("#recipe-version-group").value = "";
  $("#recipe-parent-id").value = "";
  $("#recipe-favorite").checked = false;
  $("#recipe-would-repeat").value = "";
  $("#quick-paste").value = "";
  $("#add-modal-title").textContent = "Add recipe experiment";
  updateFormStars();
  switchTab("manual");
}

function openEditForm(recipe, options = {}) {
  resetForm();

  const asNewVersion = Boolean(options.asNewVersion);
  const targetId = asNewVersion ? uuid() : recipe.id;
  const versionGroupId = recipe.versionGroupId || recipe.id;
  const versionName = asNewVersion
    ? getNextVersionName(versionGroupId)
    : recipe.versionName;

  editingId = asNewVersion ? null : recipe.id;
  formVersionContext = {
    id: targetId,
    versionGroupId,
    parentRecipeId: asNewVersion ? recipe.id : recipe.parentRecipeId,
    createdAt: asNewVersion ? nowIso() : recipe.createdAt,
    versionName,
  };

  $("#recipe-id").value = targetId;
  $("#recipe-version-group").value = versionGroupId;
  $("#recipe-parent-id").value = formVersionContext.parentRecipeId || "";
  $("#recipe-title").value = recipe.title;
  $("#recipe-version-name").value = versionName;
  $("#recipe-cuisine").value = recipe.cuisine;
  $("#recipe-source").value = recipe.source;
  $("#recipe-ai-model").value = recipe.aiModel;
  $("#recipe-craving").value = recipe.craving;
  $("#recipe-pantry").value = recipe.pantrySnapshot.join("\n");
  $("#recipe-prompt").value = recipe.prompt;
  $("#recipe-source-text").value = recipe.sourceText;
  $("#recipe-tags").value = recipe.tags.join(", ");
  $("#recipe-ingredients").value = recipe.ingredients.join("\n");
  $("#recipe-instructions").value = recipe.instructions.join("\n");
  $("#recipe-status").value = asNewVersion ? "want" : recipe.status;
  $("#recipe-attempt-result").value = asNewVersion ? "untested" : recipe.attemptResult;
  $("#recipe-actual-time").value = asNewVersion ? "" : recipe.actualTimeMinutes || "";
  $("#recipe-difficulty").value = recipe.difficulty;
  $("#recipe-cost").value = recipe.cost;
  $("#recipe-review").value = recipe.review;
  $("#recipe-what-worked").value = recipe.whatWorked;
  $("#recipe-what-didnt").value = recipe.whatDidnt;
  $("#recipe-next-change").value = recipe.changesNextTime;
  $("#recipe-occasion").value = recipe.occasion;
  $("#recipe-favorite").checked = asNewVersion ? false : recipe.favorite;
  $("#recipe-would-repeat").value =
    recipe.wouldRepeat === null ? "" : recipe.wouldRepeat ? "yes" : "no";

  formRating = asNewVersion ? 0 : recipe.rating;
  updateFormStars();
  $("#add-modal-title").textContent = asNewVersion
    ? `New version from ${recipe.versionName}`
    : "Edit recipe experiment";
  openModal("add-modal");
}

function switchTab(tab) {
  $$(".tab-btn").forEach((button) =>
    button.classList.toggle("active", button.dataset.tab === tab),
  );
  $("#tab-manual").style.display = tab === "manual" ? "" : "none";
  $("#tab-quick").style.display = tab === "quick" ? "" : "none";
  $("#add-save").style.display = tab === "manual" ? "" : "none";
}

function parseRecipeText(text) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  let title = "";
  let cuisine = "";
  let source = "";
  let aiModel = "";
  let prompt = "";
  let craving = "";
  let tags = [];
  let ingredients = [];
  let instructions = [];
  let section = "";

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lower = line.toLowerCase().replace(/[*#:_]/g, "").trim();

    if (!title && (line.startsWith("#") || index === 0)) {
      title = line.replace(/^#+\s*/, "").trim();
      continue;
    }

    if (/^source/.test(lower)) {
      source = line.replace(/^[^:]*:\s*/, "").trim();
      continue;
    }

    if (/^(ai|model)/.test(lower)) {
      aiModel = line.replace(/^[^:]*:\s*/, "").trim();
      continue;
    }

    if (/^cuisine/.test(lower)) {
      cuisine = line.replace(/^[^:]*:\s*/, "").trim();
      continue;
    }

    if (/^prompt/.test(lower)) {
      prompt = line.replace(/^[^:]*:\s*/, "").trim();
      continue;
    }

    if (/^(craving|wanted|want)/.test(lower)) {
      craving = line.replace(/^[^:]*:\s*/, "").trim();
      continue;
    }

    if (/^tags?/.test(lower)) {
      tags = splitCsv(line.replace(/^[^:]*:\s*/, ""));
      continue;
    }

    if (/^ingredients?/.test(lower)) {
      section = "ingredients";
      continue;
    }

    if (
      /^(instructions?|directions?|steps?|method|preparation|how to make|procedure)/.test(
        lower,
      )
    ) {
      section = "instructions";
      continue;
    }

    const cleaned = line
      .replace(/^[-•*]\s*/, "")
      .replace(/^\d+[.)]\s*/, "")
      .trim();

    if (!cleaned) continue;

    if (section === "ingredients") {
      ingredients.push(cleaned);
      continue;
    }

    if (section === "instructions") {
      instructions.push(cleaned);
      continue;
    }

    if (
      /^\d|^(a |one |two |three |half |¼|½|¾|⅓|⅔)/i.test(cleaned) &&
      cleaned.length < 90
    ) {
      ingredients.push(cleaned);
    } else if (cleaned.length > 35) {
      instructions.push(cleaned);
    }
  }

  if (!source && /chatgpt/i.test(text)) source = "ChatGPT";
  if (!source && /claude/i.test(text)) source = "Claude";
  if (!source && /gemini/i.test(text)) source = "Gemini";
  if (!aiModel && /chatgpt/i.test(text)) aiModel = "ChatGPT";
  if (!aiModel && /claude/i.test(text)) aiModel = "Claude";
  if (!aiModel && /gemini/i.test(text)) aiModel = "Gemini";

  return {
    title,
    cuisine,
    source,
    aiModel: AI_MODELS.includes(aiModel) ? aiModel : "",
    prompt,
    craving,
    tags,
    ingredients,
    instructions,
    sourceText: text.trim(),
  };
}

function fillFormFromParsed(parsed) {
  switchTab("manual");
  $("#recipe-title").value = parsed.title;
  $("#recipe-cuisine").value = parsed.cuisine;
  $("#recipe-source").value = parsed.source;
  $("#recipe-ai-model").value = parsed.aiModel;
  $("#recipe-prompt").value = parsed.prompt;
  $("#recipe-craving").value = parsed.craving;
  $("#recipe-tags").value = parsed.tags.join(", ");
  $("#recipe-ingredients").value = parsed.ingredients.join("\n");
  $("#recipe-instructions").value = parsed.instructions.join("\n");
  $("#recipe-source-text").value = parsed.sourceText;
  toast("Recipe parsed. Review the details and save.");
}

function collectFormData() {
  const existing = recipes.find((recipe) => recipe.id === editingId);
  const targetId = $("#recipe-id").value || editingId || uuid();
  const versionGroupId =
    $("#recipe-version-group").value || existing?.versionGroupId || targetId;
  const parentRecipeId = $("#recipe-parent-id").value || existing?.parentRecipeId || null;
  const wouldRepeatValue = $("#recipe-would-repeat").value;

  return normalizeRecipe({
    id: targetId,
    title: $("#recipe-title").value.trim(),
    versionName: $("#recipe-version-name").value.trim() || "v1",
    versionGroupId,
    parentRecipeId,
    cuisine: $("#recipe-cuisine").value.trim(),
    source: $("#recipe-source").value.trim(),
    aiModel: $("#recipe-ai-model").value,
    craving: $("#recipe-craving").value.trim(),
    pantrySnapshot: $("#recipe-pantry").value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    prompt: $("#recipe-prompt").value.trim(),
    sourceText: $("#recipe-source-text").value.trim(),
    tags: splitCsv($("#recipe-tags").value),
    ingredients: $("#recipe-ingredients").value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    instructions: $("#recipe-instructions").value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    status: $("#recipe-status").value,
    favorite: $("#recipe-favorite").checked,
    attemptResult: $("#recipe-attempt-result").value,
    wouldRepeat:
      wouldRepeatValue === "" ? null : wouldRepeatValue === "yes",
    actualTimeMinutes: $("#recipe-actual-time").value,
    difficulty: $("#recipe-difficulty").value,
    cost: $("#recipe-cost").value,
    rating: formRating,
    review: $("#recipe-review").value.trim(),
    whatWorked: $("#recipe-what-worked").value.trim(),
    whatDidnt: $("#recipe-what-didnt").value.trim(),
    changesNextTime: $("#recipe-next-change").value.trim(),
    occasion: $("#recipe-occasion").value.trim(),
    createdAt:
      formVersionContext?.createdAt || existing?.createdAt || nowIso(),
    updatedAt: nowIso(),
  });
}

function upsertRecipe(recipe) {
  const index = recipes.findIndex((item) => item.id === recipe.id);
  if (index >= 0) recipes[index] = recipe;
  else recipes.push(recipe);
}

function fullRender() {
  renderStats();
  renderInsights();
  renderFilterOptions();
  renderGrid();
}

function openModal(id) {
  $(`#${id}`).classList.add("active");
  document.body.style.overflow = "hidden";
}

function closeModal(id) {
  $(`#${id}`).classList.remove("active");
  document.body.style.overflow = "";
}

$("#recipe-save-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = $("#recipe-save-form");
  if (!form.reportValidity()) return;

  const wasEditing = Boolean(editingId);
  const recipe = collectFormData();
  upsertRecipe(recipe);
  saveLocal();
  await saveToCloud(recipe);
  closeModal("add-modal");
  resetForm();
  fullRender();
  toast(wasEditing ? "Recipe updated" : "Recipe saved");
});

$("#btn-parse").addEventListener("click", () => {
  const raw = $("#quick-paste").value.trim();
  if (!raw) return;
  fillFormFromParsed(parseRecipeText(raw));
});

$("#btn-export").addEventListener("click", () => {
  if (!recipes.length) {
    toast("No recipes to export");
    return;
  }

  const blob = new Blob([JSON.stringify(recipes, null, 2)], {
    type: "application/json",
  });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `recipe-vault-export-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
  toast("Recipes exported");
});

$("#btn-import").addEventListener("click", () => $("#import-input").click());

$("#import-input").addEventListener("change", (event) => {
  const [file] = event.target.files || [];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (loadEvent) => {
    try {
      const imported = JSON.parse(loadEvent.target.result);
      if (!Array.isArray(imported)) throw new Error("Invalid import payload");

      const normalized = imported.map(normalizeRecipe);
      normalized.forEach((recipe) => upsertRecipe(recipe));
      saveLocal();
      await Promise.all(normalized.map((recipe) => saveToCloud(recipe)));
      fullRender();
      toast(`Imported ${normalized.length} recipe experiments`);
    } catch (error) {
      console.warn(error);
      toast("Invalid file format");
    }
  };

  reader.readAsText(file);
  event.target.value = "";
});

$("#btn-add-recipe").addEventListener("click", () => {
  resetForm();
  $("#recipe-id").value = uuid();
  $("#recipe-version-group").value = $("#recipe-id").value;
  $("#recipe-version-name").value = "v1";
  openModal("add-modal");
});

$("#add-modal-close").addEventListener("click", () => closeModal("add-modal"));
$("#add-cancel").addEventListener("click", () => closeModal("add-modal"));
$("#detail-close").addEventListener("click", () => closeModal("detail-modal"));

["add-modal", "detail-modal"].forEach((id) => {
  $(`#${id}`).addEventListener("click", (event) => {
    if (event.target === $(`#${id}`)) closeModal(id);
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if ($("#detail-modal").classList.contains("active")) closeModal("detail-modal");
  if ($("#add-modal").classList.contains("active")) closeModal("add-modal");
});

$$("#form-stars .material-symbols-rounded").forEach((star) => {
  star.addEventListener("click", () => {
    const value = parseInt(star.dataset.star, 10);
    formRating = formRating === value ? 0 : value;
    updateFormStars();
  });
});

$$(".tab-btn").forEach((button) => {
  button.addEventListener("click", () => switchTab(button.dataset.tab));
});

[
  "#search-input",
  "#ingredient-match-input",
  "#filter-cuisine",
  "#filter-rating",
  "#filter-status",
  "#filter-tag",
  "#filter-ai",
  "#filter-match",
].forEach((selector) => {
  $(selector).addEventListener(
    selector.includes("input") ? "input" : "change",
    renderGrid,
  );
});

$("#clear-filters").addEventListener("click", () => {
  $("#search-input").value = "";
  $("#ingredient-match-input").value = "";
  $("#filter-cuisine").value = "";
  $("#filter-rating").value = "";
  $("#filter-status").value = "";
  $("#filter-tag").value = "";
  $("#filter-ai").value = "";
  $("#filter-match").value = "";
  renderGrid();
});

init();
