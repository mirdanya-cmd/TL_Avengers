import { clearImportedMatches, exportMatchesCsv, importColumns, isAvenger, matches, parseMatchCsv, storeImportedMatches, totals } from "./data.js";

const app = document.querySelector("#app");
const fmt = new Intl.NumberFormat("ru-RU");
const roles = ["Урон", "Поддержка", "Фронтлайн"];
const analysisWindow = 10;

function matchTimestamp(game) {
  const [day, month, year] = game.date.split(".").map(Number);
  return Number.isFinite(year) ? Date.UTC(year, month - 1, day) : 0;
}

const orderedMatches = [...matches].sort((first, second) => matchTimestamp(first) - matchTimestamp(second));
const latestMatch = orderedMatches[orderedMatches.length - 1];
const avengers = latestMatch.players.filter(isAvenger);
const opponents = latestMatch.players.filter((player) => !isAvenger(player));
const allLoadouts = [...new Set(orderedMatches.flatMap((game) => game.players.map((player) => player.loadout)).filter(Boolean))].sort();
const recentMatches = orderedMatches.slice(-analysisWindow);
const recentAvengers = recentMatches.flatMap((game) => game.players.filter(isAvenger));
const recentOpponents = recentMatches.flatMap((game) => game.players.filter((player) => !isAvenger(player)));
const recentAvengersTotals = totals(recentAvengers);
const recentOpponentsTotals = totals(recentOpponents);

function number(value) {
  return fmt.format(value).replace(/\u00a0/g, " ");
}

function compact(value) {
  return Math.abs(value) >= 1_000_000
    ? `${(value / 1_000_000).toFixed(2).replace(".", ",")} млн`
    : number(value);
}

function decimal(value) {
  return value.toFixed(1).replace(".", ",");
}

function delta(a, b) {
  const value = a - b;
  return `${value > 0 ? "+" : ""}${number(value)}`;
}

function plural(value, one, few, many) {
  const end = Math.abs(value) % 100;
  const digit = end % 10;
  if (end > 10 && end < 20) return many;
  if (digit === 1) return one;
  if (digit > 1 && digit < 5) return few;
  return many;
}

function kills(value) {
  return `${number(value)} ${plural(value, "килл", "килла", "киллов")}`;
}

function role(player) {
  if (player.loadout === "Щит + Двурук") return "Фронтлайн";
  if (player.loadout.includes("Ванда")) return "Поддержка";
  return "Урон";
}

function ratingPool(player) {
  const side = isAvenger(player) ? avengers : opponents;
  return side.filter((item) => role(item) === role(player));
}

function percentile(player, field, pool = ratingPool(player)) {
  return pool.filter((item) => item[field] <= player[field]).length / pool.length;
}

function contribution(player, comparisonSide) {
  const pool = comparisonSide
    ? comparisonSide.filter((item) => role(item) === role(player))
    : ratingPool(player);
  const metrics = role(player) === "Поддержка"
    ? [["healing", 1]]
    : role(player) === "Фронтлайн"
      ? [["taken", 0.5], ["kills", 0.3], ["damage", 0.2]]
      : [["kills", 0.65], ["damage", 0.25], ["assists", 0.1]];
  return Math.round(metrics.reduce((score, [field, weight]) => score + percentile(player, field, pool) * weight, 0) * 100);
}

function playerWithAnalytics(player, comparisonSide) {
  return { ...player, role: role(player), score: contribution(player, comparisonSide) };
}

function mean(players, field) {
  return players.reduce((sum, player) => sum + player[field], 0) / players.length;
}

function roleAverageMetrics(roleName) {
  return roleName === "Поддержка"
    ? [["avgHealing", 1]]
    : roleName === "Фронтлайн"
      ? [["avgTaken", 0.5], ["avgKills", 0.3], ["avgDamage", 0.2]]
      : [["avgKills", 0.65], ["avgDamage", 0.25], ["avgAssists", 0.1]];
}

function rollingPlayers() {
  const entries = new Map();
  recentMatches.forEach((game) => {
    game.players.filter(isAvenger).forEach((player) => {
      const key = `${player.name}|${player.loadout}`;
      const current = entries.get(key) ?? { seed: player, games: [] };
      current.games.push(player);
      entries.set(key, current);
    });
  });

  const rollups = [...entries.values()].map(({ seed, games }) => {
    const sum = totals(games);
    return {
      ...seed,
      role: role(seed),
      gamesPlayed: games.length,
      avgKills: sum.kills / games.length,
      avgAssists: sum.assists / games.length,
      avgDamage: sum.damage / games.length,
      avgTaken: sum.taken / games.length,
      avgHealing: sum.healing / games.length
    };
  });

  const grouped = rollups.reduce((groups, player) => {
    groups[player.loadout] ??= [];
    groups[player.loadout].push(player);
    return groups;
  }, {});

  Object.values(grouped).forEach((classPlayers) => {
    const metrics = roleAverageMetrics(classPlayers[0].role);
    const baselines = Object.fromEntries(metrics.map(([field]) => [field, mean(classPlayers, field)]));
    classPlayers.forEach((player) => {
      player.classIndex = Math.round(metrics.reduce((score, [field, weight]) => {
        const baseline = baselines[field] || 1;
        return score + (player[field] / baseline) * weight;
      }, 0) * 100);
    });
    const topIndex = Math.max(...classPlayers.map((player) => player.classIndex));
    classPlayers.forEach((player) => {
      player.vsTop = Math.round(player.classIndex / topIndex * 100);
      player.vsAverage = player.classIndex - 100;
      player.classPlayers = classPlayers.length;
    });
  });

  return rollups;
}

