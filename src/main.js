import "./style.css";
import { supabase, CLOUD_ENABLED } from "./supabase.js";

/* ─── State ─── */
const LS_KEY = "recipe_vault_data";
let recipes = [];
let formRating = 0;
let editingId = null;

/* ─── Helpers ─── */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const uuid = () => crypto.randomUUID();

function saveLocal() {
  localStorage.setItem(LS_KEY, JSON.stringify(recipes));
}
function loadLocal() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY)) || [];
  } catch {
    return [];
  }
}

function toast(msg) {
  const container = $("#toast-container");
  if (!container) return;
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<span class="material-symbols-rounded">check_circle</span>${msg}`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3100);
}

/* ─── Cloud Data (no auth) ─── */
function dbToLocal(r) {
  return {
    id: r.id,
    title: r.title,
    cuisine: r.cuisine || "",
    source: r.source || "",
    ingredients: r.ingredients || [],
    instructions: r.instructions || [],
    status: r.status || "want",
    rating: r.rating || 0,
    review: r.review || "",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
function localToDb(r) {
  return {
    id: r.id,
    title: r.title,
    cuisine: r.cuisine || null,
    source: r.source || null,
    ingredients: r.ingredients || [],
    instructions: r.instructions || [],
    status: r.status,
    rating: r.rating,
    review: r.review || null,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
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
  } catch (err) {
    console.warn("Cloud load failed:", err);
    return false;
  }
}

async function saveToCloud(recipe) {
  if (!CLOUD_ENABLED) return;
  try {
    const { error } = await supabase.from("recipes").upsert(localToDb(recipe));
    if (error) throw error;
  } catch (err) {
    console.warn("Cloud save failed:", err);
  }
}

async function deleteFromCloud(id) {
  if (!CLOUD_ENABLED) return;
  try {
    const { error } = await supabase.from("recipes").delete().eq("id", id);
    if (error) throw error;
  } catch (err) {
    console.warn("Cloud delete failed:", err);
  }
}

/* ─── Init ─── */
async function init() {
  const indicator = $("#sync-indicator");
  const cloudOk = await loadFromCloud();
  if (cloudOk) {
    indicator.className = "sync-indicator cloud";
    indicator.innerHTML =
      '<span class="material-symbols-rounded">cloud_done</span>Cloud';
  } else {
    recipes = loadLocal();
    if (CLOUD_ENABLED) {
      indicator.className = "sync-indicator local";
      indicator.innerHTML =
        '<span class="material-symbols-rounded">cloud_off</span>Offline';
    } else {
      indicator.className = "sync-indicator local";
      indicator.innerHTML =
        '<span class="material-symbols-rounded">smartphone</span>Local';
    }
  }
  document.body.classList.remove("loading");
  fullRender();
}

/* ─── Render Stars ─── */
function starsHTML(rating, size = 16) {
  let html = '<span class="stars">';
  for (let i = 1; i <= 5; i++) {
    html += `<span class="material-symbols-rounded${i <= rating ? " filled" : ""}" style="font-size:${size}px;">star</span>`;
  }
  return html + "</span>";
}

/* ─── Render Stats ─── */
function renderStats() {
  $("#stat-total").textContent = recipes.length;
  const rated = recipes.filter((r) => r.rating > 0);
  if (rated.length) {
    const avg = rated.reduce((s, r) => s + r.rating, 0) / rated.length;
    $("#stat-avg-rating").innerHTML =
      avg.toFixed(1) + " " + starsHTML(Math.round(avg), 14);
  } else {
    $("#stat-avg-rating").textContent = "—";
  }
  const cuisines = {};
  recipes.forEach((r) => {
    if (r.cuisine) cuisines[r.cuisine] = (cuisines[r.cuisine] || 0) + 1;
  });
  const topCuisine = Object.entries(cuisines).sort((a, b) => b[1] - a[1])[0];
  $("#stat-top-cuisine").textContent = topCuisine ? topCuisine[0] : "—";
  const tried = recipes.filter((r) => r.status === "tried").length;
  $("#stat-tried").textContent = `${tried} / ${recipes.length - tried}`;
}

/* ─── Render Cuisine Filter ─── */
function renderCuisineFilter() {
  const sel = $("#filter-cuisine");
  const current = sel.value;
  const cuisines = [
    ...new Set(recipes.map((r) => r.cuisine).filter(Boolean)),
  ].sort();
  sel.innerHTML =
    '<option value="">All Cuisines</option>' +
    cuisines.map((c) => `<option value="${c}">${c}</option>`).join("");
  sel.value = current;
}

/* ─── Render Grid ─── */
function renderGrid() {
  const grid = $("#recipe-grid");
  const search = $("#search-input").value.toLowerCase().trim();
  const cuisine = $("#filter-cuisine").value;
  const ratingFilter = $("#filter-rating").value;
  const statusFilter = $("#filter-status").value;

  let filtered = recipes.filter((r) => {
    if (
      search &&
      !r.title.toLowerCase().includes(search) &&
      !(r.cuisine || "").toLowerCase().includes(search)
    )
      return false;
    if (cuisine && r.cuisine !== cuisine) return false;
    if (statusFilter === "tried" && r.status !== "tried") return false;
    if (statusFilter === "want" && r.status === "tried") return false;
    if (ratingFilter !== "") {
      const rv = parseInt(ratingFilter);
      if (rv === 0 && r.rating > 0) return false;
      if (rv > 0 && r.rating < rv) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    if (a.status !== b.status) return a.status === "tried" ? -1 : 1;
    return a.title.localeCompare(b.title);
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
    <div class="empty-state">
      <span class="material-symbols-rounded">restaurant</span>
      <h3>${recipes.length === 0 ? "No recipes yet" : "No matches found"}</h3>
      <p>${recipes.length === 0 ? 'Click "Add Recipe" to save your first recipe!' : "Try adjusting your search or filters."}</p>
    </div>`;
    return;
  }

  grid.innerHTML = filtered
    .map((r) => {
      const ingredientPreview = (r.ingredients || []).slice(0, 3).join(", ");
      return `
    <article class="recipe-card" data-id="${r.id}" tabindex="0">
      <div class="card-header">
        <h3 class="card-title">${esc(r.title)}</h3>
        ${r.rating > 0 ? starsHTML(r.rating) : ""}
      </div>
      <div class="card-meta">
        ${r.status === "tried" ? '<span class="badge badge-tried">Tried</span>' : '<span class="badge badge-want">Want to Try</span>'}
        ${r.cuisine ? `<span class="badge badge-cuisine">${esc(r.cuisine)}</span>` : ""}
        ${r.source ? `<span class="badge badge-source">${esc(r.source)}</span>` : ""}
      </div>
      <p class="card-preview">${esc(ingredientPreview)}${r.ingredients && r.ingredients.length > 3 ? "…" : ""}</p>
    </article>`;
    })
    .join("");

  $$(".recipe-card", grid).forEach((card) => {
    card.addEventListener("click", () => openDetail(card.dataset.id));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter") openDetail(card.dataset.id);
    });
  });
}

