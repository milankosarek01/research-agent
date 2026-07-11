"use client";

import { useState } from "react";
import styles from "./page.module.css";

export default function Home() {
  // Text, který uživatel napíše do pole
  const [dotaz, setDotaz] = useState("");
  // Výsledek rešerše (odpověď od Claude)
  const [vysledek, setVysledek] = useState("");
  // Kroky, které agent při rešerši udělal (hledání, hodnocení zdrojů…)
  const [kroky, setKroky] = useState([]);
  // Případná chyba (např. chybějící klíč, výpadek API)
  const [chyba, setChyba] = useState("");
  // Informace o tom, že aplikace pracuje
  const [pracuje, setPracuje] = useState(false);

  async function spustitReserzi() {
    if (!dotaz.trim()) return;
    setPracuje(true);
    setVysledek("");
    setKroky([]);
    setChyba("");

    try {
      // Zavoláme naši serverovou routu – ta teprve mluví s Claude API
      // (klíč tak zůstává schovaný na serveru)
      const odpoved = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dotaz }),
      });

      const data = await odpoved.json();

      if (!odpoved.ok) {
        setChyba(data.error || "Něco se pokazilo, zkus to prosím znovu.");
      } else {
        setVysledek(data.text);
        setKroky(data.kroky || []);
      }
    } catch {
      setChyba("Nepodařilo se spojit se serverem. Zkus to prosím znovu.");
    } finally {
      setPracuje(false);
    }
  }

  return (
    <main className={styles.main}>
      <h1 className={styles.nadpis}>AI Rešeršista</h1>
      <p className={styles.popis}>
        Zadej téma nebo otázku. Aplikace prohledá web a připraví strukturované
        shrnutí.
      </p>

      <div className={styles.formular}>
        <input
          className={styles.pole}
          type="text"
          value={dotaz}
          onChange={(e) => setDotaz(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && spustitReserzi()}
          placeholder="Např. Jaké jsou trendy v elektromobilitě v roce 2026?"
        />
        <button
          className={styles.tlacitko}
          onClick={spustitReserzi}
          disabled={pracuje || !dotaz.trim()}
        >
          {pracuje ? "Pracuji…" : "Spustit rešerši"}
        </button>
      </div>

      {pracuje && (
        <p className={styles.popis}>
          Agent prohledává web a hodnotí zdroje, může to trvat i minutu…
        </p>
      )}

      {kroky.length > 0 && (
        <div className={styles.kroky}>
          <h2>Jak agent postupoval</h2>
          <ol>
            {kroky.map((krok, i) => (
              <li key={i}>{krok}</li>
            ))}
          </ol>
        </div>
      )}

      {chyba && (
        <div className={styles.vysledek}>
          <h2>Chyba</h2>
          <p>{chyba}</p>
        </div>
      )}

      {vysledek && (
        <div className={styles.vysledek}>
          <h2>Výsledek</h2>
          <p style={{ whiteSpace: "pre-wrap" }}>{vysledek}</p>
        </div>
      )}
    </main>
  );
}
