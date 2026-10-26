"use strict";

const CSV_COLUMNS = [
  "radiant_team",
  "dire_team",
  "radiant_players",
  "dire_players",
  "radiant_heroes",
  "dire_heroes",
  "radiant_win",
];
const PRIOR_MATCHES = 8;
const PRIOR_PAIR_MATCHES = 12;
const MIN_PROBABILITY = 0.05;
const MAX_PROBABILITY = 0.95;

let history = [];

const elements = {
  file: document.querySelector("#history-file"),
  upload: document.querySelector("#upload-button"),
  template: document.querySelector("#template-button"),
  status: document.querySelector("#data-status"),
  dataError: document.querySelector("#data-error"),
  form: document.querySelector("#draft-form"),
  formError: document.querySelector("#form-error"),
  predict: document.querySelector("#predict-button"),
  result: document.querySelector("#result"),
  evidence: document.querySelector("#evidence"),
};

elements.upload.addEventListener("click", () => elements.file.click());
elements.file.addEventListener("change", loadHistory);
elements.template.addEventListener("click", downloadTemplate);
elements.form.addEventListener("submit", showPrediction);

function normalize(value) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function splitNames(value) {
  return value.split(",").map((name) => name.trim()).filter(Boolean);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error("The CSV contains an unclosed quoted field.");
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  if (rows.length < 2) throw new Error("The CSV must include a header and at least one match.");

  const headers = rows[0].map((header) => header.trim().toLocaleLowerCase().replace(/^\uFEFF/, ""));
  const missing = CSV_COLUMNS.filter((column) => !headers.includes(column));
  if (missing.length) throw new Error(`Missing required columns: ${missing.join(", ")}.`);

  const indexes = Object.fromEntries(CSV_COLUMNS.map((column) => [column, headers.indexOf(column)]));
  const matches = rows.slice(1).map((cells, rowIndex) => {
    const get = (column) => (cells[indexes[column]] || "").trim();
    const side = (column, label) => {
      const names = get(column).split(";").map((name) => name.trim()).filter(Boolean);
      if (names.length !== 5) throw new Error(`Row ${rowIndex + 2}: ${label} must contain exactly five semicolon-separated names.`);
      return names;
    };
    const win = get("radiant_win").toLocaleLowerCase();
    let radiantWin;
    if (["true", "1", "radiant"].includes(win)) radiantWin = true;
    else if (["false", "0", "dire"].includes(win)) radiantWin = false;
    else throw new Error(`Row ${rowIndex + 2}: radiant_win must be true, false, 1, 0, radiant, or dire.`);

    const radiantTeam = get("radiant_team");
    const direTeam = get("dire_team");
    if (!radiantTeam || !direTeam) throw new Error(`Row ${rowIndex + 2}: both team names are required.`);

    return {
      radiantTeam: normalize(radiantTeam),
      direTeam: normalize(direTeam),
      radiantPlayers: side("radiant_players", "radiant_players").map(normalize),
      direPlayers: side("dire_players", "dire_players").map(normalize),
      radiantHeroes: side("radiant_heroes", "radiant_heroes").map(normalize),
      direHeroes: side("dire_heroes", "dire_heroes").map(normalize),
      radiantWin,
    };
  });
  return matches;
}

async function loadHistory() {
  elements.dataError.hidden = true;
  const file = elements.file.files[0];
  if (!file) return;

  try {
    const parsed = parseCsv(await file.text());
    history = parsed;
    elements.status.textContent = `${parsed.length.toLocaleString()} completed ${parsed.length === 1 ? "match" : "matches"} loaded in this browser.`;
    elements.predict.disabled = false;
    elements.result.hidden = true;
  } catch (error) {
    elements.dataError.textContent = error.message;
    elements.dataError.hidden = false;
    elements.file.value = "";
  }
}