function esc(str) {
  const el = document.createElement("span");
  el.textContent = str || "";
  return el.innerHTML;
}
function fullRender() {
  renderStats();
  renderCuisineFilter();
  renderGrid();
}

/* ─── Detail Modal ─── */
function openDetail(id) {
  const r = recipes.find((x) => x.id === id);
  if (!r) return;
  const body = $("#detail-body");
  body.innerHTML = `
  <h2 class="detail-title">${esc(r.title)}</h2>
  <div class="detail-badges">
    ${r.status === "tried" ? '<span class="badge badge-tried">Tried</span>' : '<span class="badge badge-want">Want to Try</span>'}
    ${r.cuisine ? `<span class="badge badge-cuisine">${esc(r.cuisine)}</span>` : ""}
    ${r.source ? `<span class="badge badge-source">${esc(r.source)}</span>` : ""}
  </div>
  <div class="detail-rating">
    <div class="detail-rating-label">Your Rating</div>
    <div class="stars stars-interactive" id="detail-stars" data-id="${r.id}">
      ${[1, 2, 3, 4, 5].map((i) => `<span class="material-symbols-rounded${i <= r.rating ? " filled" : ""}" data-star="${i}">star</span>`).join("")}
    </div>
    ${r.review ? `<div class="review-note">"${esc(r.review)}"</div>` : ""}
  </div>
  <div class="detail-section"><h3>Ingredients</h3>
    <ul class="ingredient-list">${(r.ingredients || []).map((ing) => `<li>${esc(ing)}</li>`).join("")}</ul>
  </div>
  <div class="detail-section"><h3>Instructions</h3>
    <ol class="instruction-list">${(r.instructions || []).map((step) => `<li>${esc(step)}</li>`).join("")}</ol>
  </div>
  <div class="detail-actions">
    <button class="btn" id="detail-toggle-status" data-id="${r.id}">
      <span class="material-symbols-rounded">${r.status === "tried" ? "undo" : "check_circle"}</span>
      Mark as ${r.status === "tried" ? "Want to Try" : "Tried"}
    </button>
    <button class="btn" id="detail-edit" data-id="${r.id}"><span class="material-symbols-rounded">edit</span> Edit</button>
    <button class="btn btn-danger" id="detail-delete" data-id="${r.id}"><span class="material-symbols-rounded">delete</span> Delete</button>
  </div>`;

  $$("#detail-stars .material-symbols-rounded").forEach((star) => {
    star.addEventListener("click", () => {
      r.rating =
        r.rating === parseInt(star.dataset.star)
          ? 0
          : parseInt(star.dataset.star);
      r.updatedAt = new Date().toISOString();
      saveLocal();
      saveToCloud(r);
      openDetail(id);
      fullRender();
    });
  });
  $("#detail-toggle-status").addEventListener("click", () => {
    r.status = r.status === "tried" ? "want" : "tried";
    r.updatedAt = new Date().toISOString();
    saveLocal();
    saveToCloud(r);
    openDetail(id);
    fullRender();
    toast(`Marked as ${r.status === "tried" ? "Tried" : "Want to Try"}`);
  });
  $("#detail-edit").addEventListener("click", () => {
    closeModal("detail-modal");
    openEditForm(r);
  });
  $("#detail-delete").addEventListener("click", () => {
    if (!confirm(`Delete "${r.title}"?`)) return;
    recipes = recipes.filter((x) => x.id !== r.id);
    saveLocal();
    deleteFromCloud(r.id);
    closeModal("detail-modal");
    fullRender();
    toast("Recipe deleted");
  });
  openModal("detail-modal");
}

