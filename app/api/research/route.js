// Serverová API route – běží jen na serveru (Vercel), takže API klíč
// nikdy neopustí server a uživatel v prohlížeči ho nevidí.

import fs from "node:fs";
import path from "node:path";

// Vercel: agent s vyhledáváním potřebuje víc času než obyčejná odpověď
export const maxDuration = 120;

// FÁZE 4: máme DVA agenty a mezi nimi PŘEDÁNÍ (handoff).
//   1) Rešeršista – hledá na webu a hodnotí zdroje. Sám se ve smyčce rozhodne,
//      kdy má dost zdrojů, a nástrojem "predej_shrnovaci" je předá dál.
//   2) Shrnovač   – dostane nasbírané zdroje a napíše finální strukturovaný souhrn.
// FÁZE 5: Shrnovač si do svého system promptu načítá pravidla ze souboru SKILL.md.

// ---------- AGENT 1: REŠERŠISTA ----------

const SYSTEM_PROMPT_RESERSISTA = `Jsi Rešeršista – agent, který sbírá podklady na webu.

Postupuj takto:
1. Nástrojem web_search si najdi aktuální informace k dotazu.
   Máš NEJVÝŠE 4 vyhledávání – každé použij na jinak formulovaný dotaz,
   nikdy neopakuj stejný. Obvykle stačí 2–3 hledání, pak přestaň hledat.
2. Každý důležitý zdroj, ze kterého čerpáš, ohodnoť nástrojem ohodnot_zdroj.
3. Až budeš mít dost podkladů, NIKDY nepiš souhrn jako běžný text. Tvým
   ÚPLNĚ POSLEDNÍM krokem je VŽDY volání nástroje predej_shrnovaci, do kterého
   předáš všechny nasbírané zdroje (název, URL, hodnocení důvěryhodnosti
   a nejdůležitější fakta z každého zdroje).
   Tím práci předáš druhému agentovi (Shrnovači), který napíše finální souhrn.

Sám se rozhoduješ, kdy hledat dál a kdy už máš dost. Pokud narazíš na limit
vyhledávání, rovnou předej to, co máš – nikdy neodpovídej, že rešerši nelze
dokončit, a nepokládej uživateli otázky.`;

const TOOLS_RESERSISTA = [
  // 1) web_search – SERVEROVÝ nástroj: vyhledávání provádí přímo Anthropic,
  //    my nic neimplementujeme. max_uses omezuje počet hledání (a tím i cenu).
  {
    type: "web_search_20250305",
    name: "web_search",
    max_uses: 4,
  },
  // 2) ohodnot_zdroj – NÁŠ VLASTNÍ nástroj: model si o něj řekne, kód spouštíme my.
  {
    name: "ohodnot_zdroj",
    description:
      "Ohodnotí důvěryhodnost webového zdroje podle jeho domény. " +
      "Zavolej pro každý důležitý zdroj, ze kterého čerpáš.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL adresa zdroje" },
      },
      required: ["url"],
    },
  },
  // 3) predej_shrnovaci – VLASTNÍ nástroj pro PŘEDÁNÍ práce druhému agentovi.
  //    Když ho model zavolá, smyčka Rešeršisty končí a jeho vstup (zdroje)
  //    pošleme Shrnovači. Tohle je viditelný handoff v kódu.
  {
    name: "predej_shrnovaci",
    description:
      "Předá nasbírané zdroje agentovi Shrnovači, který napíše finální souhrn. " +
      "Zavolej, až budeš mít dost podkladů. Poté už nic dalšího nedělej.",
    input_schema: {
      type: "object",
      properties: {
        zdroje: {
          type: "array",
          description: "Seznam nasbíraných zdrojů, ze kterých se má napsat souhrn.",
          items: {
            type: "object",
            properties: {
              nazev: { type: "string", description: "Název / titulek zdroje" },
              url: { type: "string", description: "URL adresa zdroje" },
              duveryhodnost: {
                type: "string",
                description: "Hodnocení z nástroje ohodnot_zdroj (vysoká/střední/nízká)",
              },
              fakta: {
                type: "string",
                description: "Nejdůležitější fakta z tohoto zdroje k tématu",
              },
            },
            required: ["nazev", "url", "fakta"],
          },
        },
      },
      required: ["zdroje"],
    },
  },
];

// ---------- AGENT 2: SHRNOVAČ ----------