const ownRollingAnalytics = rollingPlayers();

function signPercent(value) {
  return `${value > 0 ? "+" : ""}${value}%`;
}

function weaponIcon(weapon) {
  const paths = {
    "Кинжал": '<path d="M13 2 9 13l2 2 4-11zM8 12l4 4M7 16l-2 2"/>',
    "Копье": '<path d="M14 2 11 7l2 2zM12 8 4 18M6 16l2 2"/>',
    "Лук": '<path d="M7 3c7 4 7 10 0 15M7 3c-3 5-3 10 0 15M7 3v15"/>',
    "Стаф": '<path d="M12 2v16M9 5h6M10 3h4M9 18h6"/>',
    "Арбалет": '<path d="M3 7h16M6 4c3 5 9 5 12 0M11 7v11M8 15h6"/>',
    "Двурук": '<path d="M15 2 7 13l2 2L18 5zM6 12l5 5M5 16l3 3"/>',
    "Щит": '<path d="M11 2 17 5v5c0 4-3 7-6 9-3-2-6-5-6-9V5z"/>',
    "Ванда": '<path d="M14 3 6 18M14 3l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"/>'
  };
  return `<svg class="weapon-icon" viewBox="0 0 22 22" aria-label="${weapon}">${paths[weapon] ?? ""}</svg>`;
}

function loadoutIcons(loadout) {
  return `<span class="weapon-pair">${loadout.split(" + ").map(weaponIcon).join("")}</span>`;
}

function attentionSignal(player) {
  if (player.classPlayers < 2) return { label: "Нет сравнения", tone: "neutral" };
  if (player.vsAverage <= -20) return { label: "Разобрать", tone: "risk" };
  if (player.vsAverage <= -8) return { label: "Ниже среднего", tone: "watch" };
  if (player.vsTop >= 95) return { label: "Ориентир", tone: "strong" };
  return { label: "В норме", tone: "steady" };
}

function relativeBar(value) {
  const width = Math.max(4, Math.min(100, value));
  const tone = value < 70 ? "risk" : value < 88 ? "watch" : "strong";
  return `<div class="relative-track"><i class="${tone}" style="width:${width}%"></i></div>`;
}

function evaluationClassGroups() {
  return Object.values(
    ownRollingAnalytics.reduce((groups, player) => {
      groups[player.loadout] ??= { loadout: player.loadout, role: player.role, players: [] };
      groups[player.loadout].players.push(player);
      return groups;
    }, {})
  )
    .map((group) => ({
      ...group,
      avgKills: mean(group.players, "avgKills"),
      avgHealing: mean(group.players, "avgHealing"),
      avgDamage: mean(group.players, "avgDamage"),
      totalAvgKills: group.players.reduce((sum, player) => sum + player.avgKills, 0),
      reviewCount: group.players.filter((player) => attentionSignal(player).tone === "risk").length
    }))
    .sort((a, b) => b.players.length - a.players.length || a.loadout.localeCompare(b.loadout, "ru"));
}

function evaluationRow(player) {
  const signal = attentionSignal(player);
  return `
    <tr class="evaluation-row ${signal.tone}">
      <td class="profile-cell">
        <a class="player-link" href="${linkPlayer(player)}">${player.name}</a>
        <small>${player.loadout}</small>
        <small>${player.gamesPlayed}/${analysisWindow} матчей</small>
      </td>
      <td class="benchmark-cell">
        <strong class="${player.vsAverage < 0 ? "negative-value" : "positive-value"}">${signPercent(player.vsAverage)} ср.</strong>
        <small>${player.vsTop}% от топ-1</small>
        ${relativeBar(player.vsTop)}
      </td>
      <td><span class="signal ${signal.tone}">${signal.label}</span></td>
      <td><span class="role ${player.role}">${player.role}</span></td>
      <td>${decimal(player.avgKills)}</td>
      <td>${number(Math.round(player.avgAssists))}</td>
      <td>${compact(Math.round(player.avgDamage))}</td>
      <td>${compact(Math.round(player.avgTaken))}</td>
      <td>${compact(Math.round(player.avgHealing))}</td>
      <td><strong class="class-index">${player.classIndex}</strong></td>
    </tr>`;
}

function reviewCandidates(players) {
  const comparable = players.filter((player) => player.classPlayers > 1);
  const candidates = [...comparable].sort((a, b) => a.vsAverage - b.vsAverage).slice(0, 4);
  if (!candidates.length) {
    return `<p class="empty-review">В выбранном классе нет группы для сравнения. Нужны минимум два игрока одного класса.</p>`;
  }
  return candidates.map((player) => {
    const signal = attentionSignal(player);
    return `<a class="review-card ${signal.tone}" href="${linkPlayer(player)}">
      <div>${loadoutIcons(player.loadout)}<span class="signal ${signal.tone}">${signal.label}</span></div>
      <strong>${player.name}</strong>
      <small>${player.loadout}</small>
      <b>${signPercent(player.vsAverage)} к среднему · ${player.vsTop}% от топа</b>
    </a>`;
  }).join("");
}