/* ─── Add / Edit Modal ─── */
function resetForm() {
  $("#recipe-form").reset();
  $("#recipe-id").value = "";
  formRating = 0;
  editingId = null;
  updateFormStars();
  switchTab("manual");
  $("#add-modal-title").textContent = "Add Recipe";
}
function openEditForm(r) {
  resetForm();
  editingId = r.id;
  $("#recipe-id").value = r.id;
  $("#recipe-title").value = r.title;
  $("#recipe-cuisine").value = r.cuisine || "";
  $("#recipe-source").value = r.source || "";
  $("#recipe-ingredients").value = (r.ingredients || []).join("\n");
  $("#recipe-instructions").value = (r.instructions || []).join("\n");
  $("#recipe-status").value = r.status || "want";
  $("#recipe-review").value = r.review || "";
  formRating = r.rating || 0;
  updateFormStars();
  $("#add-modal-title").textContent = "Edit Recipe";
  openModal("add-modal");
}
function updateFormStars() {
  $$("#form-stars .material-symbols-rounded").forEach((s) => {
    s.classList.toggle("filled", parseInt(s.dataset.star) <= formRating);
  });
}
$$("#form-stars .material-symbols-rounded").forEach((s) => {
  s.addEventListener("click", () => {
    const v = parseInt(s.dataset.star);
    formRating = formRating === v ? 0 : v;
    updateFormStars();
  });
});
$$(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});
function switchTab(tab) {
  $$(".tab-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === tab),
  );
  $("#tab-manual").style.display = tab === "manual" ? "" : "none";
  $("#tab-quick").style.display = tab === "quick" ? "" : "none";
  $("#add-save").style.display = tab === "manual" ? "" : "none";
}

