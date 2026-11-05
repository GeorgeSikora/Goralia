/*
 * Texty hrdinů (schopnosti, výcvik v gmině, nápovědy) v angličtině a po našimu.
 * Načítá se hned po js/lang/en.js a szl.js. Klíč = český text z kódu (js/i18n.js).
 * Po našimu podle /mnt/project-files/i18n/ponaszymu-pravidla.md: český pravopis + ł, ó, dź, žádné dlouhé samohlásky.
 */
(() => {
  const PK = window.PK;
  if (!PK || !PK.i18n) return;

  PK.i18n.add("en", {
    /* ---------- schopnosti ---------- */
    "Výpad": "Lunge",
    "Bojový pokřik": "War Cry",
    "Štítová zeď": "Shield Wall",
    "Ohnivá koule": "Fireball",
    "Vyvolání kostlivců": "Raise Skeletons",
    "Mrazivá aura": "Frost Aura",

    /* ---------- nápovědy (HUD) ---------- */
    "Pěší rytíř se štítem. Výpad, bojový pokřik a štítová zeď. Jen jeden, po smrti ho vycvičíš znovu.":
      "A foot knight with a shield. Lunge, war cry and shield wall. Only one; if he dies, train him again.",
    "Cvičí vojáky, lučištníky a mnichy. Staví dělník (12 s).": "Trains soldiers, archers and monks. Built by a worker (12 s).",
    "Rytíř se vrhne na cíl a zasáhne nepřátele kolem místa dopadu.": "The knight leaps at the target and strikes enemies around where he lands.",
    "Spojenci v okolí dávají chvíli víc poškození.": "Nearby allies deal more damage for a while.",
    "Rytíř zvedne štít: on i spojenci těsně u něj dostávají méně poškození.": "The knight raises his shield: he and allies right next to him take less damage.",
    "Lich vrhne ohnivou kouli, zraní vše v místě dopadu.": "The lich hurls a fireball that hurts everything where it lands.",
    "Ze země vylezou dva kostlivci, po čase se rozpadnou.": "Two skeletons climb out of the ground and crumble after a while.",
    "Nepřátelé kolem licha chodí a útočí pomaleji.": "Enemies around the lich move and attack more slowly.",
    "{0} Mana {1}, přebíjení {2} s.": "{0} Mana {1}, cooldown {2} s.",
    "{0} Výcvik v gmině trvá {1} s.": "{0} Training at the town hall takes {1} s.",
    "Dělníci, hrdina, nástroje, opevnění.": "Workers, hero, tools, masonry.",
    "Výcvik vojáků, lučištníků a mnichů.": "Trains soldiers, archers and monks.",

    /* ---------- hlášky ---------- */
    "{0} · KLIKNI NA CÍL": "{0} · CLICK A TARGET",
    "Klikni na cíl: {0}.": "Click a target: {0}.",
    "{0}: ještě {1} s.": "{0}: {1} s left.",
    "{0}: chybí mana.": "{0}: not enough mana.",
    "Nemáš hrdinu.": "You have no hero.",
    "Hrdina se už cvičí.": "The hero is already training.",
    "Výcvik hrdiny: {0} s.": "Hero training: {0} s.",
    "Hrdina je připraven.": "The hero is ready.",
    "VÝCVIK HRDINY {0} %": "HERO TRAINING {0} %",

    /* ---------- ovládání ---------- */
    "Hrdina (v gmině)": "Hero (at the town hall)",
    "Vylepšení": "Upgrades",
    "Schopnosti hrdiny": "Hero abilities",
    "1. schopnost (Výpad, Ohnivá koule)": "1st ability (Lunge, Fireball)",
    "2. schopnost (Bojový pokřik, Vyvolání)": "2nd ability (War Cry, Raise Skeletons)",
    "3. schopnost (Štítová zeď, Mrazivá aura)": "3rd ability (Shield Wall, Frost Aura)",
    "schopnosti vybraného hrdiny": "abilities of the selected hero",
    "Vyber hrdinu a sesílej schopnosti klávesami Q, W a E.": "Select your hero and cast abilities with Q, W and E.",

    /* ---------- web ---------- */
    "Pěší rytíř se štítem: výpad, bojový pokřik a štítová zeď. Roste do 5. úrovně.":
      "A foot knight with a shield: lunge, war cry and shield wall. Grows up to level 5.",
    "Hrdina nemrtvých: ohnivá koule, vyvolání kostlivců a mrazivá aura.": "Hero of the undead: fireball, raise skeletons and frost aura.",
    "Každá frakce má svého hrdinu: rytíř se vrhá výpadem, burcuje pokřikem a kryje druhy štítovou zdí, lich metá ohnivé koule, vyvolává kostlivce a mrazí. Sbírá zkušenosti až do 5. úrovně.":
      "Each faction has its hero: the knight lunges, rallies his men with a war cry and covers them with a shield wall, the lich hurls fireballs, raises skeletons and freezes. Heroes gain experience up to level 5."
  });

  PK.i18n.add("szl", {
    /* ---------- fortele ---------- */
    "Výpad": "Vypad",
    "Bojový pokřik": "Bojovy pokřyk",
    "Štítová zeď": "Štitovo ščana",
    "Ohnivá koule": "Łognisto kula",
    "Vyvolání kostlivců": "Vyvołani trupóv",
    "Mrazivá aura": "Mrožno aura",

    /* ---------- nápovědy (HUD) ---------- */
    "Pěší rytíř se štítem. Výpad, bojový pokřik a štítová zeď. Jen jeden, po smrti ho vycvičíš znovu.":
      "Pěšy rycyř ze štitym. Vypad, bojovy pokřyk a štitovo ščana. Jyny jedyn, po šmjerči go zaš vycvičiš.",
    "Cvičí vojáky, lučištníky a mnichy. Staví dělník (12 s).": "Cviči vojokóv, střelcóv a mnichóv. Stavjo robotnik (12 s).",
    "Rytíř se vrhne na cíl a zasáhne nepřátele kolem místa dopadu.": "Rycyř skoči na cyl a trefi vrogóv okolo mjejsca dopadu.",
    "Spojenci v okolí dávají chvíli víc poškození.": "Kamraci okolo dajóm chvile vjyncej škody.",
    "Rytíř zvedne štít: on i spojenci těsně u něj dostávají méně poškození.": "Rycyř zdźvigne štit: un aji kamraci těsně při ňim dostajóm mjyni škody.",
    "Lich vrhne ohnivou kouli, zraní vše v místě dopadu.": "Lich chyně łognistóm kule, rani všecko v mjejscu dopadu.",
    "Ze země vylezou dva kostlivci, po čase se rozpadnou.": "Ze žymje vylezóm dva trupy, po chvili se rozpadnóm.",
    "Nepřátelé kolem licha chodí a útočí pomaleji.": "Vrogově kole licha chodźóm a šturmujóm pómalej.",
    "{0} Mana {1}, přebíjení {2} s.": "{0} Mana {1}, čakani {2} s.",
    "{0} Výcvik v gmině trvá {1} s.": "{0} Cvičyni v gmině trvo {1} s.",
    "Dělníci, hrdina, nástroje, opevnění.": "Robotnicy, hrdina, vercajg, mury.",
    "Výcvik vojáků, lučištníků a mnichů.": "Cvičyni vojokóv, střelcóv a mnichóv.",

    /* ---------- hlášky ---------- */
    "{0} · KLIKNI NA CÍL": "{0} · KLIKNI NA CYL",
    "Klikni na cíl: {0}.": "Klikni na cyl: {0}.",
    "{0}: ještě {1} s.": "{0}: ješče {1} s.",
    "{0}: chybí mana.": "{0}: chybjo mana.",
    "Nemáš hrdinu.": "Nimoš hrdine.",
    "Hrdina se už cvičí.": "Hrdina se už cviči.",
    "Výcvik hrdiny: {0} s.": "Cvičyni hrdiny: {0} s.",
    "Hrdina je připraven.": "Hrdina je fertig.",
    "VÝCVIK HRDINY {0} %": "CVIČYNI HRDINY {0} %",

    /* ---------- ovłodani ---------- */
    "Hrdina (v gmině)": "Hrdina (v gmině)",
    "Vylepšení": "Vylepšyni",
    "Schopnosti hrdiny": "Fortele hrdiny",
    "1. schopnost (Výpad, Ohnivá koule)": "1. fortel (Vypad, Łognisto kula)",
    "2. schopnost (Bojový pokřik, Vyvolání)": "2. fortel (Bojovy pokřyk, Vyvołani)",
    "3. schopnost (Štítová zeď, Mrazivá aura)": "3. fortel (Štitovo ščana, Mrožno aura)",
    "schopnosti vybraného hrdiny": "fortele vybranego hrdiny",
    "Vyber hrdinu a sesílej schopnosti klávesami Q, W a E.": "Vyběr hrdine a puščej fortele klavesami Q, W a E.",

    /* ---------- web ---------- */
    "Pěší rytíř se štítem: výpad, bojový pokřik a štítová zeď. Roste do 5. úrovně.":
      "Pěšy rycyř ze štitym: vypad, bojovy pokřyk a štitovo ščana. Rošče až na 5. stopjyň.",
    "Hrdina nemrtvých: ohnivá koule, vyvolání kostlivců a mrazivá aura.": "Hrdina umarlokóv: łognisto kula, vyvołani trupóv a mrožno aura.",
    "Každá frakce má svého hrdinu: rytíř se vrhá výpadem, burcuje pokřikem a kryje druhy štítovou zdí, lich metá ohnivé koule, vyvolává kostlivce a mrazí. Sbírá zkušenosti až do 5. úrovně.":
      "Každo strona mo svojego hrdine: rycyř skoče vypadym, burcuje pokřykym a kryje kamratóv štitovóm ščanóm, lich chybo łognistymi kulami, volo trupy a mrozi. Zbjyro zkušenošči až na 5. stopjyň."
  });
})();