// Základ system promptu Shrnovače. Pravidla pro formát doplníme ze SKILL.md níže.
const SHRNOVAC_ZAKLAD = `Jsi Shrnovač – agent, který z předaných zdrojů napíše
finální shrnutí pro uživatele. Zdroje ti předal Rešeršista, ty už na web nechodíš.
Řiď se přesně následujícími pravidly formátu.`;

// FÁZE 5: načteme obsah SKILL.md a vložíme ho do system promptu Shrnovače.
// Tím se pravidla ze skillu reálně dostanou do promptu agenta a projeví se na výstupu.
function nactiSkill() {
  try {
    const cesta = path.join(process.cwd(), "SKILL.md");
    return fs.readFileSync(cesta, "utf8");
  } catch {
    // Kdyby soubor chyběl, radši pokračuj bez pádu – jen bez extra pravidel.
    return "";
  }
}

// Implementace našeho nástroje ohodnot_zdroj: jednoduché hodnocení podle domény.
function ohodnotZdroj(url) {
  let domena;
  try {
    domena = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return JSON.stringify({
      hodnoceni: "neznámá",
      duvod: "Neplatná URL adresa.",
    });
  }

  const vysoke = [
    "wikipedia.org", "czso.cz", "europa.eu", "nature.com",
    "sciencedirect.com", "who.int", "oecd.org", "worldbank.org",
  ];
  const stredni = [
    "reuters.com", "apnews.com", "bbc.com", "ct24.ceskatelevize.cz",
    "ceskatelevize.cz", "irozhlas.cz", "idnes.cz", "seznamzpravy.cz",
    "aktualne.cz", "hn.cz", "denikn.cz", "forbes.cz", "e15.cz",
  ];
  const nizke = [
    "reddit.com", "facebook.com", "x.com", "twitter.com",
    "medium.com", "quora.com", "tiktok.com", "instagram.com",
  ];

  const konciNa = (seznam) =>
    seznam.some((d) => domena === d || domena.endsWith("." + d));

  let hodnoceni, duvod;
  if (konciNa(vysoke) || domena.endsWith(".gov") || domena.endsWith(".edu") || domena.endsWith(".gov.cz")) {
    hodnoceni = "vysoká";
    duvod = "Oficiální, akademický nebo encyklopedický zdroj.";
  } else if (konciNa(stredni)) {
    hodnoceni = "střední";
    duvod = "Zavedené zpravodajské médium – informace bývají redakčně ověřované.";
  } else if (konciNa(nizke)) {
    hodnoceni = "nízká";
    duvod = "Sociální síť, fórum nebo blog – obsah není redakčně ověřovaný.";
  } else {
    hodnoceni = "střední (neověřeno)";
    duvod = `Doménu ${domena} neznám – ber informace s rezervou.`;
  }

  return JSON.stringify({ domena, hodnoceni, duvod });
}

// Jedno volání Claude API přes fetch (bez wrapperu, jako v minulých fázích).
// system a tools předáváme jako parametry, protože každý agent má svoje.
async function zavolejClaude(messages, system, tools) {
  const telo = {
    model: "claude-sonnet-5",
    max_tokens: 8000,
    system,
    messages,
  };
  if (tools) telo.tools = tools;

  const odpoved = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(telo),
  });

  if (!odpoved.ok) {
    const chyba = await odpoved.json().catch(() => null);
    throw new Error(
      chyba?.error?.message || `Claude API vrátilo chybu ${odpoved.status}.`
    );
  }
  return odpoved.json();
}

// ---------- AGENT 2 (Shrnovač) jako samostatná funkce ----------
// Dostane zdroje nasbírané Rešeršistou a vrátí finální souhrn (text).
async function spustShrnovace(dotaz, podklady) {
  const system = SHRNOVAC_ZAKLAD + "\n\n" + nactiSkill();

  const vstup =
    `Uživatel se ptal: "${dotaz}".\n\n` +
    `Rešeršista ti předal tyto podklady:\n` +
    podklady +
    `\n\nNapiš finální shrnutí podle pravidel formátu.`;

  const data = await zavolejClaude(
    [{ role: "user", content: vstup }],
    system,
    null // Shrnovač už žádné nástroje nepotřebuje
  );

  return data.content
    .filter((blok) => blok.type === "text")
    .map((blok) => blok.text)
    .join("");
}