function analyticsSortValue(player, key) {
  if (key === "name") return player.name.toLocaleLowerCase("ru");
  if (key === "role") return player.role;
  if (key === "signal") {
    const rank = { risk: 0, watch: 1, steady: 2, strong: 3, neutral: 4 };
    return rank[attentionSignal(player).tone] ?? 4;
  }
  return player[key];
}

function sortableHeading(key, label) {
  return `<th data-sort-column="${key}"><button type="button" class="table-sort" data-sort="${key}">${label}<span class="sort-marker" aria-hidden="true"></span></button></th>`;
}

function classBreakdown(players) {
  return Object.values(
    players.reduce((groups, player) => {
      const key = player.loadout;
      groups[key] ??= { loadout: key, role: role(player), players: [] };
      groups[key].players.push(player);
      return groups;
    }, {})
  )
    .map((group) => {
      const sum = totals(group.players);
      return {
        ...group,
        ...sum,
        avgKills: sum.kills / sum.players,
        avgDamage: sum.damage / sum.players,
        avgHealing: sum.healing / sum.players
      };
    })
    .sort((a, b) => b.avgDamage + b.avgHealing - (a.avgDamage + a.avgHealing));
}

function linkPlayer(player) {
  return `#/player/${encodeURIComponent(player.name)}/${encodeURIComponent(player.loadout)}`;
}

function layout(content, section) {
  return `
    <div class="shell">
      <aside class="sidebar">
        <a class="brand" href="#/overview">
          <span class="brand-mark">A</span>
          <span><strong>AVENGERS</strong><small>Battle Intelligence</small></span>
        </a>
        <nav class="nav">
          <a class="${section === "overview" ? "active" : ""}" href="#/overview">Обзор</a>
          <a class="${section === "match" ? "active" : ""}" href="#/matches">Матчи</a>
          <a class="${section === "players" ? "active" : ""}" href="#/players">Игроки</a>
          <a class="${section === "analytics" ? "active" : ""}" href="#/analytics">Аналитика</a>
          <a class="${section === "imports" ? "active" : ""}" href="#/imports">Импорт</a>
        </nav>
        <div class="sidebar-foot">
          <span class="status-dot"></span><p>Матчей загружено: ${matches.length}</p>
          <strong>${recentMatches.length}/${analysisWindow}</strong>
          <small>боев в окне аналитики</small>
        </div>
      </aside>
      <main class="content ${section === "match" ? "match-content" : ""}">${content}</main>
    </div>
  `;
}

function header(kicker, title, detail, compactHeader = false, featuredGame = latestMatch, showMatchPill = true) {
  return `
    <header class="page-header ${compactHeader ? "compact-header" : ""}">
      <div>
        <p class="kicker">${kicker}</p>
        <h1>${title}</h1>
        <p class="subhead">${detail}</p>
      </div>
      ${showMatchPill ? `<a class="match-pill" href="#/match/${featuredGame.id}">
        <small>${featuredGame.date}</small><strong>${featuredGame.location}</strong><span>Открыть матч</span>
      </a>` : ""}
    </header>
  `;
}

function metric(label, own, rival, formatter = compact, invert = false) {
  const diff = own - rival;
  const positive = invert ? diff < 0 : diff > 0;
  return `
    <article class="metric">
      <p>${label}</p>
      <div class="metric-values"><strong>${formatter(own)}</strong><span>vs</span><strong class="enemy">${formatter(rival)}</strong></div>
      <small class="${positive ? "positive" : "negative"}">${delta(own, rival)} разница</small>
    </article>
  `;
}

function gameContext(game) {
  const home = game.players.filter(isAvenger);
  const away = game.players.filter((player) => !isAvenger(player));
  const rivalGroups = away.reduce((groups, player) => {
    groups[player.guild] ??= [];
    groups[player.guild].push(player);
    return groups;
  }, {});
  const opponent = Object.entries(rivalGroups)
    .map(([guild, players]) => ({ guild, players }))
    .sort((a, b) => b.players.length - a.players.length)[0];
  return {
    home,
    away,
    homeTotals: totals(home),
    awayTotals: totals(away),
    opponentLabel: opponent?.guild ?? "Соперники"
  };
}

