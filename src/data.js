import seedCsv from "./data/matches.csv?raw";

const STORAGE_KEY = "avengers-battle-imports-v1";
const PRIMARY_GUILD = "Avengers";

export const importColumns = [
  "match_id",
  "date",
  "location",
  "title",
  "primary_guild",
  "participants_shown",
  "participants_reported",
  "source_document",
  "rank",
  "player_name",
  "guild",
  "team",
  "kills",
  "assists",
  "damage",
  "damage_taken",
  "healing",
  "loadout"
];

function csvRows(text) {
  const firstLine = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  const delimiter = firstLine.includes(";") ? ";" : ",";
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\"") {
      if (quoted && text[index + 1] === "\"") {
        cell += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some((value) => value.trim())) rows.push(row);
  }
  return rows;
}

function cleanHeader(value) {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase();
}

function integer(value, label, rowNumber) {
  const parsed = Number(String(value).replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(parsed)) throw new Error(`Строка ${rowNumber}: поле ${label} должно быть числом.`);
  return Math.round(parsed);
}

export function parseMatchCsv(text, fallbackSource = "uploaded.csv") {
  const rows = csvRows(text);
  if (rows.length < 2) throw new Error("Файл импорта пуст или не содержит строк игроков.");
  const headers = rows[0].map(cleanHeader);
  const missing = importColumns.filter((field) => !headers.includes(field));
  if (missing.length) throw new Error(`Не хватает колонок: ${missing.join(", ")}.`);
  const position = Object.fromEntries(headers.map((field, index) => [field, index]));
  const grouped = new Map();

  rows.slice(1).forEach((values, rowIndex) => {
    const read = (field) => (values[position[field]] ?? "").trim();
    const rowNumber = rowIndex + 2;
    const id = read("match_id");
    const playerName = read("player_name");
    const loadout = read("loadout");
    if (!id || !playerName || !loadout) {
      throw new Error(`Строка ${rowNumber}: обязательны match_id, player_name и loadout.`);
    }
    if (!grouped.has(id)) {
      grouped.set(id, {
        id,
        title: read("title"),
        location: read("location"),
        date: read("date"),
        primaryGuild: read("primary_guild") || PRIMARY_GUILD,
        participantsShown: integer(read("participants_shown"), "participants_shown", rowNumber),
        participantsReported: integer(read("participants_reported"), "participants_reported", rowNumber),
        sourceDocuments: new Set(),
        players: []
      });
    }
    const game = grouped.get(id);
    game.sourceDocuments.add(read("source_document") || fallbackSource);
    game.players.push({
      rank: integer(read("rank"), "rank", rowNumber),
      name: playerName,
      guild: read("guild"),
      team: read("team"),
      kills: integer(read("kills"), "kills", rowNumber),
      assists: integer(read("assists"), "assists", rowNumber),
      damage: integer(read("damage"), "damage", rowNumber),
      taken: integer(read("damage_taken"), "damage_taken", rowNumber),
      healing: integer(read("healing"), "healing", rowNumber),
      loadout
    });
  });

  return [...grouped.values()].map((game) => {
    const ranks = new Set(game.players.map((player) => player.rank));
    if (ranks.size !== game.players.length) throw new Error(`${game.id}: в файле повторяются ранги.`);
    if (game.players.length !== game.participantsShown) {
      throw new Error(`${game.id}: строк игроков ${game.players.length}, но participants_shown=${game.participantsShown}.`);
    }
    return { ...game, sourceDocuments: [...game.sourceDocuments] };
  });
}

function mergeMatches(...collections) {
  const result = new Map();
  collections.flat().forEach((game) => result.set(game.id, game));
  return [...result.values()];
}

function savedMatches() {
  if (typeof localStorage === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

const seededMatches = parseMatchCsv(seedCsv, "src/data/matches.csv");
export const matches = mergeMatches(seededMatches, savedMatches());
export const match = matches[matches.length - 1];

export function storeImportedMatches(imported) {
  if (typeof localStorage === "undefined") return;
  const stored = mergeMatches(savedMatches(), imported);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

export function clearImportedMatches() {
  if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_KEY);
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[;"\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

export function exportMatchesCsv(games = matches) {
  const rows = games.flatMap((game) => game.players.map((player) => [
    game.id, game.date, game.location, game.title, game.primaryGuild,
    game.participantsShown, game.participantsReported, game.sourceDocuments.join(", "),
    player.rank, player.name, player.guild, player.team ?? "", player.kills,
    player.assists, player.damage, player.taken, player.healing, player.loadout
  ]));
  return "\uFEFF" + [importColumns, ...rows]
    .map((row) => row.map(csvEscape).join(";"))
    .join("\r\n") + "\r\n";
}

export function isAvenger(player) {
  return player.guild === PRIMARY_GUILD;
}

export function totals(players) {
  return players.reduce(
    (sum, player) => ({
      players: sum.players + 1,
      kills: sum.kills + player.kills,
      assists: sum.assists + player.assists,
      damage: sum.damage + player.damage,
      taken: sum.taken + player.taken,
      healing: sum.healing + player.healing
    }),
    { players: 0, kills: 0, assists: 0, damage: 0, taken: 0, healing: 0 }
  );
}

export function guildBreakdown(game = match) {
  return Object.entries(
    game.players.reduce((groups, player) => {
      groups[player.guild] ??= [];
      groups[player.guild].push(player);
      return groups;
    }, {})
  )
    .map(([guild, players]) => ({ guild, ...totals(players) }))
    .sort((a, b) => b.players - a.players);
}