export async function POST(request) {
  const { dotaz } = await request.json();

  if (!dotaz || !dotaz.trim()) {
    return Response.json({ error: "Chybí dotaz." }, { status: 400 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "Na serveru chybí API klíč (ANTHROPIC_API_KEY)." },
      { status: 500 }
    );
  }

  // Historie konverzace mezi námi a Rešeršistou – začíná dotazem uživatele
  const messages = [{ role: "user", content: dotaz }];
  // Záznam kroků agentů – pošleme ho do prohlížeče, ať je práce vidět
  const kroky = [];
  // Kolik zdrojů Rešeršista ohodnotil – použijeme v hlášce o předání
  let pocetZdroju = 0;
  // ID bloků, které jsme už zapsali – po pause_turn může API vrátit i části,
  // které už jsme viděli, a nechceme kroky počítat dvakrát
  const zapsaneBloky = new Set();

  try {
    // ===== AGENTNÍ SMYČKA REŠERŠISTY =====
    // Točíme se, dokud Rešeršista nepředá práci (predej_shrnovaci) – max 10 kol.
    for (let kolo = 0; kolo < 10; kolo++) {
      const data = await zavolejClaude(
        messages,
        SYSTEM_PROMPT_RESERSISTA,
        TOOLS_RESERSISTA
      );

      // Projdeme obsah odpovědi a zapíšeme, co agent právě udělal
      for (const blok of data.content) {
        const idBloku = blok.id || blok.tool_use_id;
        if (idBloku) {
          if (zapsaneBloky.has(idBloku)) continue;
          zapsaneBloky.add(idBloku);
        }
        if (blok.type === "server_tool_use" && blok.name === "web_search") {
          kroky.push(`🔍 Hledám na webu: „${blok.input.query}“`);
        }
        if (blok.type === "web_search_tool_result" && Array.isArray(blok.content)) {
          kroky.push(`📄 Nalezeno ${blok.content.length} výsledků`);
        }
        if (blok.type === "tool_use" && blok.name === "ohodnot_zdroj") {
          pocetZdroju++;
          kroky.push(`⚖️ Hodnotím zdroj: ${blok.input.url}`);
        }
      }

      // Rešeršista o něco žádá přes nástroj(e)?
      if (data.stop_reason === "tool_use") {
        // ===== PŘEDÁNÍ (HANDOFF) mezi agenty =====
        // Pokud mezi žádostmi je predej_shrnovaci, končíme s Rešeršistou
        // a spustíme druhého agenta – Shrnovače.
        const predani = data.content.find(
          (blok) => blok.type === "tool_use" && blok.name === "predej_shrnovaci"
        );
        if (predani) {
          const zdroje = predani.input.zdroje || [];
          kroky.push(
            `🤝 Rešeršista našel ${zdroje.length} zdrojů → předávám Shrnovači`
          );

          // Druhý agent napíše finální souhrn z předaných zdrojů
          const text = await spustShrnovace(dotaz, JSON.stringify(zdroje, null, 2));
          kroky.push("✍️ Shrnovač napsal finální souhrn");
          return Response.json({ text, kroky });
        }

        // Jinak jde o náš nástroj ohodnot_zdroj – spustíme a pošleme výsledek zpět
        messages.push({ role: "assistant", content: data.content });

        const vysledkyNastroju = data.content
          .filter((blok) => blok.type === "tool_use")
          .map((blok) => ({
            type: "tool_result",
            tool_use_id: blok.id,
            content:
              blok.name === "ohodnot_zdroj"
                ? ohodnotZdroj(blok.input.url)
                : "Neznámý nástroj.",
          }));

        messages.push({ role: "user", content: vysledkyNastroju });
        continue; // další kolo smyčky
      }

      // Serverové vyhledávání se přerušilo v půlce → pošleme dál, ať pokračuje
      if (data.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: data.content });
        continue;
      }

      // Rešeršista skončil, aniž by zavolal predej_shrnovaci (model občas
      // rovnou napíše text). I tak práci PŘEDÁME Shrnovači – aby byl handoff
      // vždy vidět a finální souhrn vždy prošel pravidly ze SKILL.md.
      const podklady = data.content
        .filter((blok) => blok.type === "text")
        .map((blok) => blok.text)
        .join("");

      kroky.push(
        `🤝 Rešeršista našel ${pocetZdroju} zdrojů → předávám Shrnovači`
      );
      const text = await spustShrnovace(dotaz, podklady);
      kroky.push("✍️ Shrnovač napsal finální souhrn");
      return Response.json({ text, kroky });
    }

    // Sem se dostaneme jen kdyby se agent zacyklil (10 kol bez konce)
    return Response.json(
      { error: "Rešerše trvala příliš dlouho, zkus dotaz zjednodušit.", kroky },
      { status: 500 }
    );
  } catch (e) {
    return Response.json({ error: e.message, kroky }, { status: 500 });
  }
}