function overview() {
  const topAvengers = [...ownRollingAnalytics].sort((a, b) => b.avgKills - a.avgKills).slice(0, 6);
  const rowsShown = recentMatches.reduce((sum, game) => sum + game.participantsShown, 0);
  const rowsReported = recentMatches.reduce((sum, game) => sum + game.participantsReported, 0);
  const supportLeader = [...ownRollingAnalytics].filter((player) => player.role === "Поддержка").sort((a, b) => b.classIndex - a.classIndex)[0];
  const battleRows = [...orderedMatches].reverse().map((game) => {
    const own = totals(game.players.filter(isAvenger));
    const rival = totals(game.players.filter((player) => !isAvenger(player)));
    return `
      <a class="match-row" href="#/match/${game.id}">
        <div><strong>${game.title}</strong><small>${game.date} · ${game.location} · ${game.participantsShown}/${game.participantsReported} строк</small></div>
        <span><small>Avengers</small><b>${kills(own.kills)} / ${compact(own.damage)} урона</b></span>
        <span><small>Остальные стороны</small><b>${kills(rival.kills)} / ${compact(rival.damage)} урона</b></span>
        <em>${delta(own.kills, rival.kills)} киллов</em>
      </a>`;
  }).join("");
  return layout(`
    ${header("Guild battle command center", "Статистика Avengers", `Суммарные результаты и сигналы по последним ${recentMatches.length} из ${analysisWindow} боев.`)}
    <section class="coverage"><strong>Покрытие окна: ${rowsShown} из ${rowsReported} строк</strong><span>${recentMatches.length}/${analysisWindow} боев в расчете; отсутствующие в источниках строки не входят в показатели.</span></section>
    <section class="scoreboard">
      <div class="team team-home"><small>Наша гильдия · ${recentMatches.length} боя</small><h2>Avengers</h2><strong>${number(recentAvengersTotals.kills)}</strong><span>киллов / ${recentAvengersTotals.players} участий</span></div>
      <div class="battle-delta"><span>Разница киллов</span><strong>${delta(recentAvengersTotals.kills, recentOpponentsTotals.kills)}</strong><small>по окну анализа</small></div>
      <div class="team team-away"><small>Все противники · ${recentMatches.length} боя</small><h2>Соперники</h2><strong>${number(recentOpponentsTotals.kills)}</strong><span>киллов / ${recentOpponentsTotals.players} участий</span></div>
    </section>
    <section class="metrics-grid">
      ${metric("Урон", recentAvengersTotals.damage, recentOpponentsTotals.damage)}
      ${metric("Помощь", recentAvengersTotals.assists, recentOpponentsTotals.assists, number)}
      ${metric("Полученный урон", recentAvengersTotals.taken, recentOpponentsTotals.taken, compact, true)}
      ${metric("Лечение", recentAvengersTotals.healing, recentOpponentsTotals.healing)}
    </section>
    <section class="panel matches-panel">
      <div class="panel-head"><h2>Матчи</h2><span class="soft">${recentMatches.length} последних входят в расчет</span></div>
      <div class="matches-list">${battleRows}</div>
    </section>
    <div class="two-column">
      <section class="panel">
        <div class="panel-head"><h2>Лучшие профили по средним киллам</h2><a href="#/players">Вся гильдия</a></div>
        <div class="leaders">${topAvengers.map((player, index) => `
          <a class="leader" href="${linkPlayer(player)}">
            <span class="rank">#${index + 1}</span><div><strong>${player.name}</strong><small>${player.loadout} · ${player.gamesPlayed}/${analysisWindow} боев</small></div><b>${decimal(player.avgKills)} ср.</b>
          </a>`).join("")}</div>
      </section>
      <section class="panel insight-panel">
        <div class="panel-head"><h2>Сигналы командиру</h2><a href="#/analytics">Разбор</a></div>
        <p><strong>Поддержка:</strong> ${supportLeader ? `${supportLeader.name} лидирует среди загруженных профилей класса.` : "в окне нет размеченных игроков поддержки."}</p>
        <p><strong>Фронтлайн:</strong> щитовые пары надо оценивать по удержанию давления, не по киллам.</p>
        <p><strong>Важно:</strong> рейтинг использует ${recentMatches.length}/${analysisWindow} доступных боев; надежность оценки растет по мере заполнения окна.</p>
      </section>
    </div>`, "overview");
}

function tableRow(player, includeGuild = false, comparisonSide) {
  const analytic = playerWithAnalytics(player, comparisonSide);
  return `
    <tr>
      <td class="mono">#${player.rank}</td>
      <td><a class="player-link" href="${linkPlayer(player)}">${player.name}</a></td>
      ${includeGuild ? `<td><span class="guild-tag ${isAvenger(player) ? "ours" : ""}">${player.guild}</span></td>` : ""}
      <td class="loadout">${player.loadout}</td>
      <td><span class="role ${analytic.role}">${analytic.role}</span></td>
      <td class="accent">${number(player.kills)}</td>
      <td>${number(player.assists)}</td>
      <td>${compact(player.damage)}</td>
      <td>${compact(player.healing)}</td>
      <td><strong class="score">${analytic.score}</strong></td>
    </tr>`;
}

function filterControls(idPrefix, withSort = false) {
  return `
    <div class="controls">
      <input id="${idPrefix}-search" type="search" placeholder="Имя игрока" />
      <select id="${idPrefix}-class" aria-label="Фильтр класса"><option value="">Все классы</option>${allLoadouts.map((item) => `<option value="${item}">${item}</option>`).join("")}</select>
      <select id="${idPrefix}-role" aria-label="Фильтр роли"><option value="">Все роли</option>${roles.map((item) => `<option value="${item}">${item}</option>`).join("")}</select>
      ${withSort ? `<select id="${idPrefix}-sort" aria-label="Сортировка"><option value="classIndex">По индексу</option><option value="avgKills">По средним киллам</option><option value="avgDamage">По среднему урону</option><option value="avgHealing">По среднему лечению</option></select>` : ""}
    </div>`;
}

