"use client";

import { useState } from "react";
import styles from "./page.module.css";

export default function Home() {
  // Text, který uživatel napíše do pole
  const [dotaz, setDotaz] = useState("");
  // Výsledek rešerše (zatím jen ukázkový text, napojení na Claude přijde ve Fázi 2)
  const [vysledek, setVysledek] = useState("");
  // Informace o tom, že aplikace pracuje
  const [pracuje, setPracuje] = useState(false);

  async function spustitReserzi() {
    if (!dotaz.trim()) return;
    setPracuje(true);
    setVysledek("");

    // Zatím jen simulace – ve Fázi 2 sem přijde volání serveru s Claude API
    setTimeout(() => {
      setVysledek(
        `Zatím jen kostra aplikace. Tady se ve Fázi 2 objeví odpověď na dotaz: „${dotaz}“`
      );
      setPracuje(false);
    }, 500);
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

      {vysledek && (
        <div className={styles.vysledek}>
          <h2>Výsledek</h2>
          <p>{vysledek}</p>
        </div>
      )}
    </main>
  );
}
