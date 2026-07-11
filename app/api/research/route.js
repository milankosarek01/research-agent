// Serverová API route – běží jen na serveru (Vercel), takže API klíč
// nikdy neopustí server a uživatel v prohlížeči ho nevidí.

// Vercel: povolíme funkci běžet až 60 sekund (odpověď AI může chvíli trvat)
export const maxDuration = 60;

// `system` prompt – říká modelu, jakou má roli a jak se má chovat.
// Ve Fázi 3 se z tohoto místa stane agent "Rešeršista".
const SYSTEM_PROMPT = `Jsi pomocný asistent pro rešerše. Odpovídej česky,
stručně a přehledně. Pokud si nejsi jistý, řekni to.`;

export async function POST(request) {
  // 1) Přečteme dotaz, který poslal prohlížeč
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

  // 2) Zavoláme Claude API přímo přes HTTP (fetch) – žádný wrapper
  const odpoved = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Klíč se čte z proměnné prostředí – lokálně z .env.local, na Vercelu z nastavení projektu
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      // Levnější a rychlý model z rodiny Sonnet (aktuální název ověřen v dokumentaci Anthropic)
      model: "claude-sonnet-5",
      max_tokens: 4096,
      // `system` – instrukce pro model (role, jazyk, styl)
      system: SYSTEM_PROMPT,
      // `messages` – historie konverzace; zatím jen jedna zpráva od uživatele
      messages: [{ role: "user", content: dotaz }],
    }),
  });

  if (!odpoved.ok) {
    const chyba = await odpoved.json().catch(() => null);
    return Response.json(
      { error: chyba?.error?.message || `Claude API vrátilo chybu ${odpoved.status}.` },
      { status: 500 }
    );
  }

  // 3) Z odpovědi vytáhneme textové bloky a pošleme je zpět do prohlížeče
  const data = await odpoved.json();
  const text = data.content
    .filter((blok) => blok.type === "text")
    .map((blok) => blok.text)
    .join("");

  return Response.json({ text });
}
