"use strict";

/**
 * Dashboard for arc 0002's GitHub Pages deploy (see docs/plans/0002-readiness-dashboard.md).
 * Plain browser script, zero build step, zero npm dependency — not swept by tsconfig.json's
 * `include` list (different globals than Node), so it's verified by effect (a local static
 * server), not typechecked or unit-tested, same convention this repo already applies to
 * `.github/workflows/*.yml`.
 *
 * All fetch paths are relative (`data/...`, never `/data/...`) because the real deploy is
 * served under `/agent-readiness-kit/`, not domain root.
 */

const CATEGORIES = ["Discovery", "Content", "Trust", "Execution", "Agent-to-Agent", "Identity & Auth"];

/** Short labels so a category's pass/fail/warn/unknown breakdown badge stays compact; the full
 * category name is still available via the badge's `title` tooltip and its screen-reader text. */
const CATEGORY_ABBR = {
  Discovery: "Disc",
  Content: "Cont",
  Trust: "Trust",
  Execution: "Exec",
  "Agent-to-Agent": "A2A",
  "Identity & Auth": "Auth",
};

/** Worst-first tiebreak for a single representative status per category badge / sparkline dot. */
const STATUS_PRIORITY = ["fail", "warn", "unknown", "pass"];

const STATUS_CLASS = {
  pass: "status-pass",
  warn: "status-warn",
  fail: "status-fail",
  unknown: "status-unknown",
};

/** Three pass/warn/fail presets over a 0-100 score (client-side, display-only — see the plan's
 * Threshold model). `pass` is the minimum score to count as passing; `fail` is the maximum
 * score (exclusive) that counts as failing; anything in between is `warn`. */
const THRESHOLDS = {
  high: { pass: 80, fail: 60 },
  mid: { pass: 60, fail: 40 },
  low: { pass: 40, fail: 20 },
};
const DEFAULT_THRESHOLD = "mid";
const THRESHOLD_STORAGE_KEY = "ark-threshold";

function getStoredThreshold() {
  try {
    const stored = window.localStorage.getItem(THRESHOLD_STORAGE_KEY);
    return stored && THRESHOLDS[stored] ? stored : DEFAULT_THRESHOLD;
  } catch {
    return DEFAULT_THRESHOLD;
  }
}

function setStoredThreshold(key) {
  try {
    window.localStorage.setItem(THRESHOLD_STORAGE_KEY, key);
  } catch {
    // Best-effort only — a private window or blocked storage just won't persist the choice.
  }
}

/** Mirrors scripts/buildSite.ts's `summarizeScanRun` fallback formula exactly — this browser
 * script has no build step to import that module from, so the same logic is restated here. */
function fallbackScore(findings) {
  let pass = 0;
  let graded = 0;
  for (const finding of findings) {
    if (finding.status === "pass") pass += 1;
    if (finding.status === "pass" || finding.status === "fail" || finding.status === "warn") graded += 1;
  }
  return graded === 0 ? undefined : Math.round((100 * pass) / graded);
}

function effectiveScore(run) {
  return typeof run.score === "number" ? run.score : fallbackScore(run.findings);
}

function statusForScore(score, thresholdKey) {
  if (typeof score !== "number") return "unknown";
  const { pass, fail } = THRESHOLDS[thresholdKey];
  if (score >= pass) return "pass";
  if (score < fail) return "fail";
  return "warn";
}

async function fetchJson(path) {
  try {
    const response = await fetch(path);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function countsByCategory(findings) {
  const counts = {};
  for (const category of CATEGORIES) {
    counts[category] = { pass: 0, fail: 0, warn: 0, unknown: 0 };
  }
  for (const finding of findings) {
    const bucket = counts[finding.category];
    if (bucket) bucket[finding.status] += 1;
  }
  return counts;
}

function worstStatus(counts) {
  return STATUS_PRIORITY.find((status) => counts[status] > 0) ?? "unknown";
}

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children ?? []) node.appendChild(child);
  return node;
}

function buildStatusBadge(status, label) {
  return el("span", { class: `status-badge ${STATUS_CLASS[status] ?? "status-unknown"}`, text: label });
}

function buildCategoryBadges(findings) {
  const byCategory = countsByCategory(findings);
  return CATEGORIES.map((category) => {
    const counts = byCategory[category];
    const status = worstStatus(counts);
    const description = `${category}: ${counts.pass} pass, ${counts.fail} fail, ${counts.warn} warn, ${counts.unknown} unknown`;
    const badge = el("span", {
      class: `category-badge ${STATUS_CLASS[status]}`,
      title: description,
      "aria-label": description,
      text: `${CATEGORY_ABBR[category]} ${counts.pass}P ${counts.fail}F ${counts.warn}W`,
    });
    return badge;
  });
}

const SPARKLINE_WIDTH = 120;
const SPARKLINE_HEIGHT = 32;

function scoreToY(score) {
  const clamped = Math.max(0, Math.min(100, score ?? 0));
  return SPARKLINE_HEIGHT - (clamped / 100) * SPARKLINE_HEIGHT;
}

/** N=0/N=1-safe hand-rolled sparkline — a plain <polyline> renders nothing for a single point,
 * so N=1 draws a lone dot instead of an (empty) line. */
