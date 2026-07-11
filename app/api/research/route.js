// Serverová API route – běží jen na serveru (Vercel), takže API klíč
// nikdy neopustí server a uživatel v prohlížeči ho nevidí.

// Vercel: agent s vyhledáváním potřebuje víc času než obyčejná odpověď
export const maxDuration = 120;

// FÁZE 3: z jednoduchého asistenta se stal AGENT "Rešeršista".
// Agent = model, který má k dispozici NÁSTROJE a sám se rozhoduje,
// kdy a jak je použít. Jeho práci řídíme ve smyčce ve funkci POST níže.

const SYSTEM_PROMPT = `Jsi Rešeršista – agent, který dělá rešerše na webu.

Postupuj takto:
1. Nástrojem web_search si najdi aktuální informace k dotazu
   (klidně několika hledáními s různě formulovanými dotazy).
2. Každý důležitý zdroj, ze kterého čerpáš, ohodnoť nástrojem ohodnot_zdroj.
3. Nakonec napiš česky strukturované shrnutí:
   - krátký úvod (1–2 věty),
   - hlavní zjištění v odrážkách,
   - na konci sekci "Zdroje" – u každého zdroje uveď název, URL
     a jeho důvěryhodnost podle hodnocení z nástroje.

Piš věcně a stručně. Pokud si nejsi jistý nebo se zdroje rozcházejí, řekni to.`;

// Nástroje, které agent dostane k dispozici:
const TOOLS = [
  // 1) web_search – SERVEROVÝ nástroj: vyhledávání provádí přímo Anthropic,
  //    my nic neimplementujeme. max_uses omezuje počet hledání (a tím i cenu).
  {
    type: "web_search_20260209",
    name: "web_search",
    max_uses: 5,
  },
  // 2) ohodnot_zdroj – NÁŠ VLASTNÍ nástroj: model si o něj řekne,
  //    ale kód spouštíme my (funkce ohodnotZdroj níže).
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
];

// Implementace našeho nástroje: jednoduché hodnocení podle domény.
// (Pro case study stačí heuristika – ukazuje princip vlastního nástroje.)
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
async function zavolejClaude(messages) {
  const odpoved = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    }),
  });

  if (!odpoved.ok) {
    const chyba = await odpoved.json().catch(() => null);
    throw new Error(
      chyba?.error?.message || `Claude API vrátilo chybu ${odpoved.status}.`
    );
  }
  return odpoved.json();
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

  // Historie konverzace mezi námi a agentem – začíná dotazem uživatele
  const messages = [{ role: "user", content: dotaz }];
  // Záznam kroků agenta – pošleme ho do prohlížeče, ať je práce agenta vidět
  const kroky = [];

  try {
    // ===== AGENTNÍ SMYČKA =====
    // Točíme se, dokud agent nepřestane volat nástroje (max 10 kol pro jistotu).
    for (let kolo = 0; kolo < 10; kolo++) {
      const data = await zavolejClaude(messages);

      // Projdeme obsah odpovědi a zapíšeme, co agent právě udělal
      for (const blok of data.content) {
        if (blok.type === "server_tool_use" && blok.name === "web_search") {
          kroky.push(`🔍 Hledám na webu: „${blok.input.query}“`);
        }
        if (blok.type === "web_search_tool_result" && Array.isArray(blok.content)) {
          kroky.push(`📄 Nalezeno ${blok.content.length} výsledků`);
        }
        if (blok.type === "tool_use" && blok.name === "ohodnot_zdroj") {
          kroky.push(`⚖️ Hodnotím zdroj: ${blok.input.url}`);
        }
      }

      // a) Agent volá NÁŠ nástroj → spustíme ho a výsledek pošleme zpět
      if (data.stop_reason === "tool_use") {
        // Odpověď agenta (včetně žádostí o nástroje) patří do historie
        messages.push({ role: "assistant", content: data.content });

        // Spustíme každý požadovaný nástroj a posbíráme výsledky
        const vysledkyNastroju = data.content
          .filter((blok) => blok.type === "tool_use")
          .map((blok) => ({
            type: "tool_result",
            tool_use_id: blok.id, // musí sedět s ID žádosti
            content:
              blok.name === "ohodnot_zdroj"
                ? ohodnotZdroj(blok.input.url)
                : "Neznámý nástroj.",
          }));

        // Výsledky nástrojů se posílají jako zpráva od uživatele
        messages.push({ role: "user", content: vysledkyNastroju });
        continue; // další kolo smyčky
      }

      // b) Serverové vyhledávání se přerušilo v půlce → pošleme dál, ať pokračuje
      if (data.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: data.content });
        continue;
      }

      // c) Agent skončil → vytáhneme finální text a vrátíme ho
      const text = data.content
        .filter((blok) => blok.type === "text")
        .map((blok) => blok.text)
        .join("");

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