function comparisonTable(title, players, className) {
  return `
    <section class="duel-column ${className}">
      <div class="duel-heading"><h2>${title}</h2><span>${players.length} игроков</span></div>
      <div class="table-scroll duel-scroll"><table class="duel-table">
        <thead><tr><th>#</th><th>Игрок</th><th>Класс</th><th>Роль</th><th>Киллы</th><th>Урон</th><th>Хил</th><th>Индекс</th></tr></thead>
        <tbody>${players.map((player) => tableRow(player, false, players).replace("<td>" + number(player.assists) + "</td>", "")).join("")}</tbody>
      </table></div>
    </section>`;
}

function matchPage(game = latestMatch) {
  const context = gameContext(game);
  return layout(`
    ${header("Match report", game.title, `${game.location} · ${game.date} · ${game.participantsShown}/${game.participantsReported} строк`, true, game)}
    <section class="metrics-grid match-metrics">
      ${metric("Киллы", context.homeTotals.kills, context.awayTotals.kills, number)}
      ${metric("Урон", context.homeTotals.damage, context.awayTotals.damage)}
      ${metric("Помощь", context.homeTotals.assists, context.awayTotals.assists, number)}
      ${metric("Лечение", context.homeTotals.healing, context.awayTotals.healing)}
    </section>
    <section class="panel compare-panel">
      <div class="panel-head compare-head"><div><h2>Сравнение составов</h2><p>Обе стороны отсортированы по киллам. Индекс рассчитан внутри роли каждой стороны.</p></div>${filterControls("match")}</div>
      <div id="duel-tables" class="duel-tables">${comparisonTable("Avengers", context.home, "home")}${comparisonTable(`${context.opponentLabel} + союзники`, context.away, "away")}</div>
    </section>`, "match");
}

function matchesPage() {
  const gameRows = [...orderedMatches].reverse().map((game) => {
    const context = gameContext(game);
    return `
      <a class="match-row" href="#/match/${game.id}">
        <div><strong>${game.title}</strong><small>${game.date} · ${game.location} · ${game.participantsShown}/${game.participantsReported} строк</small></div>
        <span><small>Avengers</small><b>${kills(context.homeTotals.kills)} / ${compact(context.homeTotals.damage)} урона</b></span>
        <span><small>Соперники</small><b>${kills(context.awayTotals.kills)} / ${compact(context.awayTotals.damage)} урона</b></span>
        <em>Открыть</em>
      </a>`;
  }).join("");
  return layout(`
    ${header("Match library", "Выбор матча", "Выберите отдельный бой для сравнения составов. Сводные страницы используют окно последних десяти боев.", false, latestMatch, false)}
    <section class="coverage"><strong>${recentMatches.length}/${analysisWindow} боев входят в аналитику</strong><span>Отчет выбранного матча показывает только его собственные строки.</span></section>
    <section class="panel matches-panel">
      <div class="panel-head"><h2>Загруженные матчи</h2><span class="soft">${matches.length} всего</span></div>
      <div class="matches-list">${gameRows}</div>
    </section>`, "match");
}

function rosterRow(player) {
  const signal = attentionSignal(player);
  return `
    <tr class="${signal.tone}">
      <td class="profile-cell"><a class="player-link" href="${linkPlayer(player)}">${player.name}</a><small>${player.loadout}</small></td>
      <td><span class="role ${player.role}">${player.role}</span></td>
      <td>${player.gamesPlayed}/${analysisWindow}</td>
      <td class="accent">${decimal(player.avgKills)}</td>
      <td>${number(Math.round(player.avgAssists))}</td>
      <td>${compact(Math.round(player.avgDamage))}</td>
      <td>${compact(Math.round(player.avgHealing))}</td>
      <td class="benchmark-cell"><strong class="${player.vsAverage < 0 ? "negative-value" : "positive-value"}">${signPercent(player.vsAverage)}</strong><small>${player.vsTop}% от топ-1</small></td>
      <td><span class="signal ${signal.tone}">${signal.label}</span></td>
    </tr>`;
}

function rosterTable(players) {
  return `<div class="table-scroll roster-scroll"><table class="roster-table">
    <thead><tr><th>Игрок / класс</th><th>Роль</th><th>Боев</th><th>Киллы<br>ср.</th><th>Помощь<br>ср.</th><th>Урон<br>ср.</th><th>Хил<br>ср.</th><th>vs класс</th><th>Сигнал</th></tr></thead>
    <tbody id="roster-body">${players.map(rosterRow).join("")}</tbody>
  </table></div>`;
}

function playersPage() {
  return layout(`
    ${header("Roster", "Игроки Avengers", `Средние показатели и сравнение с классом по последним ${recentMatches.length} из ${analysisWindow} боев.`)}
    <section class="panel roster-panel">
      <div class="panel-head responsive"><div><h2>Профили игрок / класс</h2><p>При смене класса игрок выводится отдельной строкой, чтобы сравнение роли не смешивалось.</p></div>${filterControls("roster", true)}</div>
      ${rosterTable(ownRollingAnalytics)}
    </section>`, "players");
}

