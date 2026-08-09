// BUILD-VIGILANCE.MJS — relève la vigilance météo Météo-France et la publie
// en JSON compact par département, pour js/vigilance.js de Bulletin (dépôt
// `bulletin`, privé — c'est pour ça que ce pipeline vit ici, dans un dépôt
// public dédié aux données : raw.githubusercontent.com ne sert que le public).
//
// POURQUOI CE DÉTOUR : aucune source officielle de vigilance temps réel n'est
// lisible depuis un navigateur. Le portail API de Météo-France exige une clé
// (inexposable dans une app statique), et MeteoAlarm — l'agrégateur européen
// EUMETNET qui rediffuse la vigilance officielle en format CAP, sans clé —
// n'envoie pas d'en-tête CORS (vérifié le 2026-08-08). Ce script tourne donc
// dans une GitHub Action planifiée (.github/workflows/vigilance.yml) et pousse
// son résultat sur la branche `vigilance-data` de ce dépôt, servie par
// raw.githubusercontent.com qui, lui, est CORS-ouvert. Zéro serveur, zéro clé.
//
// Usage : node scripts/build-vigilance.mjs <fichier-sortie.json>
// Sans réseau exploitable, le script sort en erreur : le workflow échoue et la
// branche garde la dernière donnée valide — l'app juge sa fraîcheur via
// `generatedAt`.

const FEED_URL = "https://feeds.meteoalarm.org/api/v1/warnings/feeds-france";

// Départements de métropole, du nom (tel que MeteoAlarm l'écrit, parfois sans
// tiret : « Hautes Alpes ») vers le code INSEE que renvoie geo.api.gouv.fr.
// L'appariement passe par normalize() : minuscules, sans accents ni
// ponctuation — les deux graphies retombent sur la même clé.
const DEPARTEMENTS = {
  "01": "Ain", "02": "Aisne", "03": "Allier", "04": "Alpes-de-Haute-Provence",
  "05": "Hautes-Alpes", "06": "Alpes-Maritimes", "07": "Ardèche",
  "08": "Ardennes", "09": "Ariège", "10": "Aube", "11": "Aude",
  "12": "Aveyron", "13": "Bouches-du-Rhône", "14": "Calvados", "15": "Cantal",
  "16": "Charente", "17": "Charente-Maritime", "18": "Cher", "19": "Corrèze",
  "2A": "Corse-du-Sud", "2B": "Haute-Corse", "21": "Côte-d'Or",
  "22": "Côtes-d'Armor", "23": "Creuse", "24": "Dordogne", "25": "Doubs",
  "26": "Drôme", "27": "Eure", "28": "Eure-et-Loir", "29": "Finistère",
  "30": "Gard", "31": "Haute-Garonne", "32": "Gers", "33": "Gironde",
  "34": "Hérault", "35": "Ille-et-Vilaine", "36": "Indre",
  "37": "Indre-et-Loire", "38": "Isère", "39": "Jura", "40": "Landes",
  "41": "Loir-et-Cher", "42": "Loire", "43": "Haute-Loire",
  "44": "Loire-Atlantique", "45": "Loiret", "46": "Lot", "47": "Lot-et-Garonne",
  "48": "Lozère", "49": "Maine-et-Loire", "50": "Manche", "51": "Marne",
  "52": "Haute-Marne", "53": "Mayenne", "54": "Meurthe-et-Moselle",
  "55": "Meuse", "56": "Morbihan", "57": "Moselle", "58": "Nièvre",
  "59": "Nord", "60": "Oise", "61": "Orne", "62": "Pas-de-Calais",
  "63": "Puy-de-Dôme", "64": "Pyrénées-Atlantiques", "65": "Hautes-Pyrénées",
  "66": "Pyrénées-Orientales", "67": "Bas-Rhin", "68": "Haut-Rhin",
  "69": "Rhône", "70": "Haute-Saône", "71": "Saône-et-Loire", "72": "Sarthe",
  "73": "Savoie", "74": "Haute-Savoie", "75": "Paris", "76": "Seine-Maritime",
  "77": "Seine-et-Marne", "78": "Yvelines", "79": "Deux-Sèvres", "80": "Somme",
  "81": "Tarn", "82": "Tarn-et-Garonne", "83": "Var", "84": "Vaucluse",
  "85": "Vendée", "86": "Vienne", "87": "Haute-Vienne", "88": "Vosges",
  "89": "Yonne", "90": "Territoire de Belfort", "91": "Essonne",
  "92": "Hauts-de-Seine", "93": "Seine-Saint-Denis", "94": "Val-de-Marne",
  "95": "Val-d'Oise",
};