$("#add-save").addEventListener("click", () => {
  const form = $("#recipe-form");
  if (!form.reportValidity()) return;
  const data = {
    id: editingId || uuid(),
    title: $("#recipe-title").value.trim(),
    cuisine: $("#recipe-cuisine").value.trim(),
    source: $("#recipe-source").value.trim(),
    ingredients: $("#recipe-ingredients")
      .value.split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
    instructions: $("#recipe-instructions")
      .value.split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
    status: $("#recipe-status").value,
    rating: formRating,
    review: $("#recipe-review").value.trim(),
    createdAt: editingId
      ? (recipes.find((r) => r.id === editingId) || {}).createdAt ||
        new Date().toISOString()
      : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (editingId) {
    recipes = recipes.map((r) => (r.id === editingId ? data : r));
  } else {
    recipes.push(data);
  }
  saveLocal();
  saveToCloud(data);
  closeModal("add-modal");
  resetForm();
  fullRender();
  toast(editingId ? "Recipe updated" : "Recipe saved");
});

/* ─── Quick Add Parser ─── */
$("#btn-parse").addEventListener("click", () => {
  const raw = $("#quick-paste").value.trim();
  if (!raw) return;
  const parsed = parseRecipeText(raw);
  switchTab("manual");
  $("#recipe-title").value = parsed.title;
  $("#recipe-cuisine").value = parsed.cuisine;
  $("#recipe-ingredients").value = parsed.ingredients.join("\n");
  $("#recipe-instructions").value = parsed.instructions.join("\n");
  toast("Recipe parsed — review and save!");
});

function parseRecipeText(text) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  let title = "",
    cuisine = "",
    ingredients = [],
    instructions = [],
    section = "none";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase().replace(/[*#_:]/g, "").trim();
    if (!title && (line.startsWith("#") || i === 0)) {
      title = line.replace(/^#+\s*/, "").trim();
      continue;
    }
    if (/^cuisine\s*:?/.test(lower)) {
      cuisine = line.replace(/^[^:]*:\s*/, "").trim();
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
    } else if (section === "instructions") {
      instructions.push(cleaned);
    } else if (
      /^\d|^(a |one |two |three |half |¼|½|¾|⅓|⅔)/i.test(cleaned) &&
      cleaned.length < 80
    ) {
      ingredients.push(cleaned);
      if (section === "none") section = "ingredients";
    }
  }
  if (instructions.length === 0 && ingredients.length > 0) {
    const ingSet = new Set(ingredients);
    for (const line of lines) {
      const c = line
        .replace(/^[-•*]\s*/, "")
        .replace(/^\d+[.)]\s*/, "")
        .trim();
      if (c && !ingSet.has(c) && c !== title && c.length > 30)
        instructions.push(c);
    }
  }
  return { title, cuisine, ingredients, instructions };
}

/* ─── Import / Export ─── */
$("#btn-export").addEventListener("click", () => {
  if (recipes.length === 0) {
    toast("No recipes to export");
    return;
  }
  const blob = new Blob([JSON.stringify(recipes, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `recipe-vault-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Recipes exported!");
});
$("#btn-import").addEventListener("click", () => $("#import-input").click());
$("#import-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const imported = JSON.parse(ev.target.result);
      if (!Array.isArray(imported)) throw new Error();
      const existingIds = new Set(recipes.map((r) => r.id));
      let added = 0;
      imported.forEach((r) => {
        if (!r.id) r.id = uuid();
        if (!existingIds.has(r.id)) {
          recipes.push(r);
          added++;
          saveToCloud(r);
        }
      });
      saveLocal();
      fullRender();
      toast(`Imported ${added} new recipe${added !== 1 ? "s" : ""}!`);
    } catch {
      toast("Invalid file format");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

/* ─── Modal Helpers ─── */
function openModal(id) {
  $(`#${id}`).classList.add("active");
  document.body.style.overflow = "hidden";
}
function closeModal(id) {
  $(`#${id}`).classList.remove("active");
  document.body.style.overflow = "";
}
$("#btn-add-recipe").addEventListener("click", () => {
  resetForm();
  openModal("add-modal");
});
$("#add-modal-close").addEventListener("click", () => closeModal("add-modal"));
$("#add-cancel").addEventListener("click", () => closeModal("add-modal"));
$("#detail-close").addEventListener("click", () => closeModal("detail-modal"));
["add-modal", "detail-modal"].forEach((id) => {
  $(`#${id}`).addEventListener("click", (e) => {
    if (e.target === $(`#${id}`)) closeModal(id);
  });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if ($("#detail-modal").classList.contains("active"))
      closeModal("detail-modal");
    else if ($("#add-modal").classList.contains("active"))
      closeModal("add-modal");
  }
});

/* ─── Filters & Search ─── */
$("#search-input").addEventListener("input", renderGrid);
$("#filter-cuisine").addEventListener("change", renderGrid);
$("#filter-rating").addEventListener("change", renderGrid);
$("#filter-status").addEventListener("change", renderGrid);

/* ─── Boot ─── */
init();
