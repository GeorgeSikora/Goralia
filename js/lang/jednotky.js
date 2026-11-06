/*
 * Texty nových jednotek (kopiník, kušiník, zvěd, pekelný pes, nekromant, morovák)
 * a veteránů v angličtině a po našimu. Načítá se po js/lang/hrdinove.js.
 * Po našimu podle /mnt/project-files/i18n/ponaszymu-pravidla.md.
 */
(() => {
  const PK = window.PK;
  if (!PK || !PK.i18n) return;

  PK.i18n.add("en", {
    "Kopiník": "Spearman",
    "Kušiník": "Crossbowman",
    "Zvěd": "Scout",
    "Pekelný pes": "Hellhound",
    "Nekromant": "Necromancer",
    "Morovák": "Plaguebearer",
    "Kušiník (s kovárnou)": "Crossbowman (with smithy)",
    "Zvěd (ve stáji)": "Scout (at stable)",
    "Dlouhé kopí. Proti jezdcům, hrdinům a velkým zrůdám udeří skoro dvojnásob.":
      "A long spear. Hits riders, heroes and big monsters almost twice as hard.",
    "Pomalu nabíjí, ale šipka prorazí zbroj a bolí. Potřebuje kovárnu.":
      "Reloads slowly, but the bolt pierces armour and hurts. Needs a smithy.",
    "Nejrychlejší jezdec. Loví dělníky, střelce, mnichy a stroje v týlu.":
      "The fastest rider. Hunts workers, archers, monks and siege engines behind the lines.",
    "Cvičí vojáky, lučištníky, mnichy, kopiníky a kušiníky. Staví dělník (12 s).":
      "Trains soldiers, archers, monks, spearmen and crossbowmen. Built by a worker (12 s).",
    "Cvičí rytíře a zvědy. Potřebuje kasárna. Staví dělník (14 s).":
      "Trains knights and scouts. Needs barracks. Built by a worker (14 s).",
    "Vojáci, lučištníci, mniši, kopiníci, kušiníci.": "Soldiers, archers, monks, spearmen, crossbowmen.",
    "Výcvik rytířů a zvědů.": "Trains knights and scouts.",
    "Chrlí ghúly, kostlivce a pekelné psy.": "Spews out ghouls, skeletons and hellhounds.",
    "Sešívá zrůdy a morováky.": "Stitches together abominations and plaguebearers.",
    "Z pekla jí lezou přízraky a nekromanti.": "Banshees and necromancers crawl out of it from hell.",
    "Potřebuješ kovárnu.": "You need a smithy.",
    "Chybí ti budova.": "You are missing a building.",
    "VETERÁN!": "VETERAN!",
    "ELITA!": "ELITE!",
    "Dlouhé kopí proti jezdcům, hrdinům a velkým zrůdám.": "A long spear against riders, heroes and big monsters.",
    "Pomalu nabíjí, ale šipka prorazí zbroj.": "Reloads slowly, but the bolt pierces armour.",
    "Nejrychlejší jezdec, loví dělníky a střelce v týlu.": "The fastest rider, hunting workers and archers behind the lines.",
    "Rychlý jako vítr, kousne a zmizí ve smečce.": "Fast as the wind, bites and vanishes into the pack.",
    "Ze země zvedá padlé jako kostlivce.": "Raises the fallen from the ground as skeletons.",
    "Když padne, praskne v jedovatém oblaku.": "When it falls, it bursts in a poisonous cloud.",
  });

  PK.i18n.add("szl", {
    "Kopiník": "Kopjinik",
    "Kušiník": "Kušnik",
    "Zvěd": "Zvjadovec",
    "Pekelný pes": "Pěkělny pes",
    "Nekromant": "Nekromant",
    "Morovák": "Morovok",
    "Kušiník (s kovárnou)": "Kušnik (s kužňóm)",
    "Zvěd (ve stáji)": "Zvjadovec (v maštali)",
    "Dlouhé kopí. Proti jezdcům, hrdinům a velkým zrůdám udeří skoro dvojnásob.":
      "Dłogo kopja. Na jezdcóv, hrdinóv a vělke potvory bije skoro dvarazy tela.",
    "Pomalu nabíjí, ale šipka prorazí zbroj a bolí. Potřebuje kovárnu.":
      "Nabijo pómału, ale bełt přebije pancyř a bolí. Potřebuje kužňe.",
    "Nejrychlejší jezdec. Loví dělníky, střelce, mnichy a stroje v týlu.":
      "Najrychlejši jezdec. Chyto robotnikóv, střelcóv, mnichóv a mašiny za frontóm.",
    "Cvičí vojáky, lučištníky, mnichy, kopiníky a kušiníky. Staví dělník (12 s).":
      "Cviči vojokóv, střelcóv, mnichóv, kopjinikóv a kušnikóv. Stavjo robotnik (12 s).",
    "Cvičí rytíře a zvědy. Potřebuje kasárna. Staví dělník (14 s).":
      "Cviči rycyřóv a zvjadovcóv. Potřebuje kasarňe. Stavjo robotnik (14 s).",
    "Vojáci, lučištníci, mniši, kopiníci, kušiníci.": "Vojocy, střelcy, mnišy, kopjinicy, kušnicy.",
    "Výcvik rytířů a zvědů.": "Cvičyni rycyřóv a zvjadovcóv.",
    "Chrlí ghúly, kostlivce a pekelné psy.": "Vypluvo ghule, trupy a pěkělne psy.",
    "Sešívá zrůdy a morováky.": "Zešyvo potvory a morovoki.",
    "Z pekla jí lezou přízraky a nekromanti.": "Z pěkła z ni lezóm zmory a nekromanci.",
    "Potřebuješ kovárnu.": "Třeba či kužňe.",
    "Chybí ti budova.": "Chybi či budynek.",
    "VETERÁN!": "VETERAN!",
    "ELITA!": "ELITA!",
    "Dlouhé kopí proti jezdcům, hrdinům a velkým zrůdám.": "Dłogo kopja na jezdcóv, hrdinóv a vělke potvory.",
    "Pomalu nabíjí, ale šipka prorazí zbroj.": "Nabijo pómału, ale bełt přebije pancyř.",
    "Nejrychlejší jezdec, loví dělníky a střelce v týlu.": "Najrychlejši jezdec, chyto robotnikóv a střelcóv za frontóm.",
    "Rychlý jako vítr, kousne a zmizí ve smečce.": "Rychły jak vjater, ugryzne a zgino v kupje psóv.",
    "Ze země zvedá padlé jako kostlivce.": "Ze žymje zvedo padłych jako trupy.",
    "Když padne, praskne v jedovatém oblaku.": "Jak padnje, pukne v jedovatym mraku.",
  });
})();