function analyticsPage() {
  const classGroups = evaluationClassGroups();
  const reviewCount = ownRollingAnalytics.filter((player) => attentionSignal(player).tone === "risk").length;
  return layout(`
    ${header("Guild master view", "Оценка игроков по роли", "Инструмент поиска слабого звена: сравнение каждого игрока с его классом оружия.")}
    <section class="analytics-summary">
      <article><small>Окно анализа</small><strong>${recentMatches.length}/${analysisWindow}</strong><span>матчей загружено</span></article>
      <article><small>Профилей игрок / класс</small><strong>${ownRollingAnalytics.length}</strong><span>смена класса считается отдельно</span></article>
      <article><small>Классов</small><strong>${classGroups.length}</strong><span>комбинаций оружия</span></article>
      <article class="${reviewCount ? "alert" : ""}"><small>Ниже нормы</small><strong>${reviewCount}</strong><span>индекс ниже среднего на 20%+</span></article>
    </section>
    <section class="coverage method analysis-method"><strong>Методика</strong><span>Средние рассчитаны по последним ${recentMatches.length} из ${analysisWindow} возможных варгеймов. Индекс = 100 на среднем игроке того же класса: ДД - киллы 65%, урон 25%, помощь 10%; поддержка - отхил 100%; фронтлайн - полученный урон 50%, киллы 30%, урон 20%. Смертей нет, поэтому вклад фронтлайна по полученному урону отражает принятую нагрузку, а не качество выживания.</span></section>
    <section class="panel analysis-workbench">
      <div class="panel-head responsive">
        <div><h2>Игроки относительно своего класса</h2><p>Выберите оружие и смотрите, кто отстает от ориентира класса.</p></div>
        <div class="controls">
          <input id="analysis-search" type="search" placeholder="Имя игрока" />
        </div>
      </div>
      <div id="analysis-classes" class="weapon-filters">
        <button type="button" class="weapon-filter active" data-loadout=""><strong>Все классы</strong><small>${ownRollingAnalytics.length} игроков</small></button>
        ${classGroups.map((item) => `<button type="button" class="weapon-filter" data-loadout="${item.loadout}">
          ${loadoutIcons(item.loadout)}<strong>${item.loadout}</strong><small>${item.players.length} игроков · ${item.avgKills.toFixed(1).replace(".", ",")} килла ср.</small>
        </button>`).join("")}
      </div>
      <div class="review-layout">
        <div class="evaluation-scroll"><table class="evaluation-table">
          <thead><tr>${sortableHeading("name", "Игрок / класс")}${sortableHeading("vsAverage", "vs среднее / топ-1")}${sortableHeading("signal", "Сигнал")}${sortableHeading("role", "Роль")}${sortableHeading("avgKills", "Киллы<br>ср.")}${sortableHeading("avgAssists", "Помощь<br>ср.")}${sortableHeading("avgDamage", "Урон<br>ср.")}${sortableHeading("avgTaken", "Получено<br>ср.")}${sortableHeading("avgHealing", "Отхил<br>ср.")}${sortableHeading("classIndex", "Индекс")}</tr></thead>
          <tbody id="evaluation-body"></tbody>
        </table></div>
        <aside class="review-panel"><div class="review-head"><h3>Кандидаты на разбор</h3><p>Минимальный относительный вклад в выбранной группе.</p></div><div id="review-candidates"></div></aside>
      </div>
    </section>
    <section class="panel analysis-table">
      <div class="panel-head"><h2>Сводка классов Avengers</h2><span class="soft">средние показатели текущего окна</span></div>
      <table><thead><tr><th>Класс</th><th>Роль</th><th>Игроков</th><th>Киллы / игрок</th><th>Урон / игрок</th><th>Хил / игрок</th><th>Киллы состава / матч</th></tr></thead>
        <tbody>${classGroups.map((item) => `<tr><td class="loadout">${loadoutIcons(item.loadout)} ${item.loadout}</td><td><span class="role ${item.role}">${item.role}</span></td><td>${item.players.length}</td><td>${item.avgKills.toFixed(1).replace(".", ",")}</td><td>${compact(Math.round(item.avgDamage))}</td><td>${compact(Math.round(item.avgHealing))}</td><td class="accent">${item.totalAvgKills.toFixed(1).replace(".", ",")}</td></tr>`).join("")}</tbody>
      </table>
    </section>
    <p class="analysis-note">В расчет включены ${recentMatches.length} из ${analysisWindow} целевых боев. По мере добавления импортов окно автоматически удерживает последние десять матчей.</p>`, "analytics");
}