// Libellés de repli par type CAP, si le champ `event` français changeait de
// forme. Nomenclature awareness_type de MeteoAlarm.
const TYPE_LABELS = {
  1: "vent violent", 2: "neige-verglas", 3: "orages", 4: "brouillard",
  5: "canicule", 6: "grand froid", 7: "vagues-submersion", 8: "feux de forêt",
  9: "avalanches", 10: "pluie", 12: "inondations", 13: "pluie-inondation",
};

const COLOR_NAMES = { 2: "jaune", 3: "orange", 4: "rouge" };

function normalize(name) {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z]/g, "");
}

const CODE_BY_NORMALIZED = new Map(
  Object.entries(DEPARTEMENTS).map(([code, nom]) => [normalize(nom), code]));

function param(info, name) {
  const p = (info.parameter || []).find((x) => x.valueName === name);
  return p ? p.value : "";
}

// « Vigilance orange canicule » -> « canicule ». Repli sur la table des types
// si la forme du champ change.
function phenomenonLabel(info, typeNum) {
  const m = /^vigilance\s+\S+\s+(.+)$/i.exec((info.event || "").trim());
  if (m) return m[1].toLowerCase();
  return TYPE_LABELS[typeNum] || "phénomène météo";
}

async function main() {
  const outPath = process.argv[2];
  if (!outPath) {
    console.error("usage : node scripts/build-vigilance.mjs <sortie.json>");
    process.exit(2);
  }

  const res = await fetch(FEED_URL, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`MeteoAlarm a répondu ${res.status}`);
  const feed = await res.json();
  if (!Array.isArray(feed.warnings)) throw new Error("flux MeteoAlarm inattendu");

  // Le flux traîne plusieurs jours d'alertes périmées et des bulletins verts :
  // on ne garde que le réel (status Actual), en cours ou à venir, jaune ou
  // plus. L'app n'affiche que orange/rouge ; publier aussi le jaune coûte
  // quelques centaines d'octets et évite de re-déployer le pipeline si
  // l'affichage change d'avis.
  const now = Date.now();
  const entries = []; // { code, type, label, level, onset, expires }
  const unknownAreas = new Set();
  for (const w of feed.warnings) {
    const alert = w.alert || {};
    if (alert.status !== "Actual" || alert.msgType === "Cancel") continue;
    const info = (alert.info || []).find((i) => (i.language || "").startsWith("fr"));
    if (!info) continue;

    const level = parseInt(param(info, "awareness_level"), 10);
    if (!(level >= 2)) continue;
    const expires = Date.parse(info.expires);
    if (!(expires > now)) continue;
    const typeNum = parseInt(param(info, "awareness_type"), 10);
    const onset = Date.parse(info.onset) || now;

    for (const area of info.area || []) {
      const code = CODE_BY_NORMALIZED.get(normalize(area.areaDesc || ""));
      if (!code) { unknownAreas.add(area.areaDesc); continue; }
      entries.push({ code, type: typeNum, label: phenomenonLabel(info, typeNum),
        level, onset, expires });
    }
  }
  // Andorre et d'éventuels nouveaux libellés : signalés dans le journal du
  // workflow, jamais bloquants.
  if (unknownAreas.size) {
    console.warn("zones ignorées (hors table) :", [...unknownAreas].join(", "));
  }

  // La vigilance sort en tranches J et J+1 : deux entrées contiguës de même
  // département, même phénomène et même niveau se lisent comme une seule
  // période (« canicule orange jusqu'à dimanche minuit »).
  const byKey = new Map();
  for (const e of entries.sort((a, b) => a.onset - b.onset)) {
    const key = e.code + "|" + e.type + "|" + e.level;
    const prev = byKey.get(key);
    if (prev && e.onset - prev.expires <= 3600000) {
      prev.expires = Math.max(prev.expires, e.expires);
    } else if (prev) {
      byKey.set(key + "|" + e.onset, e); // périodes disjointes : deux entrées
    } else {
      byKey.set(key, e);
    }
  }

  const byDept = {};
  for (const e of byKey.values()) {
    (byDept[e.code] = byDept[e.code] || []).push({
      phenomene: e.label,
      niveau: e.level,
      couleur: COLOR_NAMES[e.level] || String(e.level),
      debut: new Date(e.onset).toISOString(),
      fin: new Date(e.expires).toISOString(),
    });
  }
  for (const list of Object.values(byDept)) {
    list.sort((a, b) => b.niveau - a.niveau || a.debut.localeCompare(b.debut));
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: "Vigilance Météo-France, rediffusée par MeteoAlarm (EUMETNET)",
    byDept,
  };
  const { writeFileSync } = await import("node:fs");
  writeFileSync(outPath, JSON.stringify(out), "utf8");
  const oranges = Object.values(byDept).flat().filter((e) => e.niveau >= 3).length;
  console.log(`écrit ${outPath} : ${Object.keys(byDept).length} départements, ${oranges} entrée(s) orange/rouge`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
