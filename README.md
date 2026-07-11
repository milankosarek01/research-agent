# AI Rešeršista

Webová aplikace, která na zadané téma **autonomně prohledá web**, ohodnotí zdroje
a napíše z nich strukturované shrnutí. Hotové rešerše si ukládá do historie,
ke které se lze vracet.

- 🔗 **Živá aplikace:** https://research-agent-five-lyart.vercel.app
- 📁 **Zdrojový kód:** https://github.com/milankosarek01/research-agent

Projekt vznikl jako case study k pohovoru.

---

## Co aplikace dělá

1. Uživatel zadá téma nebo otázku (např. *„Jaké jsou trendy v elektromobilitě v roce 2026?"*).
2. Aplikace sama prohledá web, hodnotí důvěryhodnost zdrojů a rozhoduje se, kdy má dost podkladů.
3. Výsledkem je přehledné shrnutí (hlavní zjištění + seznam zdrojů s hodnocením).
4. Každá dokončená rešerše se uloží do **historie**, kterou lze znovu otevřít.

## Jak aplikaci použít

1. Otevři živou URL (viz výše).
2. Do pole napiš téma nebo otázku a klikni na **Spustit rešerši**.
3. Během práce vidíš kroky agenta (co hledá, jaké zdroje hodnotí, kdy předává práci dál).
4. Zobrazí se finální shrnutí. Najdeš ho i dole v sekci **Historie rešerší** –
   kliknutím na položku se k němu vrátíš.

---

## Architektura

- **Framework:** Next.js (App Router), nasazeno na **Vercelu** (automatický deploy při každém pushi na GitHub).
- **Frontend:** [`app/page.js`](app/page.js) – pole na dotaz, tlačítko, výpis kroků, výsledek a historie.
  Historie se ukládá do prohlížeče přes `localStorage`.
- **Backend (server):** [`app/api/research/route.js`](app/api/research/route.js) – serverová
  API route. Veškerá komunikace s Claude API běží **jen na serveru**, takže API klíč
  (`ANTHROPIC_API_KEY`) nikdy neopustí server a uživatel v prohlížeči ho nevidí.
- **Volání Claude API:** přímo přes `fetch` na `https://api.anthropic.com/v1/messages`,
  **bez wrapperů** (žádný LangChain). V těle požadavku je jasně vidět práce s `model`,
  `system` promptem, `messages` a `tools`.
- **Model:** `claude-sonnet-5` (rychlý a levnější model z rodiny Sonnet).

Tok dat:

```
Prohlížeč (page.js)
   │  POST /api/research  { dotaz }
   ▼
Server (route.js)  ──►  Claude API (fetch)
   │  { text, kroky }
   ▼
Prohlížeč: zobrazí výsledek + uloží do historie (localStorage)
```

## Jak funguje agent a smyčka

Aplikace používá **dva agenty** a mezi nimi viditelné předání práce (handoff):

### 1) Agent „Rešeršista"
Sbírá podklady na webu. Má **tři nástroje (tools)**:
- `web_search` – nativní serverový nástroj Claude API (vyhledávání provádí přímo Anthropic).
- `ohodnot_zdroj` – **vlastní** nástroj: podle domény ohodnotí důvěryhodnost zdroje
  (vysoká / střední / nízká).
- `predej_shrnovaci` – **vlastní** nástroj pro předání nasbíraných zdrojů druhému agentovi.

Běží v **opravdové agentní smyčce** (`for` cyklus v [`route.js`](app/api/research/route.js)):
v každém kole zavolá model a **model sám přes `tool_use` rozhoduje**, co dál – jestli
hledat, hodnotit zdroj, nebo že už má dost a předá práci. Není to natvrdo naprogramovaná
posloupnost „hledej → shrň".

### 2) Předání (handoff)
Když Rešeršista zavolá nástroj `predej_shrnovaci`, smyčka končí a jeho nasbírané zdroje
se předají Shrnovači. Handoff je vidět i uživateli jako krok:
**„🤝 Rešeršista našel 5 zdrojů → předávám Shrnovači".**

### 3) Agent „Shrnovač"
Dostane od Rešeršisty zdroje (už na web nechodí) a napíše finální strukturované shrnutí.

## Vlastní Skill

Soubor [`SKILL.md`](SKILL.md) obsahuje pravidla pro formát finálního shrnutí (nadpis, úvod,
hlavní zjištění, zdroje s hodnocením). Jeho obsah se v [`route.js`](app/api/research/route.js)
**reálně načítá do system promptu Shrnovače** (funkce `nactiSkill`), takže se pravidla
projeví přímo na výstupu – strukturu shrnutí lze v aplikaci ověřit.

---

## Spuštění lokálně

```bash
npm install
npm run dev
```

Do souboru `.env.local` je potřeba vložit API klíč:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Stejný klíč patří i do nastavení projektu ve Vercelu (Settings → Environment Variables).
Soubor `.env.local` je v `.gitignore`, takže se klíč nikdy nedostane na GitHub.

## Jak jsem používal Claude Code

Celá aplikace vznikala postupně **po fázích s pomocí Claude Code** (Anthropic CLI):
kostra a nasazení → napojení na Claude API → agent Rešeršista s nástroji → druhý agent
Shrnovač a handoff → vlastní Skill → historie → dokumentace. V každé fázi Claude Code
navrhl a upravil kód, vysvětlil git/Vercel kroky a změny se nasazovaly na Vercel.

## Poznámka k historii

Historie rešerší se ukládá do prohlížeče přes `localStorage`. Je to **záměrné
zjednodušení kvůli času** – bez databáze a přihlašování. Historie je proto vázaná
na konkrétní prohlížeč a zařízení. V produkční verzi by ji nahradila databáze s účty uživatelů.