function playerPage(name, selectedLoadout = "") {
  const appearances = recentMatches.map((game) => ({
    game,
    player: game.players.find((item) => item.name === name)
  })).filter((item) => item.player && (!selectedLoadout || item.player.loadout === selectedLoadout));
  if (!appearances.length) return notFound();
  const latest = appearances[appearances.length - 1];
  const player = latest.player;
  const classAppearances = appearances.filter((entry) => entry.player.loadout === player.loadout);
  const aggregate = totals(classAppearances.map((entry) => entry.player));
  const profile = ownRollingAnalytics.find((entry) => entry.name === name && entry.loadout === player.loadout);
  const analytic = profile ?? playerWithAnalytics(player, latest.game.players.filter((item) => isAvenger(item) === isAvenger(player)));
  return layout(`
    ${header(player.guild, player.name, `${player.loadout} · ${analytic.role} · ${classAppearances.length}/${analysisWindow} боев этим классом`)}
    <section class="profile-hero ${isAvenger(player) ? "" : "enemy-profile"}">
      <div><strong>${classAppearances.length}/${analysisWindow}</strong><p>Боёв этим классом</p></div>
      <div><strong>${profile ? signPercent(profile.vsAverage) : "—"}</strong><p>К среднему класса</p></div>
      <div><strong>${profile ? `${profile.vsTop}%` : "—"}</strong><p>От результата топ-1 класса</p></div>
    </section>
    <section class="metrics-grid">
      <article class="stat"><p>Киллы в среднем</p><strong>${decimal(aggregate.kills / classAppearances.length)}</strong></article>
      <article class="stat"><p>Помощь в среднем</p><strong>${decimal(aggregate.assists / classAppearances.length)}</strong></article>
      <article class="stat"><p>Урон в среднем</p><strong>${compact(Math.round(aggregate.damage / classAppearances.length))}</strong></article>
      <article class="stat"><p>Хил в среднем</p><strong>${compact(Math.round(aggregate.healing / classAppearances.length))}</strong></article>
    </section>
    <section class="panel history">
      <div class="panel-head"><h2>Матчи в окне анализа</h2><span class="soft">последние ${analysisWindow} боев</span></div>
      ${[...appearances].reverse().map(({ game, player: entry }) => `<a class="history-row" href="#/match/${game.id}"><div><strong>${game.title}</strong><small>${game.date} · ${game.location}</small></div><span>${kills(entry.kills)} / ${number(entry.assists)} помощи</span><span>${compact(entry.damage)} урона</span><b>Открыть</b></a>`).join("")}
    </section>`, isAvenger(player) ? "players" : "match");
}

function importsPage() {
  const visibleRows = matches.reduce((sum, game) => sum + game.participantsShown, 0);
  const absentRows = matches.reduce((sum, game) => sum + game.participantsReported - game.participantsShown, 0);
  return layout(`
    ${header("Data pipeline", "Проверка данных", "Опубликованную статистику обновляет Codex; здесь можно локально проверить CSV или Excel перед публикацией.")}
    <section class="panel upload-panel">
      <div>
        <p class="kicker">Локальный предпросмотр</p>
        <h2>Проверить таблицу матча</h2>
        <p class="upload-copy">Файл может содержать один или несколько варгеймов. Данные сохраняются только в этом браузере и не изменяют сайт для других участников.</p>
      </div>
      <label class="file-drop" for="import-file">
        <strong>CSV / XLSX</strong>
        <span>Выбрать размеченный файл</span>
        <input id="import-file" type="file" accept=".csv,.xlsx,.xls" />
      </label>
      <div class="import-actions">
        <button id="download-template" type="button">CSV-шаблон</button>
        <button id="export-database" type="button">Экспорт базы CSV</button>
        <button id="clear-local-imports" type="button" class="subtle">Сбросить предпросмотр</button>
      </div>
      <p id="import-feedback" class="import-feedback">Обязательные поля: <code>${importColumns.join("; ")}</code></p>
    </section>
    <section class="panel import-panel">
      <div class="import-summary"><div><strong>${matches.length}</strong><span>матча в базе</span></div><div><strong>${visibleRows}</strong><span>строк игроков</span></div><div><strong>${absentRows}</strong><span>строк не было в источнике</span></div><div><strong>${recentMatches.length}/${analysisWindow}</strong><span>окно аналитики</span></div></div>
      <h2>Опубликованные и локально проверяемые данные</h2>
      <div class="document-list">${[...orderedMatches].reverse().map((game) => `<article>
        <div><strong>${game.title}</strong><small>${game.date} · ${game.location} · ${game.participantsShown}/${game.participantsReported} строк</small></div>
        <span>${game.sourceDocuments.join(", ")}</span>
      </article>`).join("")}</div>
      <p class="notice">Чтобы данные увидели все участники, нужно обновить опубликованную базу <code>src/data/matches.csv</code> и выполнить публикацию сайта. Исходные изображения в интерфейс не загружаются.</p>
    </section>`, "imports");
}

function filterPlayers(players, prefix) {
  const search = document.querySelector(`#${prefix}-search`)?.value.trim().toLocaleLowerCase("ru") ?? "";
  const className = document.querySelector(`#${prefix}-class`)?.value ?? "";
  const roleName = document.querySelector(`#${prefix}-role`)?.value ?? "";
  return players.filter((player) => (!search || player.name.toLocaleLowerCase("ru").includes(search))
    && (!className || player.loadout === className)
    && (!roleName || role(player) === roleName));
}

function bindMatchFilters(game = latestMatch) {
  const controls = [...document.querySelectorAll("#match-search, #match-class, #match-role")];
  if (!controls.length) return;
  const context = gameContext(game);
  const renderTables = () => {
    document.querySelector("#duel-tables").innerHTML = comparisonTable("Avengers", filterPlayers(context.home, "match"), "home")
      + comparisonTable(`${context.opponentLabel} + союзники`, filterPlayers(context.away, "match"), "away");
  };
  controls.forEach((control) => control.addEventListener("input", renderTables));
}

function bindRosterFilters() {
  const controls = [...document.querySelectorAll("#roster-search, #roster-class, #roster-role, #roster-sort")];
  if (!controls.length) return;
  const renderRows = () => {
    const sort = document.querySelector("#roster-sort").value;
    const players = filterPlayers(ownRollingAnalytics, "roster").sort((a, b) => b[sort] - a[sort]);
    document.querySelector("#roster-body").innerHTML = players.map(rosterRow).join("");
  };
  controls.forEach((control) => control.addEventListener("input", renderRows));
  renderRows();
}