function downloadTemplate() {
  const content = `${CSV_COLUMNS.join(",")}\r\n`;
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "dota-match-history-template.csv";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function parseSide(prefix) {
  const team = document.querySelector(`#${prefix}-team`).value.trim();
  const players = splitNames(document.querySelector(`#${prefix}-players`).value);
  const heroes = splitNames(document.querySelector(`#${prefix}-heroes`).value);
  const sideName = prefix === "radiant" ? "Radiant" : "Dire";
  if (!team) throw new Error(`${sideName} team name is required.`);
  if (players.length !== 5 || new Set(players.map(normalize)).size !== 5) {
    throw new Error(`${sideName} must have five distinct player names.`);
  }
  if (heroes.length !== 5 || new Set(heroes.map(normalize)).size !== 5) {
    throw new Error(`${sideName} must have five distinct drafted heroes.`);
  }
  return { team: normalize(team), players: players.map(normalize), heroes: heroes.map(normalize) };
}

function entityRates() {
  const totals = {
    overall: { wins: 0, games: 0 },
    team: new Map(),
    player: new Map(),
    hero: new Map(),
    pair: new Map(),
  };
  const add = (map, key, win) => {
    const record = map.get(key) || { wins: 0, games: 0 };
    record.games += 1;
    if (win) record.wins += 1;
    map.set(key, record);
  };

  for (const match of history) {
    totals.overall.games += 1;
    if (match.radiantWin) totals.overall.wins += 1;

    for (const [side, didWin] of [
      [{ team: match.radiantTeam, players: match.radiantPlayers, heroes: match.radiantHeroes }, match.radiantWin],
      [{ team: match.direTeam, players: match.direPlayers, heroes: match.direHeroes }, !match.radiantWin],
    ]) {
      add(totals.team, side.team, didWin);
      for (const player of side.players) add(totals.player, player, didWin);
      for (const hero of side.heroes) add(totals.hero, hero, didWin);
    }

    for (const radiantHero of match.radiantHeroes) {
      for (const direHero of match.direHeroes) {
        add(totals.pair, `${radiantHero}\u0000${direHero}`, match.radiantWin);
      }
    }
  }
  return totals;
}

function smoothedRate(record, priorRate, priorGames) {
  if (!record) return priorRate;
  return (record.wins + priorRate * priorGames) / (record.games + priorGames);
}

function logit(probability) {
  const safe = Math.min(0.999, Math.max(0.001, probability));
  return Math.log(safe / (1 - safe));
}

function averageEntityEffect(names, records, baseline, priorGames) {
  const effects = names.map((name) => {
    const record = records.get(name);
    return logit(smoothedRate(record, baseline, priorGames)) - logit(baseline);
  });
  return effects.reduce((sum, effect) => sum + effect, 0) / effects.length;
}

function predict(radiant, dire) {
  const stats = entityRates();
  const baseline = stats.overall.wins / stats.overall.games;
  const entityBaseline = 0.5;
  const sideScore = (side) => {
    const teamEffect = averageEntityEffect([side.team], stats.team, entityBaseline, PRIOR_MATCHES);
    const playerEffect = averageEntityEffect(side.players, stats.player, entityBaseline, PRIOR_MATCHES);
    const heroEffect = averageEntityEffect(side.heroes, stats.hero, entityBaseline, PRIOR_MATCHES);
    return {
      total: 0.35 * teamEffect + 0.35 * playerEffect + 0.3 * heroEffect,
      teamEffect,
      playerEffect,
      heroEffect,
    };
  };
  const radiantScore = sideScore(radiant);
  const direScore = sideScore(dire);
  let matchupEffect = 0;
  let matchupSupport = 0;
  for (const radiantHero of radiant.heroes) {
    for (const direHero of dire.heroes) {
      const pair = stats.pair.get(`${radiantHero}\u0000${direHero}`);
      if (!pair) continue;
      const rate = smoothedRate(pair, baseline, PRIOR_PAIR_MATCHES);
      matchupEffect += logit(rate) - logit(baseline);
      matchupSupport += pair.games;
    }
  }
  matchupEffect /= radiant.heroes.length * dire.heroes.length;
  const probability = Math.min(MAX_PROBABILITY, Math.max(MIN_PROBABILITY,
    1 / (1 + Math.exp(-(logit(baseline) + radiantScore.total - direScore.total + matchupEffect)))));

  const countKnown = (names, records) => names.reduce((count, name) => count + (records.has(name) ? 1 : 0), 0);
  return {
    probability,
    baseline,
    teamCoverage: `${Number(stats.team.has(radiant.team)) + Number(stats.team.has(dire.team))}/2 teams`,
    playerCoverage: `${countKnown(radiant.players, stats.player) + countKnown(dire.players, stats.player)}/10 players`,
    heroCoverage: `${countKnown(radiant.heroes, stats.hero) + countKnown(dire.heroes, stats.hero)}/10 heroes`,
    matchupSupport,
  };
}

function showPrediction(event) {
  event.preventDefault();
  elements.formError.hidden = true;
  try {
    const radiant = parseSide("radiant");
    const dire = parseSide("dire");
    const estimate = predict(radiant, dire);
    const radiantPercent = Math.round(estimate.probability * 100);
    const direPercent = 100 - radiantPercent;

    document.querySelector("#result-radiant-name").textContent = radiant.team;
    document.querySelector("#result-dire-name").textContent = dire.team;
    document.querySelector("#radiant-probability").textContent = `${radiantPercent}%`;
    document.querySelector("#dire-probability").textContent = `${direPercent}%`;
    document.querySelector("#radiant-bar").style.width = `${radiantPercent}%`;
    document.querySelector("#dire-bar").style.width = `${direPercent}%`;
    document.querySelector(".probability-track").setAttribute(
      "aria-label",
      `Radiant ${radiantPercent} percent, Dire ${direPercent} percent`,
    );
    elements.evidence.replaceChildren(
      evidenceItem("Historical matches", history.length.toLocaleString()),
      evidenceItem("Teams in history", estimate.teamCoverage),
      evidenceItem("Players in history", estimate.playerCoverage),
      evidenceItem("Heroes in history", estimate.heroCoverage),
      evidenceItem("Hero matchup observations", estimate.matchupSupport.toLocaleString()),
      evidenceItem("Dataset Radiant win rate", `${Math.round(estimate.baseline * 100)}%`),
    );
    elements.result.hidden = false;
    elements.result.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    elements.formError.textContent = error.message;
    elements.formError.hidden = false;
  }
}

function evidenceItem(label, value) {
  const item = document.createElement("div");
  item.className = "evidence-item";
  const title = document.createElement("span");
  title.textContent = label;
  const detail = document.createElement("strong");
  detail.textContent = value;
  item.append(title, detail);
  return item;
}