function buildSparkline(history, thresholdKey) {
  const wrap = el("div", { class: "sparkline-wrap" });
  if (history.length === 0) {
    wrap.appendChild(el("span", { class: "sparkline-note", text: "not enough history yet" }));
    return wrap;
  }

  const latest = history[history.length - 1];
  const latestStatus = statusForScore(latest.score, thresholdKey);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(SPARKLINE_WIDTH));
  svg.setAttribute("height", String(SPARKLINE_HEIGHT));
  svg.setAttribute("viewBox", `0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Score trend, latest ${latest.score ?? "unknown"}`);

  if (history.length > 1) {
    const points = history
      .map((point, i) => `${(i / (history.length - 1)) * SPARKLINE_WIDTH},${scoreToY(point.score)}`)
      .join(" ");
    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    polyline.setAttribute("points", points);
    polyline.setAttribute("fill", "none");
    polyline.setAttribute("stroke", "var(--color-text-muted)");
    polyline.setAttribute("stroke-width", "1.5");
    svg.appendChild(polyline);
  }

  const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  const dotX = history.length > 1 ? SPARKLINE_WIDTH : SPARKLINE_WIDTH / 2;
  dot.setAttribute("cx", String(dotX));
  dot.setAttribute("cy", String(scoreToY(latest.score)));
  dot.setAttribute("r", "3");
  dot.setAttribute("fill", `var(--color-${latestStatus === "pass" ? "positive" : latestStatus === "fail" ? "negative" : latestStatus === "warn" ? "caution" : "alt"})`);
  svg.appendChild(dot);

  wrap.appendChild(svg);
  if (history.length === 1) {
    wrap.appendChild(el("span", { class: "sparkline-note", text: "1 scan so far" }));
  }
  return wrap;
}

function buildCard(property, thresholdKey) {
  const { id, run, history } = property;
  const score = effectiveScore(run);
  const status = statusForScore(score, thresholdKey);
  const isOraAiScore = typeof run.score === "number";

  const titleLink = el("a", { href: run.url, text: run.url.replace(/^https?:\/\//, "") });
  const header = el("div", { class: "card-header" }, [
    el("h2", { class: "card-title" }, [titleLink]),
    buildStatusBadge(status, status),
  ]);

  const sourceNote = isOraAiScore
    ? el("a", {
        class: "score-source",
        href: `https://ora.ai/score/${run.url.replace(/^https?:\/\//, "")}`,
        target: "_blank",
        rel: "noopener noreferrer",
        title:
          "This score and grade are ora.ai's own aggregate, from ~124 automated checks - a " +
          "different metric than the category breakdown below, which counts only this tool's " +
          "own 18 crosswalk signals. Click to see the full ora.ai report.",
        text: "via ora.ai ↗",
      })
    : el("span", {
        class: "score-source score-source-fallback",
        title:
          "ora.ai did not return a score for this run; this is a fallback estimate computed " +
          "locally from this tool's own pass/fail/warn counts, not an ora.ai score.",
        text: "estimated",
      });

  const scoreLine = el("div", { class: "card-score" }, [
    el("span", { class: "score-value", text: typeof score === "number" ? String(score) : "n/a" }),
    ...(run.grade ? [el("span", { class: "score-grade", text: run.grade })] : []),
    sourceNote,
  ]);

  const categoryBadges = el("div", { class: "category-breakdown" }, buildCategoryBadges(run.findings));
  const sparkline = buildSparkline(history, thresholdKey);
  const footer = el("p", { class: "card-footer", text: `Last scanned ${new Date(run.scannedAt).toLocaleString()} (${id})` });

  return el("article", { class: "card" }, [header, scoreLine, categoryBadges, sparkline, footer]);
}

function renderCards(properties, thresholdKey) {
  const container = document.getElementById("cards");
  container.textContent = "";
  if (properties.length === 0) {
    container.appendChild(el("p", { class: "status-message", text: "No scan data found yet." }));
    return;
  }
  for (const property of properties) {
    container.appendChild(buildCard(property, thresholdKey));
  }
}

function renderFooter(properties) {
  const footerText = document.getElementById("footer-text");
  if (properties.length === 0) {
    footerText.textContent = "No scans recorded yet.";
    return;
  }
  const latest = properties.reduce((max, p) => (p.run.scannedAt > max ? p.run.scannedAt : max), properties[0].run.scannedAt);
  footerText.textContent = `Last scan across all properties: ${new Date(latest).toLocaleString()}`;
}

function wirePresetButtons(properties, initialThreshold) {
  const buttons = document.querySelectorAll(".preset-btn");
  function setActive(thresholdKey) {
    for (const button of buttons) {
      button.setAttribute("aria-pressed", String(button.dataset.preset === thresholdKey));
    }
    renderCards(properties, thresholdKey);
  }
  for (const button of buttons) {
    button.addEventListener("click", () => {
      const key = button.dataset.preset;
      setStoredThreshold(key);
      setActive(key);
    });
  }
  setActive(initialThreshold);
}

async function loadProperties() {
  const manifest = await fetchJson("data/index.json");
  if (!manifest) return [];

  const properties = [];
  for (const id of manifest) {
    const run = await fetchJson(`data/scans/${id}.json`);
    if (!run) continue; // A property listed in the manifest but unreadable is skipped, not fatal.
    const history = (await fetchJson(`data/history/${id}.json`)) ?? [];
    properties.push({ id, run, history });
  }
  return properties;
}

async function init() {
  const properties = await loadProperties();
  renderFooter(properties);
  wirePresetButtons(properties, getStoredThreshold());
}

init();