function bindAnalyticsFilters() {
  const tableBody = document.querySelector("#evaluation-body");
  const candidateList = document.querySelector("#review-candidates");
  const buttons = [...document.querySelectorAll(".weapon-filter")];
  const search = document.querySelector("#analysis-search");
  const sortButtons = [...document.querySelectorAll(".table-sort")];
  if (!tableBody || !candidateList || !buttons.length || !search || !sortButtons.length) return;

  let selectedLoadout = "";
  let sortKey = "classIndex";
  let sortDirection = "asc";
  const updateSortIndicators = () => {
    sortButtons.forEach((button) => {
      const active = button.dataset.sort === sortKey;
      button.classList.toggle("active", active);
      button.querySelector(".sort-marker").textContent = active ? (sortDirection === "asc" ? "↑" : "↓") : "";
      button.closest("th").setAttribute("aria-sort", active ? (sortDirection === "asc" ? "ascending" : "descending") : "none");
    });
  };
  const renderEvaluation = () => {
    const query = search.value.trim().toLocaleLowerCase("ru");
    const players = ownRollingAnalytics.filter((player) => (!selectedLoadout || player.loadout === selectedLoadout)
      && (!query || player.name.toLocaleLowerCase("ru").includes(query)));
    const sorted = [...players].sort((a, b) => {
      const left = analyticsSortValue(a, sortKey);
      const right = analyticsSortValue(b, sortKey);
      const comparison = typeof left === "string"
        ? left.localeCompare(right, "ru")
        : left - right;
      return (sortDirection === "asc" ? comparison : -comparison)
        || a.name.localeCompare(b.name, "ru");
    });
    tableBody.innerHTML = sorted.map(evaluationRow).join("");
    candidateList.innerHTML = reviewCandidates(players);
    updateSortIndicators();
  };

  buttons.forEach((button) => button.addEventListener("click", () => {
    selectedLoadout = button.dataset.loadout;
    buttons.forEach((item) => item.classList.toggle("active", item === button));
    renderEvaluation();
  }));
  search.addEventListener("input", renderEvaluation);
  sortButtons.forEach((button) => button.addEventListener("click", () => {
    const nextKey = button.dataset.sort;
    if (sortKey === nextKey) {
      sortDirection = sortDirection === "asc" ? "desc" : "asc";
    } else {
      sortKey = nextKey;
      sortDirection = ["name", "role", "signal"].includes(nextKey) ? "asc" : "desc";
    }
    renderEvaluation();
  }));
  renderEvaluation();
}

function downloadText(text, filename) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function fileToCsv(file) {
  if (file.name.toLowerCase().endsWith(".csv")) return file.text();
  const importedXlsx = await import("xlsx");
  const XLSX = importedXlsx.default ?? importedXlsx;
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_csv(sheet, { FS: ";", RS: "\r\n" });
}

function bindImportTools() {
  const input = document.querySelector("#import-file");
  const feedback = document.querySelector("#import-feedback");
  if (!input || !feedback) return;
  document.querySelector("#download-template").addEventListener("click", () => {
    downloadText(`\uFEFF${importColumns.join(";")}\r\n`, "wargame_import_template.csv");
  });
  document.querySelector("#export-database").addEventListener("click", () => {
    downloadText(exportMatchesCsv(), "guild_battle_database.csv");
  });
  document.querySelector("#clear-local-imports").addEventListener("click", () => {
    clearImportedMatches();
    location.reload();
  });
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    feedback.className = "import-feedback";
    feedback.textContent = "Проверяю файл...";
    try {
      const imported = parseMatchCsv(await fileToCsv(file), file.name);
      storeImportedMatches(imported);
      feedback.className = "import-feedback success";
      feedback.textContent = `Локально проверено матчей: ${imported.length}. Эти данные видны только в вашем браузере.`;
      location.hash = "#/analytics";
      location.reload();
    } catch (error) {
      feedback.className = "import-feedback error";
      feedback.textContent = error.message;
    }
  });
}

function notFound() {
  return layout(`<section class="empty"><h1>Страница не найдена</h1><a href="#/overview">Вернуться к обзору</a></section>`, "");
}

function render() {
  const route = location.hash.replace(/^#\//, "").split("/");
  const selectedMatch = matches.find((game) => game.id === route[1]) ?? latestMatch;
  if (route[0] === "match") app.innerHTML = matchPage(selectedMatch);
  else if (route[0] === "matches") app.innerHTML = matchesPage();
  else if (route[0] === "players") app.innerHTML = playersPage();
  else if (route[0] === "analytics") app.innerHTML = analyticsPage();
  else if (route[0] === "player") app.innerHTML = playerPage(decodeURIComponent(route[1] ?? ""), route[2] ? decodeURIComponent(route[2]) : "");
  else if (route[0] === "imports") app.innerHTML = importsPage();
  else app.innerHTML = overview();
  bindMatchFilters(selectedMatch);
  bindRosterFilters();
  bindAnalyticsFilters();
  bindImportTools();
}

window.addEventListener("hashchange", render);
render();
