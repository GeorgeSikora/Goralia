/*
 * Hudba na pozadí: vlastní skladby (žádné cizí nahrávky ani melodie), syntetizované přes Web Audio.
 *
 * Každá skladba má části (A, B …) a formu: sled průchodů, kde se v každém mění nástroje,
 * doprovod a bicí (housle → fujara → harfa …), takže se ani jedna skladba neopakuje stejně.
 * Skladby jsou rozdělené do nálad (scén):
 *  - menu: středověké skladby (loutna, flétna, lesní roh)
 *  - peace: den ve hře, podhalanská lidová muzika (prim, sekund, basy, koza, cimbál)
 *  - night: noc ve hře (fujara, harfa, zvony, tichý sbor)
 *  - battle: boj (rychlé tance s bubny, válečný roh)
 *  - undead / undead-battle: kooperační mapy proti nemrtvým (sbor, zvony, kostěný xylofon)
 *  - win / lose: krátká znělka po konci zápasu, potom menu
 *
 * Přehrávač bere skladby nálady v zamíchaném pořadí (žádná hned dvakrát po sobě), mezi skladbami
 * nechá chvíli ticha a při změně nálady skladby prolne. Plánování dopředu (lookahead) drží rytmus
 * přesně i při zatížení hry.
 * Nastavení: zapnuto/vypnuto a vlastní hlasitost (localStorage pk-music, pk-music-vol).
 */
(() => {
  "use strict";

  const PK = window.PK;
  const A = PK.audio;

  /* ---------- noty ---------- */
  const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  function midi(name) {
    const m = /^([A-G])([#b]?)(\d)$/.exec(name);
    if (!m) throw new Error(`hudba: špatná nota ${name}`);
    return 12 * (Number(m[3]) + 1) + SEMI[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
  }

  const hz = n => 440 * Math.pow(2, (n - 69) / 12);

  // "D5 E5:2 -:2 | ..." -> [{ n, len }] (délka v šestnáctinách) + součty taktů pro kontrolu
  function parse(str) {
    const notes = [];
    const bars = [0];
    for (const tok of str.split(/\s+/)) {
      if (!tok) continue;
      if (tok === "|") { bars.push(0); continue; }
      const [name, l] = tok.split(":");
      const len = l ? Number(l) : 1;
      notes.push({ n: name === "-" ? null : midi(name), len });
      bars[bars.length - 1] += len;
    }
    if (!bars[bars.length - 1]) bars.pop();
    return { notes, bars };
  }

  // akord: kořen + typ -> půltóny od kořene
  const CHORD = { "": [0, 4, 7], m: [0, 3, 7], "7": [0, 4, 7, 10], m7: [0, 3, 7, 10], sus: [0, 5, 7], dim: [0, 3, 6] };

  function chord(name) {
    const m = /^([A-G][#b]?)(m7|m|7|sus|dim)?$/.exec(name);
    if (!m) throw new Error(`hudba: špatný akord ${name}`);
    return { root: midi(`${m[1]}2`), tones: CHORD[m[2] || ""] };
  }

  /* ---------- skladby (všechny originální) ----------
   * bar = šestnáctin v taktu, parts = části (mel + akord na takt), form = průchody:
   *   s = část, lead = sólový nástroj, lead2 = druhý hlas o tolik půltónů (a nástroj lead2i),
   *   acc = doprovody, drums = bicí, tr = transpozice celé hudby, oct = posun jen melodie, v = síla.
 * gain skladby vyrovnává hlasitost (změřeno na ukázkách).
   * Výchozí hodnoty průchodu jsou přímo ve skladbě. */
  const TUNES = [
    /* ===== menu ===== */
    {
      id: "kral", name: "Králova síň", scenes: ["menu"], tempo: 96, bar: 12,
      lead: "recorder", acc: ["lute6", "drone"], drone: "D2", wet: 0.34,
      parts: {
        A: {
          mel: `D5:4 F5:2 G5:4 A5:2 | C6:4 A5:2 G5:4 F5:2 | E5:4 G5:2 F5:4 E5:2 | D5:12 |
                A5:4 G5:2 F5:4 E5:2 | F5:4 G5:2 A5:4 F5:2 | G5:4 E5:2 C5:4 E5:2 | D5:12`,
          chords: "Dm C Am Dm F C C Dm"
        },
        B: {
          mel: `F5:2 G5:2 A5:2 C6:4 A5:2 | G5:4 F5:2 E5:4 D5:2 | C5:4 D5:2 E5:4 G5:2 | A5:12 |
                A5:4 G5:2 F5:4 E5:2 | D5:4 E5:2 F5:4 A4:2 | C5:4 E5:2 D5:4 C#5:2 | D5:12`,
          chords: "F C C Am Dm Dm A Dm"
        }
      },
      form: [
        { s: "A", acc: ["lute6"] },
        { s: "B" },
        { s: "A", lead: "harp", acc: ["pad", "drone"], v: 0.9 },
        { s: "B", lead2: -12, lead2i: "fiddle" },
        { s: "A", lead2: 12, lead2i: "bells", drums: "frame" }
      ]
    },
    {
      id: "studanka", name: "Studánka", scenes: ["menu"], tempo: 88, bar: 12,
      lead: "recorder", acc: ["lute6", "drone"], drone: "D2", wet: 0.36,
      parts: {
        A: {
          mel: `A4:2 D5:2 E5:2 F5:4 E5:2 | D5:4 C5:2 A4:6 | G4:2 A4:2 C5:2 D5:4 E5:2 | D5:12 |
                F5:2 G5:2 A5:2 G5:4 F5:2 | E5:4 C5:2 D5:4 E5:2 | F5:4 E5:2 D5:4 C#5:2 | D5:12`,
          chords: "Dm C C Dm F C A Dm"
        },
        B: {
          mel: `A5:4 G5:2 F5:4 D5:2 | E5:4 F5:2 G5:6 | F5:4 E5:2 D5:4 C5:2 | A4:12 |
                D5:2 E5:2 F5:2 G5:4 A5:2 | B5:4 A5:2 G5:4 F5:2 | E5:4 C5:2 D5:4 E5:2 | D5:12`,
          chords: "Dm C Dm Am Dm G C Dm"
        }
      },
      form: [
        { s: "A", lead: "lute", acc: ["drone"] },
        { s: "A" },
        { s: "B", acc: ["harp", "drone"] },
        { s: "A", lead: "fiddle", acc: ["lute6", "pad"], v: 0.85 },
        { s: "B", lead2: 12, lead2i: "bells" },
        { s: "A", lead: "harp", acc: ["drone"] }
      ]
    },
    {
      id: "brana", name: "Hradní brána", scenes: ["menu"], tempo: 100, bar: 16,
      lead: "horn", acc: ["pad", "harp"], wet: 0.3,
      parts: {
        A: {
          mel: `F4:4 A4:2 C5:2 F5:6 E5:2 | D5:4 C5:2 Bb4:2 A4:8 | G4:4 Bb4:2 D5:2 G5:6 F5:2 | E5:4 D5:2 C5:2 C5:8 |
                F5:4 G5:2 A5:2 Bb5:4 A5:2 G5:2 | A5:4 F5:2 D5:2 C5:8 | Bb4:4 D5:2 G5:2 E5:4 C5:4 | F5:12 -:4`,
          chords: "F Bb Gm C Bb Dm C7 F"
        },
        B: {
          mel: `D5:6 E5:2 F5:4 D5:4 | A5:6 G5:2 F5:4 E5:4 | D5:6 E5:2 F5:4 G5:4 | A5:12 -:4 |
                Bb5:4 A5:2 G5:2 F5:4 E5:4 | F5:4 E5:2 D5:2 C#5:8 | D5:4 F5:2 A5:2 G5:4 E5:4 | D5:12 -:4`,
          chords: "Dm F Gm A Bb A Dm Dm"
        }
      },
      form: [
        { s: "A", acc: ["pad"] },
        { s: "A", drums: "march" },
        { s: "B", lead: "choir", acc: ["harp"] },
        { s: "B", lead: "fiddle", acc: ["harp", "pad"], v: 0.9 },
        { s: "A", lead2: -12, drums: "march" }
      ]
    },

    /* ===== den ve hře ===== */
    {
      id: "wierchowa", name: "Wierchowa", scenes: ["peace"], tempo: 84, bar: 12,
      lead: "fiddle", acc: ["goral3"], wet: 0.3,
      parts: {
        A: {
          mel: `D5:4 E5:2 D5:2 B4:4 | A4:4 B4:2 C#5:2 D5:4 | E5:6 D5:2 C#5:2 B4:2 | A4:12 |
                D5:4 E5:2 F5:2 G5:4 | F5:4 E5:2 D5:2 C#5:4 | D5:2 E5:2 D5:2 B4:2 A4:2 B4:2 | G4:12`,
          chords: "G G A D G F A G"
        },
        B: {
          mel: `G5:4 A5:2 G5:2 F5:4 | E5:4 F5:2 E5:2 D5:4 | C#5:4 D5:2 E5:2 C#5:2 A4:2 | D5:12 |
                B4:4 C#5:2 D5:2 E5:4 | F5:6 E5:2 D5:4 | C#5:2 B4:2 A4:2 B4:2 C#5:2 A4:2 | G4:12`,
          chords: "F C A D G F A G"
        }
      },
      form: [
        { s: "A" },
        { s: "B" },
        { s: "A", lead: "fujara", acc: ["goral3"], v: 0.95 },
        { s: "B", lead2: -12 },
        { s: "A", lead2: -12, lead2i: "dulcimer" }
      ]
    },
    {
      id: "pastersko", name: "Pastýřská", scenes: ["peace"], tempo: 92, bar: 12,
      lead: "fiddle", acc: ["goral3"], wet: 0.3,
      parts: {
        A: {
          mel: `G4:2 B4:2 D5:2 G5:4 F5:2 | E5:4 D5:2 C#5:4 D5:2 | E5:2 F5:2 E5:2 D5:4 B4:2 | A4:8 -:4 |
                A4:2 C#5:2 E5:2 A5:4 G5:2 | F5:4 E5:2 D5:4 C#5:2 | D5:2 E5:2 C#5:2 B4:4 A4:2 | G4:8 -:4`,
          chords: "G A A D A F A G"
        },
        B: {
          mel: `D5:4 C#5:2 B4:4 A4:2 | G4:4 A4:2 B4:6 | C#5:2 D5:2 E5:2 G5:4 E5:2 | D5:8 -:4 |
                G5:2 F5:2 E5:2 D5:4 C#5:2 | B4:4 C#5:2 D5:4 B4:2 | A4:2 B4:2 C#5:2 A4:4 B4:2 | G4:8 -:4`,
          chords: "D G A7 D G7 G A G"
        }
      },
      form: [
        { s: "A", lead: "fujara", acc: ["drone"], drone: "G2" },
        { s: "A" },
        { s: "B" },
        { s: "A", lead: "dulcimer" },
        { s: "B", lead2: -12 },
        { s: "A", lead: "fujara", acc: ["goral3"] }
      ]
    },
    {
      id: "rosa", name: "Ranní rosa", scenes: ["peace"], tempo: 80, bar: 12,
      lead: "recorder", acc: ["harp"], wet: 0.36,
      parts: {
        A: {
          mel: `D5:4 B4:2 G4:2 B4:2 D5:2 | E5:6 D5:2 C5:4 | B4:4 C5:2 D5:2 G5:4 | A5:8 G5:2 F#5:2 |
                G5:4 E5:2 C5:2 E5:4 | D5:4 B4:2 G4:2 B4:4 | A4:4 B4:2 C5:2 D5:2 F#5:2 | G5:12`,
          chords: "G C G D C G D G"
        },
        B: {
          mel: `B5:6 A5:2 G5:4 | F#5:4 E5:4 D5:4 | E5:4 G5:2 B5:2 A5:4 | F#5:12 |
                G5:4 F#5:2 E5:2 D5:4 | C5:4 E5:2 G5:2 E5:4 | D5:4 C5:2 B4:2 A4:4 | G4:12`,
          chords: "Em D C B Em C D G"
        }
      },
      form: [
        { s: "A" },
        { s: "A", lead: "fiddle", v: 0.85 },
        { s: "B", acc: ["harp", "pad"] },
        { s: "A", lead: "harp", acc: ["pad"] },
        { s: "B", lead: "fiddle", lead2: 12, lead2i: "recorder", acc: ["harp"] },
        { s: "A" }
      ]
    },
    {
      id: "koza", gain: 1.4, name: "Koza na salaši", scenes: ["peace"], tempo: 116, bar: 12,
      lead: "koza", acc: ["kozadrone"], drone: "G2", drums: "frame", wet: 0.24,
      parts: {
        A: {
          mel: `G4:2 A4:2 B4:2 C#5:4 B4:2 | A4:2 B4:2 A4:2 G4:6 | D5:2 E5:2 D5:2 C#5:4 B4:2 | A4:6 D4:6 |
                G4:2 A4:2 B4:2 C#5:4 D5:2 | E5:4 D5:2 C#5:4 B4:2 | A4:2 B4:2 C#5:2 A4:4 F4:2 | G4:6 G4:4 -:2`,
          chords: "G G G D G A A G"
        },
        B: {
          mel: `D5:4 D5:2 E5:2 F5:2 E5:2 | D5:2 C#5:2 B4:2 A4:6 | B4:2 C#5:2 D5:2 E5:4 C#5:2 | D5:6 A4:6 |
                F5:4 E5:2 D5:4 C#5:2 | B4:4 C#5:2 D5:4 B4:2 | A4:2 G4:2 A4:2 B4:2 C#5:2 A4:2 | G4:12`,
          chords: "D D G D D G A G"
        }
      },
      form: [
        { s: "A", drums: null },
        { s: "A" },
        { s: "B" },
        { s: "B", lead: "fiddle", acc: ["kozadrone", "goral3"] },
        { s: "A", lead2: 12, lead2i: "fiddle" },
        { s: "A", acc: ["kozadrone", "goral3"] }
      ]
    },
    {
      id: "drevorubci", name: "Dřevorubci", scenes: ["peace"], tempo: 108, bar: 8,
      lead: "fiddle", acc: ["goral2"], wet: 0.26,
      parts: {
        A: {
          mel: `A4 C5 E5 A5 G5:2 E5:2 | D5 E5 F#5 D5 E5:4 | A4 C5 E5 A5 B5:2 A5:2 | G5 E5 D5 B4 A4:4 |
                C5 D5 E5 G5 A5:2 G5:2 | E5 D5 C5 D5 E5:4 | D5 C5 B4 G4 A4:2 B4:2 | A4:6 -:2`,
          chords: "Am D Am G C Am G Am"
        },
        B: {
          mel: `E5:2 E5 F#5 G5:2 F#5 E5 | D5:2 D5 E5 F#5:4 | G5:2 F#5 E5 D5:2 B4:2 | A4:2 B4 C5 D5:4 |
                E5:2 E5 F#5 G5:2 A5:2 | B5:2 A5 G5 F#5:2 D5:2 | E5 F#5 G5 E5 D5:2 B4:2 | A4:6 -:2`,
          chords: "Em D G D Em Bm Em Am"
        }
      },
      form: [
        { s: "A", lead: "dulcimer", acc: ["dulcimer"] },
        { s: "A" },
        { s: "B" },
        { s: "A", drums: "frame" },
        { s: "B", lead2: 12, lead2i: "dulcimer", drums: "frame" },
        { s: "A", lead: "dulcimer", acc: ["goral2"] }
      ]
    },

    /* ===== noc ===== */
    {
      id: "jezero", gain: 0.72, name: "Měsíční jezero", scenes: ["night"], tempo: 64, bar: 16,
      lead: "fujara", acc: ["harp"], wet: 0.46,
      parts: {
        A: {
          mel: `E4:6 G4:2 B4:8 | A4:6 B4:2 C5:4 B4:4 | G4:6 F#4:2 E4:4 D4:4 | B3:12 -:4 |
                E4:6 G4:2 B4:6 D5:2 | C5:8 B4:4 A4:4 | B4:6 A4:2 G4:4 F#4:4 | E4:16`,
          chords: "Em Am C B Em C B Em"
        },
        B: {
          mel: `G4:6 A4:2 B4:4 D5:4 | E5:8 D5:4 B4:4 | C5:6 D5:2 E5:4 G5:4 | F#5:12 -:4 |
                G5:6 F#5:2 E5:4 D5:4 | C5:6 B4:2 A4:8 | B4:8 D#5:4 F#5:4 | E5:16`,
          chords: "G Em C D Em Am B Em"
        }
      },
      form: [
        { s: "A", acc: ["pad"] },
        { s: "A", acc: ["harp", "pad"] },
        { s: "B", lead: "recorder" },
        { s: "A", lead: "harp", acc: ["pad"], v: 0.9 },
        { s: "B", lead2: 12, lead2i: "bells", acc: ["harp", "pad"] }
      ]
    },
    {
      id: "lucerny", gain: 1.2, name: "Lucerny", scenes: ["night", "undead"], tempo: 72, bar: 12,
      lead: "bells", acc: ["choirpad"], wet: 0.48,
      parts: {
        A: {
          mel: `E5:4 A5:4 B5:4 | C6:6 B5:2 A5:4 | G5:4 E5:4 C5:4 | D5:12 |
                F5:4 E5:4 D5:4 | E5:6 C5:2 A4:4 | B4:4 D5:4 G#4:4 | A4:12`,
          chords: "Am Am C G Dm Am E7 Am"
        },
        B: {
          mel: `C5:4 E5:4 G5:4 | A5:6 G5:2 F5:4 | E5:4 G5:4 C6:4 | B5:12 |
                A5:4 F5:4 D5:4 | E5:4 C5:4 A4:4 | B4:4 E5:4 G#5:4 | A5:12`,
          chords: "C F C G Dm Am E Am"
        }
      },
      form: [
        { s: "A" },
        { s: "A", lead: "harp", acc: ["choirpad"] },
        { s: "B", acc: ["harp", "choirpad"] },
        { s: "B", lead: "recorder", lead2: 12, lead2i: "bells", acc: ["harp"] },
        { s: "A", acc: ["harp", "choirpad"] }
      ]
    },
    {
      id: "hvezdy", name: "Hvězdy nad horami", scenes: ["night"], tempo: 76, bar: 12,
      lead: "recorder", acc: ["lute6"], wet: 0.42,
      parts: {
        A: {
          mel: `D5:4 E5:2 F5:4 A5:2 | G5:6 E5:6 | F5:4 E5:2 D5:4 C5:2 | D5:6 A4:6 |
                B4:4 C5:2 D5:4 F5:2 | E5:6 C5:6 | D5:4 E5:2 C5:4 A4:2 | D5:12`,
          chords: "Dm C F Dm G C Am Dm"
        },
        B: {
          mel: `A5:4 G5:2 F5:4 E5:2 | D5:6 F5:6 | G5:4 A5:2 B5:4 G5:2 | A5:12 |
                C6:4 B5:2 A5:4 G5:2 | F5:6 A5:6 | G5:4 E5:2 C5:4 E5:2 | D5:12`,
          chords: "Dm Dm G Am Am F C Dm"
        }
      },
      form: [
        { s: "A", lead: "lute", acc: ["drone"], drone: "D2" },
        { s: "A" },
        { s: "B", acc: ["lute6", "drone"], drone: "D2" },
        { s: "A", lead: "fujara", oct: -12, acc: ["harp"] },
        { s: "B", lead2: 12, lead2i: "bells" },
        { s: "A", lead: "lute", acc: ["pad"] }
      ]
    },

    /* ===== boj ===== */
    {
      id: "krzesany", name: "Krzesany", scenes: ["battle"], tempo: 138, bar: 8,
      lead: "fiddle", acc: ["goral2"], drums: "goral", wet: 0.22,
      parts: {
        A: {
          mel: `D5 D5 B4 D5 E5 D5 C#5 B4 | A4 B4 C#5 A4 D5:2 D5:2 | G5 F5 E5 D5 C#5 E5 D5 C#5 | B4 C#5 D5 B4 A4:2 -:2 |
                D5 D5 B4 D5 E5 D5 C#5 B4 | A4 B4 C#5 D5 E5 F5 G5 E5 | D5 C#5 B4 C#5 D5 B4 A4 C#5 | G4:2 B4 D5 G4:2 -:2`,
          chords: "G D G D G D D G"
        },
        B: {
          mel: `G5 G5 F5 E5 F5 G5 A5 G5 | F5 E5 D5 E5 F5:2 D5:2 | E5 D5 C#5 B4 C#5 D5 E5 C#5 | D5:4 A4:2 -:2 |
                G5 G5 F5 E5 F5 G5 A5 G5 | F5 E5 D5 C#5 D5 E5 F5 E5 | D5 B4 G4 B4 D5 C#5 B4 A4 | G4:4 -:4`,
          chords: "F F A D F F D G"
        }
      },
      form: [
        { s: "A" },
        { s: "A", lead2: -12 },
        { s: "B" },
        { s: "B", lead2: -12, lead2i: "dulcimer" },
        { s: "A", lead2: -12, drums: "war2" },
        { s: "B", lead2: 12, lead2i: "fiddle", drums: "war2" }
      ]
    },
    {
      id: "hola", name: "Hola!", scenes: ["battle"], tempo: 132, bar: 8,
      lead: "fiddle", acc: ["goral2"], drums: "goral", wet: 0.22,
      parts: {
        A: {
          mel: `G4 B4 D5 G5 F5:2 E5:2 | D5 E5 F5 E5 D5:2 C#5:2 | D5 C#5 B4 A4 B4 C#5 D5 E5 | F5:4 E5:4 |
                G5 F5 E5 F5 G5 A5 G5 F5 | E5 F5 E5 D5 C#5:2 A4:2 | B4 C#5 D5 E5 F5 E5 D5 C#5 | D5:4 -:4`,
          chords: "G F A F G A A D"
        },
        B: {
          mel: `A5 G5 F5 G5 A5:2 G5:2 | F5 E5 D5 E5 F5:2 E5:2 | D5 E5 C#5 D5 B4 C#5 A4 B4 | G4 A4 B4 C#5 D5:2 -:2 |
                A5 G5 F5 G5 A5:2 G5:2 | F5 E5 D5 C#5 D5:2 B4:2 | C#5 D5 E5 C#5 D5 B4 A4 F#4 | G4:4 G4:2 -:2`,
          chords: "F F A G F D A G"
        }
      },
      form: [
        { s: "A", lead: "koza", acc: ["goral2", "kozadrone"], drone: "G2" },
        { s: "A" },
        { s: "B", lead2: -12 },
        { s: "A", lead2: -12, lead2i: "horn", drums: "war2" },
        { s: "B", lead2: 12, lead2i: "dulcimer", drums: "war2" },
        { s: "B", lead: "koza", acc: ["goral2", "kozadrone"], drone: "G2", drums: "war2" }
      ]
    },
    {
      id: "roh", gain: 0.9, name: "Válečný roh", scenes: ["battle", "undead-battle"], tempo: 116, bar: 16,
      lead: "horn", acc: ["ostinato", "pad"], drums: "war", wet: 0.28,
      parts: {
        A: {
          mel: `D4:4 D4:2 F4:2 A4:6 G4:2 | E4:4 F4:2 E4:2 C#4:8 | D4:4 D4:2 F4:2 A4:4 C5:4 | Bb4:6 A4:2 G4:8 |
                A4:4 A4:2 Bb4:2 C5:6 Bb4:2 | A4:4 G4:2 F4:2 G4:8 | F4:4 E4:2 D4:2 E4:4 C#4:4 | D4:12 -:4`,
          chords: "Dm A Dm Gm F C A Dm"
        },
        B: {
          mel: `A4:2 D5:2 D5:4 E5:2 F5:2 E5:4 | F5:2 G5:2 A5:4 G5:2 F5:2 E5:4 | D5:2 F5:2 A5:6 G5:2 F5:4 | E5:6 D5:2 C#5:8 |
                Bb4:2 D5:2 F5:4 E5:2 D5:2 C5:4 | A4:2 C5:2 E5:4 D5:2 C5:2 A4:4 | G4:2 Bb4:2 D5:4 C#5:2 E5:2 A4:4 | D5:12 -:4`,
          chords: "Dm C Dm A Bb Am A7 Dm"
        }
      },
      form: [
        { s: "A", acc: ["ostinato"] },
        { s: "A", lead2: 12, lead2i: "fiddle" },
        { s: "B", lead: "fiddle", lead2: -12, lead2i: "horn" },
        { s: "B", lead: "choir", lead2: 12, lead2i: "fiddle" },
        { s: "A", lead2: 12, lead2i: "horn", tr: 2 }
      ]
    },
    {
      id: "most", name: "Útok na most", scenes: ["battle", "undead-battle"], tempo: 150, bar: 12,
      lead: "fiddle", acc: ["gallop"], drums: "war6", wet: 0.22,
      parts: {
        A: {
          mel: `E5:2 F#5:2 G5:2 B5:4 G5:2 | A5:2 G5:2 F#5:2 E5:4 D5:2 | E5:2 F#5:2 G5:2 A5:2 B5:2 C6:2 | B5:6 F#5:6 |
                G5:2 A5:2 B5:2 E6:4 D6:2 | C6:2 B5:2 A5:2 G5:4 F#5:2 | F#5:2 A5:2 B5:2 A5:2 F#5:2 D#5:2 | E5:6 E4:4 -:2`,
          chords: "Em D C B Em C B7 Em"
        },
        B: {
          mel: `B5:4 A5:2 G5:4 F#5:2 | E5:4 F#5:2 G5:6 | A5:4 G5:2 F#5:4 E5:2 | D5:6 B4:6 |
                C5:2 E5:2 G5:2 C6:4 B5:2 | A5:2 F#5:2 D5:2 A5:4 G5:2 | F#5:2 G5:2 A5:2 B5:4 D#5:2 | E5:12`,
          chords: "Em C D G C D B Em"
        }
      },
      form: [
        { s: "A" },
        { s: "A", lead2: -12, lead2i: "horn" },
        { s: "B", lead: "horn", oct: -12, acc: ["gallop", "pad"] },
        { s: "B", lead2: -12, lead2i: "horn" },
        { s: "B", lead2: -12, lead2i: "choir" },
        { s: "A", lead2: 12, lead2i: "dulcimer" }
      ]
    },

    /* ===== nemrtví (kooperační mapy) ===== */
    {
      id: "nekropole", name: "Nekropole", scenes: ["undead"], tempo: 66, bar: 16,
      lead: "choir", acc: ["pad", "drone"], drone: "C2", drums: "heart", wet: 0.5,
      parts: {
        A: {
          mel: `C4:8 Eb4:4 Db4:4 | C4:8 G3:8 | Ab3:8 Bb3:4 C4:4 | G3:16 |
                C4:4 Eb4:4 G4:8 | Ab4:8 G4:4 F4:4 | D4:6 Db4:2 C4:4 B3:4 | C4:16`,
          chords: "Cm Cm Ab G Cm Fm G Cm"
        },
        B: {
          mel: `G4:8 Ab4:4 G4:4 | F4:8 Eb4:4 D4:4 | Eb4:8 F4:4 G4:4 | Db4:16 |
                C4:4 Db4:4 Eb4:4 F4:4 | G4:8 Ab4:4 Bb4:4 | Ab4:6 G4:2 F4:4 D4:4 | C4:16`,
          chords: "Cm Bb Ab Db Cm Eb G7 Cm"
        }
      },
      form: [
        { s: "A", drums: null },
        { s: "A", lead: "bells", oct: 12, acc: ["choirpad", "drone"] },
        { s: "B" },
        { s: "B", lead: "fujara", acc: ["choirpad", "drone"] },
        { s: "A", lead2: 12, lead2i: "bells" }
      ]
    },
    {
      id: "lich", gain: 1.2, name: "Lichův chorál", scenes: ["undead"], tempo: 84, bar: 12,
      lead: "dulcimer", acc: ["waltz"], wet: 0.44,
      parts: {
        A: {
          mel: `D5:4 F5:4 A5:4 | C#6:6 D6:2 A5:4 | Bb5:4 A5:4 G5:4 | A5:12 |
                F5:4 E5:4 D5:4 | G5:4 F5:4 E5:4 | F5:4 E5:4 C#5:4 | D5:12`,
          chords: "Dm A Gm A Dm A7 A Dm"
        },
        B: {
          mel: `Bb4:4 D5:4 F5:4 | E5:6 F5:2 G5:4 | A5:4 G5:4 F5:4 | E5:12 |
                D5:4 F5:4 Bb5:4 | A5:4 G5:4 F5:4 | E5:4 G5:4 C#5:4 | D5:12`,
          chords: "Bb C F A Bb Dm A7 Dm"
        }
      },
      form: [
        { s: "A" },
        { s: "A", lead: "bells", acc: ["waltz", "choirpad"] },
        { s: "B", acc: ["waltz", "choirpad"], drums: "heart" },
        { s: "A", lead: "choir", oct: -12, acc: ["waltz"], drums: "heart" },
        { s: "B", lead2: 12, lead2i: "bells", acc: ["waltz", "choirpad"] }
      ]
    },
    {
      id: "kostlivci", name: "Tanec kostlivců", scenes: ["undead-battle"], tempo: 152, bar: 12,
      lead: "bone", acc: ["gallop"], drums: "war6", wet: 0.3,
      parts: {
        A: {
          mel: `E5:2 F5:2 E5:2 B4:4 E5:2 | F5:2 G#5:2 F5:2 E5:6 | D5:2 E5:2 F5:2 A5:4 F5:2 | E5:6 B4:6 |
                C5:2 D5:2 E5:2 G5:4 E5:2 | F5:2 E5:2 D5:2 C5:4 B4:2 | C5:2 B4:2 A4:2 G#4:4 B4:2 | E4:6 -:6`,
          chords: "E E Dm E C F E E"
        },
        B: {
          mel: `A5:4 G#5:2 A5:4 B5:2 | C6:4 B5:2 A5:6 | G5:4 F5:2 G5:4 A5:2 | B5:6 G#5:6 |
                F5:4 E5:2 F5:4 A5:2 | E5:4 D5:2 C5:4 B4:2 | A4:2 B4:2 C5:2 B4:4 G#4:2 | E5:12`,
          chords: "Am Am Dm E F C E E"
        }
      },
      form: [
        { s: "A", drums: "heart" },
        { s: "A", lead2: -12, lead2i: "fiddle" },
        { s: "B" },
        { s: "B", lead: "fiddle", lead2: -12, lead2i: "choir" },
        { s: "A", lead2: 12, lead2i: "bone" },
        { s: "A", lead: "choir", oct: -12, lead2: 12, lead2i: "bone" }
      ]
    },

    /* ===== znělky po zápase ===== */
    {
      id: "vitezstvi", name: "Vítězství", scenes: ["win"], once: true, tempo: 92, bar: 16,
      lead: "horn", lead2: -12, acc: ["pad"], drums: "roll", wet: 0.36,
      parts: {
        A: {
          mel: `A4:2 A4 A4 D5:6 A4:2 D5:2 F#5:2 | B5:8 A5:2 G5:2 D5:4 | A5:4 G5:2 F#5:2 E5:4 C#5:4 | D5:12 -:4`,
          chords: "D G A7 D"
        }
      },
      form: [{ s: "A" }]
    },
    {
      id: "porazka", name: "Porážka", scenes: ["lose"], once: true, tempo: 60, bar: 16,
      lead: "choir", acc: ["pad"], drums: "heart", wet: 0.5,
      parts: {
        A: {
          mel: `A4:8 F4:4 E4:4 | D4:8 C4:4 Bb3:4 | A3:8 G3:4 C#4:4 | D4:16`,
          chords: "Dm Bb A7 Dm"
        }
      },
      form: [{ s: "A" }]
    }
  ];

  for (const t of TUNES) {
    for (const p of Object.values(t.parts)) {
      const { notes, bars } = parse(p.mel);
      p.notes = notes;
      p.bars = bars;
      p.harm = p.chords.split(/\s+/).filter(Boolean).map(chord);
      p.length = notes.reduce((s, x) => s + x.len, 0);
    }
    t.form = t.form.map(st => ({
      lead: t.lead, lead2: t.lead2 == null ? null : t.lead2, lead2i: null, acc: t.acc, drums: t.drums || null,
      drone: t.drone || null, tr: 0, oct: 0, v: 1, ...st
    }));
  }

  // nálady, které hraje každá scéna (noc na kooperační mapě patří nemrtvým)
  const POOLS = {};
  for (const t of TUNES) for (const sc of t.scenes) (POOLS[sc] = POOLS[sc] || []).push(t);

  // ticho mezi skladbami (s): ve hře delší, ať hudba dýchá
  const GAP = { menu: [2, 4], peace: [6, 14], night: [8, 16], battle: [0.5, 1.5], undead: [5, 10], "undead-battle": [0.5, 1.5], win: [0.4, 0.4], lose: [0.4, 0.4] };

  /* ---------- nastavení ---------- */
  let enabled = true;
  let level = 0.6;

  try {
    enabled = localStorage.getItem("pk-music") !== "0";
    const v = parseFloat(localStorage.getItem("pk-music-vol"));
    if (isFinite(v)) level = Math.max(0, Math.min(1, v));
  } catch (e) { /* storage unavailable */ }

  /* ---------- zvukový řetězec ---------- */
  let M = null;   // { ctx, bus, noise }
  let out = null; // hlasitost hudby
  let wet = null; // dozvuk
  let cur = null; // sběrnice skladby, do které se právě plánuje { dry, send }

  const gainNow = () => (enabled ? 0.5 * level : 0.0001);

  function setup() {
    if (M) return true;
    const m = A.music();
    if (!m) return false;
    build(m, 0.0001);
    return true;
  }

  // řetězec nad daným kontextem (živým, nebo offline pro ukázku)
  function build(m, gain) {
    M = m;
    const ctx = M.ctx;

    out = ctx.createGain();
    out.gain.value = gain;
    // bez podzvukového dunění pod 45 Hz (malé reproduktory ho stejně nezahrají)
    const sub = ctx.createBiquadFilter();
    sub.type = "highpass";
    sub.frequency.value = 45;
    out.connect(sub).connect(M.bus);

    // dozvuk: stereo impulz z doznívajícího šumu (kostel / dřevěnice)
    const len = Math.round(ctx.sampleRate * 2.6);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.4);
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    // dozvuk bez basů, ať se nezahušťuje
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 180;
    wet = ctx.createGain();
    wet.gain.value = 1;
    wet.connect(hp).connect(conv).connect(out);
  }

  // vlastní sběrnice skladby (kvůli prolínání): přímý zvuk + poslání do dozvuku
  function tuneBus(t, wetAmt, fadeIn, gain = 1) {
    const ctx = M.ctx;
    const dry = ctx.createGain();
    const send = ctx.createGain();
    dry.connect(out);
    send.connect(wet);
    const g = [dry.gain, send.gain];
    const lv = [gain, wetAmt * gain];
    g.forEach((p, i) => {
      if (fadeIn) {
        p.setValueAtTime(0.0001, t);
        p.exponentialRampToValueAtTime(lv[i], t + fadeIn);
      } else p.setValueAtTime(lv[i], t);
    });
    return { dry, send };
  }

  function fadeBus(bus, t, secs) {
    for (const p of [bus.dry.gain, bus.send.gain]) {
      p.cancelScheduledValues(t);
      p.setValueAtTime(p.value || 0.0001, t);
      p.setTargetAtTime(0.0001, t, secs / 4);
    }
    // po doznění sběrnici odpojit (jen živý kontext; offline ukázka si poradí sama)
    if (typeof OfflineAudioContext !== "undefined" && bus.dry.context instanceof OfflineAudioContext) return;
    setTimeout(() => { try { bus.dry.disconnect(); bus.send.disconnect(); } catch (e) { /* ignore */ } }, (secs + 4) * 1000);
  }

  // každý nástroj: zdroj -> obálka -> (pan) -> sběrnice skladby + kus do dozvuku
  function voice(t, peak, pan, reverb, make) {
    const ctx = M.ctx;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    let dest = env;

    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      env.connect(p);
      dest = p;
    }

    dest.connect(cur.dry);
    if (reverb) {
      const s = ctx.createGain();
      s.gain.value = reverb;
      dest.connect(s).connect(cur.send);
    }

    make(env, Math.max(0.0002, peak));
    return env;
  }

  function osc(type, f, t, end, dest, detune = 0) {
    const o = M.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    o.detune.value = detune;
    o.connect(dest);
    o.start(t);
    o.stop(end);
    return o;
  }

  function filter(type, f, q = 0.7) {
    const b = M.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }

  function noise(t, end, dest) {
    const n = M.ctx.createBufferSource();
    n.buffer = M.noise;
    n.loop = true;
    n.playbackRate.value = 0.8 + Math.random() * 0.4;
    n.connect(dest);
    n.start(t, Math.random() * 1.5);
    n.stop(end);
    return n;
  }

  function vibrato(oscs, t, end, f, depth, delay, rate = 5.4) {
    const ctx = M.ctx;
    const l = ctx.createOscillator();
    const g = ctx.createGain();
    l.frequency.value = rate + Math.random() * 0.6;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(f * depth, t + delay);
    l.connect(g);
    for (const o of oscs) g.connect(o.frequency);
    l.start(t);
    l.stop(end);
  }

  /* ---------- nástroje ---------- */
  // prim: dvě rozladěné pily přes filtr, smyčcový náběh a vibrato
  function fiddle(t, f, dur, v, pan = -0.15) {
    const end = t + dur + 0.08;
    voice(t, 0.065 * v, pan, 0.35, (env, peak) => {
      const lp = filter("lowpass", 2400, 1.2);
      lp.frequency.setValueAtTime(2400, t);
      lp.frequency.linearRampToValueAtTime(3400, t + Math.min(0.12, dur));
      const hp = filter("highpass", 260);
      lp.connect(hp).connect(env);

      const a = osc("sawtooth", f, t, end, lp, -5);
      const b = osc("sawtooth", f, t, end, lp, 6);
      if (dur > 0.22) vibrato([a, b], t, end, f, 0.006, Math.min(0.2, dur * 0.5));

      env.gain.exponentialRampToValueAtTime(peak, t + 0.025);
      env.gain.exponentialRampToValueAtTime(peak * 0.72, t + Math.min(dur, 0.12));
      env.gain.setValueAtTime(peak * 0.72, t + Math.max(0.03, dur - 0.03));
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.06);
    });
  }

  // sekund: krátký úderný akord (dvojhmat) na doby
  function second(t, freqs, dur, v) {
    const end = t + dur + 0.06;
    voice(t, v, 0.25, 0.25, (env, peak) => {
      const lp = filter("lowpass", 1900);
      lp.connect(env);
      for (const f of freqs) osc("sawtooth", f, t, end, lp, (Math.random() - 0.5) * 10);
      env.gain.exponentialRampToValueAtTime(peak, t + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    });
  }

  // basy: tmavý smyčcový tón
  function bass(t, f, dur, v) {
    const end = t + dur + 0.08;
    voice(t, v, 0, 0.1, (env, peak) => {
      const lp = filter("lowpass", 520, 1.4);
      lp.connect(env);
      osc("sawtooth", f, t, end, lp);
      osc("triangle", f / 2, t, end, lp);
      env.gain.exponentialRampToValueAtTime(peak, t + 0.02);
      env.gain.exponentialRampToValueAtTime(peak * 0.5, t + dur * 0.6);
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    });
  }

  // loutna: drnknutí s rychlým doznětím
  function lute(t, f, v, pan = 0.2, dur = 0.9) {
    voice(t, v, pan, 0.3, (env, peak) => {
      const lp = M.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(3800, t);
      lp.frequency.exponentialRampToValueAtTime(700, t + 0.35);
      lp.connect(env);
      osc("triangle", f, t, t + dur, lp);
      osc("square", f, t, t + dur, lp, 7);
      osc("sine", f * 2, t, t + dur, lp);
      env.gain.exponentialRampToValueAtTime(peak, t + 0.004);
      env.gain.exponentialRampToValueAtTime(peak * 0.35, t + 0.12);
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    });
  }

  // harfa: měkké brnknutí, dlouhé doznění
  function harp(t, f, v, pan = 0.25, dur = 1.8) {
    voice(t, v, pan, 0.45, (env, peak) => {
      const lp = M.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(Math.min(6000, f * 6), t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(400, f * 1.5), t + 0.6);
      lp.connect(env);
      osc("triangle", f, t, t + dur, lp);
      osc("sine", f, t, t + dur, lp, 4);
      osc("sine", f * 3, t, t + 0.3, lp);
      env.gain.exponentialRampToValueAtTime(peak, t + 0.006);
      env.gain.exponentialRampToValueAtTime(peak * 0.4, t + 0.25);
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    });
  }

  // zobcová flétna: čistý tón, dech a lehké vibrato
  function recorder(t, f, dur, v) {
    const end = t + dur + 0.1;
    voice(t, 0.07 * v, -0.2, 0.4, (env, peak) => {
      const a = osc("sine", f, t, end, env);
      const b = osc("triangle", f, t, end, env, 3);
      if (dur > 0.25) vibrato([a, b], t, end, f, 0.004, 0.25);

      const bp = filter("bandpass", f * 2, 6);
      const ng = M.ctx.createGain();
      ng.gain.value = 0.35;
      bp.connect(ng).connect(env);
      noise(t, end, bp);

      env.gain.exponentialRampToValueAtTime(peak, t + 0.05);
      env.gain.setValueAtTime(peak, t + Math.max(0.06, dur - 0.05));
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
    });
  }

  // fujara: hluboká pastýřská píšťala, hodně dechu, náběh zespodu a široké vibrato
  function fujara(t, f, dur, v) {
    const end = t + dur + 0.25;
    voice(t, 0.085 * v, 0.1, 0.55, (env, peak) => {
      const a = osc("sine", f, t, end, env);
      const b = osc("triangle", f, t, end, env, -4);
      const h = M.ctx.createGain();
      h.gain.value = 0.18;
      h.connect(env);
      const c = osc("sine", f * 2, t, end, h);
      // tón „najede“ zespodu
      for (const o of [a, b, c]) {
        o.detune.setValueAtTime(-35, t);
        o.detune.linearRampToValueAtTime(0, t + 0.12);
      }
      if (dur > 0.3) vibrato([a, b, c], t, end, f, 0.008, Math.min(0.5, dur * 0.6), 4.6);

      const bp = filter("bandpass", f * 1.5, 2.5);
      const ng = M.ctx.createGain();
      ng.gain.value = 0.55;
      bp.connect(ng).connect(env);
      noise(t, end, bp);

      env.gain.exponentialRampToValueAtTime(peak, t + 0.12);
      env.gain.setValueAtTime(peak, t + Math.max(0.13, dur - 0.1));
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.22);
    });
  }

  // lesní roh: měkké žesťové „pú“ s otvírajícím se filtrem
  function horn(t, f, dur, v, pan = 0.05) {
    const end = t + dur + 0.2;
    voice(t, 0.07 * v, pan, 0.4, (env, peak) => {
      const lp = filter("lowpass", 400, 1.8);
      lp.frequency.setValueAtTime(Math.max(250, f * 1.2), t);
      lp.frequency.exponentialRampToValueAtTime(Math.min(3200, f * 5), t + 0.09);
      lp.frequency.exponentialRampToValueAtTime(Math.min(2200, f * 3.2), t + 0.4);
      lp.connect(env);
      const a = osc("sawtooth", f, t, end, lp, -4);
      const b = osc("sawtooth", f, t, end, lp, 5);
      const c = osc("triangle", f / 2, t, end, lp);
      if (dur > 0.35) vibrato([a, b, c], t, end, f, 0.003, Math.min(0.4, dur * 0.6), 5);
      env.gain.exponentialRampToValueAtTime(peak, t + 0.06);
      env.gain.exponentialRampToValueAtTime(peak * 0.8, t + 0.2);
      env.gain.setValueAtTime(peak * 0.8, t + Math.max(0.21, dur - 0.05));
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.16);
    });
  }

  // sbor: rozladěné pily přes formanty hlásky „á“, pomalý náběh
  function choir(t, f, dur, v, pan = -0.05, soft = false) {
    const end = t + dur + 0.6;
    voice(t, (soft ? 0.03 : 0.06) * v, pan, 0.6, (env, peak) => {
      const mix = M.ctx.createGain();
      mix.gain.value = 1;
      const f1 = filter("bandpass", 750, 4);
      const f2 = filter("bandpass", 1150, 5);
      const f3 = filter("bandpass", 2600, 6);
      const g3 = M.ctx.createGain();
      g3.gain.value = 0.35;
      mix.connect(f1).connect(env);
      mix.connect(f2).connect(env);
      mix.connect(f3).connect(g3).connect(env);
      const lp = filter("lowpass", 900);
      const gl = M.ctx.createGain();
      gl.gain.value = 0.25;
      mix.connect(lp).connect(gl).connect(env);
      const oscs = [-9, 0, 8].map(d => osc("sawtooth", f, t, end, mix, d + (Math.random() - 0.5) * 4));
      vibrato(oscs, t, end, f, 0.005, 0.5, 4.8);
      const att = soft ? 0.5 : 0.22;
      env.gain.exponentialRampToValueAtTime(peak, t + att);
      env.gain.setValueAtTime(peak, t + Math.max(att + 0.01, dur - 0.1));
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.55);
    });
  }

  // zvony: kovový úder (neharmonické alikvoty), dlouhé doznění
  function bells(t, f, v, pan = 0.15, dur = 2.6) {
    voice(t, 0.05 * v, pan, 0.5, (env, peak) => {
      const parts = [[1, 1, dur], [2.76, 0.4, dur * 0.4], [5.4, 0.2, dur * 0.2], [8.93, 0.08, 0.25]];
      for (const [k, a, d] of parts) {
        const g = M.ctx.createGain();
        g.gain.setValueAtTime(a, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        g.connect(env);
        osc("sine", f * k, t, t + d, g);
      }
      env.gain.exponentialRampToValueAtTime(peak, t + 0.003);
      env.gain.setValueAtTime(peak, t + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    });
  }

  // cimbál: úder paličkou, na dlouhých notách tremolo
  function dulcimer(t, f, dur, v, pan = 0.3) {
    const hits = dur > 0.45 ? Math.floor(dur / 0.11) : 1;
    for (let k = 0; k < hits; k++) {
      const tk = t + k * (dur / hits);
      const vk = v * (k === 0 ? 1 : 0.45 + 0.1 * Math.random());
      voice(tk, 0.06 * vk, pan, 0.35, (env, peak) => {
        const lp = filter("lowpass", 5000);
        lp.frequency.setValueAtTime(Math.min(7000, f * 8), tk);
        lp.frequency.exponentialRampToValueAtTime(Math.max(600, f * 2), tk + 0.3);
        lp.connect(env);
        osc("triangle", f, tk, tk + 0.8, lp, -6);
        osc("triangle", f, tk, tk + 0.8, lp, 6);
        osc("square", f * 2, tk, tk + 0.2, lp);
        env.gain.exponentialRampToValueAtTime(peak, tk + 0.003);
        env.gain.exponentialRampToValueAtTime(peak * 0.3, tk + 0.15);
        env.gain.exponentialRampToValueAtTime(0.0001, tk + 0.75);
      });
    }
  }

  // koza (podhalanské dudy): nosový tón bez doznívání
  function koza(t, f, dur, v, pan = -0.1) {
    const end = t + dur + 0.05;
    voice(t, 0.04 * v, pan, 0.25, (env, peak) => {
      const bp = filter("bandpass", 1300, 1.3);
      const hp = filter("highpass", 300);
      bp.connect(hp).connect(env);
      osc("square", f, t, end, bp, -3);
      osc("sawtooth", f, t, end, bp, 4);
      env.gain.exponentialRampToValueAtTime(peak, t + 0.015);
      env.gain.setValueAtTime(peak, t + Math.max(0.02, dur - 0.02));
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.04);
    });
  }

  // kosti (xylofon nemrtvých): suché krátké klepnutí
  function bone(t, f, dur, v, pan = 0.2) {
    const d = Math.min(0.35, 0.12 + dur * 0.3);
    voice(t, 0.085 * v, pan, 0.3, (env, peak) => {
      const g2 = M.ctx.createGain();
      g2.gain.setValueAtTime(0.5, t);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      g2.connect(env);
      osc("sine", f, t, t + d, env);
      osc("sine", f * 3.93, t, t + 0.06, g2);
      const bp = filter("bandpass", 2500, 3);
      const ng = M.ctx.createGain();
      ng.gain.setValueAtTime(0.5, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
      bp.connect(ng).connect(env);
      noise(t, t + 0.03, bp);
      env.gain.exponentialRampToValueAtTime(peak, t + 0.002);
      env.gain.exponentialRampToValueAtTime(0.0001, t + d);
    });
  }

  // bordun: dudácký prodlevový tón
  function drone(t, f, dur, v, nasal = false) {
    voice(t, v, 0, 0.3, (env, peak) => {
      const lp = filter(nasal ? "bandpass" : "lowpass", nasal ? 900 : 650, nasal ? 0.9 : 0.7);
      lp.connect(env);
      osc(nasal ? "square" : "sawtooth", f, t, t + dur + 0.3, lp, -4);
      osc("sawtooth", f * 1.5, t, t + dur + 0.3, lp, 4);
      env.gain.linearRampToValueAtTime(peak, t + 0.4);
      env.gain.setValueAtTime(peak, t + dur - 0.1);
      env.gain.linearRampToValueAtTime(0.0001, t + dur + 0.25);
    });
  }

  // smyčcový podklad: akord držený celý takt
  function pad(t, freqs, dur, v) {
    voice(t, v, 0, 0.6, (env, peak) => {
      const lp = filter("lowpass", 900, 0.5);
      lp.connect(env);
      for (const f of freqs) {
        osc("sawtooth", f, t, t + dur + 0.8, lp, -7 + Math.random() * 3);
        osc("sawtooth", f, t, t + dur + 0.8, lp, 6 + Math.random() * 3);
      }
      env.gain.linearRampToValueAtTime(peak, t + Math.min(0.6, dur * 0.4));
      env.gain.setValueAtTime(peak, t + dur - 0.05);
      env.gain.linearRampToValueAtTime(0.0001, t + dur + 0.7);
    });
  }

  // bicí: dupnutí / úder do bubnu (low), plesk (high), drobný ťuk (tick) a rolničky (jingle)
  function drum(t, v, kind = "low") {
    if (kind === "jingle") {
      voice(t, v, 0.3, 0.2, (env, peak) => {
        const hp = filter("highpass", 6500);
        hp.connect(env);
        noise(t, t + 0.12, hp);
        env.gain.exponentialRampToValueAtTime(peak, t + 0.003);
        env.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      });
      return;
    }
    const low = kind === "low" || kind === "tom";
    const len = kind === "tom" ? 0.45 : low ? 0.3 : 0.14;
    voice(t, v, kind === "tom" ? -0.1 : 0, 0.15, (env, peak) => {
      const f0 = kind === "tom" ? 110 : low ? 72 : kind === "tick" ? 300 : 120;
      const o = osc("sine", f0, t, t + len, env);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.58, t + len * 0.6);
      const bp = filter("bandpass", low ? 400 : kind === "tick" ? 3200 : 1800);
      const ng = M.ctx.createGain();
      ng.gain.value = low ? 0.6 : 0.9;
      bp.connect(ng).connect(env);
      noise(t, t + 0.12, bp);
      env.gain.exponentialRampToValueAtTime(peak, t + 0.004);
      env.gain.exponentialRampToValueAtTime(0.0001, t + len);
    });
  }

  /* ---------- sólový nástroj ---------- */
  const PLUCK = { harp: 1, lute: 1, bells: 1, bone: 1 };

  function lead(inst, t, f, dur, v, low) {
    switch (inst) {
      case "fiddle": return fiddle(t, f, dur * 0.94, v, low ? 0.3 : -0.15);
      case "recorder": return recorder(t, f, dur * 0.95, v);
      case "fujara": return fujara(t, f, dur * 0.97, v);
      case "horn": return horn(t, f, dur * 0.95, v, low ? -0.2 : 0.05);
      case "choir": return choir(t, f, dur, v, low ? 0.2 : -0.05);
      case "koza": return koza(t, f, dur * 0.97, v);
      case "dulcimer": return dulcimer(t, f, dur, v);
      case "harp": return harp(t, f, 0.1 * v, -0.15, Math.max(1.2, dur * 1.5));
      case "lute": return lute(t, f, 0.085 * v, -0.15, Math.max(0.6, dur * 1.2));
      case "bells": return bells(t, f, v, 0.2, Math.max(1.5, dur * 2));
      case "bone": return bone(t, f, dur, v);
      default: return fiddle(t, f, dur * 0.94, v);
    }
  }

  /* ---------- doprovod, takt po taktu ---------- */
  function accompany(tune, step, h, t0, s, barIndex) {
    const bar = tune.bar;
    const r = h.root + step.tr;
    const root = hz(r);
    const fifth = hz(r + 7);
    const triad = h.tones.map(x => hz(r + 24 + x));
    const T = k => t0 + s * k;
    const v = step.v;

    for (const a of step.acc) {
      if (a === "goral2") {
        // 2/4: basy „hm“ na doby, sekund „pa“ mezi nimi
        for (let k = 0; k < bar; k += 4) {
          bass(T(k), k % 8 === 0 ? root : fifth, s * 1.8, (k % 8 === 0 ? 0.11 : 0.09) * v);
          second(T(k + 2), triad.slice(1), s * 1.3, 0.035 * v);
        }
      } else if (a === "goral3") {
        // 3/4 pomalu: basy drží, sekund na 2. a 3. dobu
        bass(T(0), root, s * 3.6, 0.1 * v);
        second(T(4), triad, s * 2.4, 0.026 * v);
        if (bar >= 12) second(T(8), triad, s * 2.4, 0.022 * v);
      } else if (a === "lute6") {
        // loutna rozkládá akord po osminách
        const steps = [0, 7, 12, h.tones[1] + 12, 12, 7, 0, 7];
        for (let i = 0; i < bar / 2; i++) lute(T(2 * i), hz(r + 12 + steps[i]), (i === 0 ? 0.09 : 0.06) * v);
      } else if (a === "harp") {
        // harfa: arpeggio nahoru a dolů
        const up = [0, h.tones[1], h.tones[2], 12, 12 + h.tones[1], 12, h.tones[2], h.tones[1]];
        for (let i = 0; i < bar / 2; i++) harp(T(2 * i), hz(r + 24 + up[i]), (i === 0 ? 0.075 : 0.05) * v, 0.3);
        if (barIndex % 2 === 0) harp(T(0), root * 2, 0.07 * v, 0, 2.4);
      } else if (a === "dulcimer") {
        // cimbál: rozložený akord v šestnáctinách, tiše
        const pat = [0, 12, h.tones[1] + 12, h.tones[2] + 12];
        for (let k = 0; k < bar; k++) {
          const f = hz(r + 24 + pat[k % 4]);
          voiceDulcimerSoft(T(k), f, (k % 4 === 0 ? 0.32 : 0.2) * v);
        }
        bass(T(0), root, s * 3.5, 0.09 * v);
        if (bar >= 8) bass(T(bar / 2), fifth, s * 3.5, 0.07 * v);
      } else if (a === "ostinato") {
        // válečné ostinato: basy v osminách
        const pat = [0, 0, 12, 0, 0, 0, 12, 7];
        for (let i = 0; i < bar / 2; i++) bass(T(2 * i), hz(r + pat[i]), s * 1.5, (i % 4 === 0 ? 0.12 : 0.085) * v);
      } else if (a === "gallop") {
        // 6/8 cval: basy na 1 a 4, akordy mezi
        bass(T(0), root, s * 2.5, 0.12 * v);
        bass(T(6), fifth, s * 2.5, 0.1 * v);
        for (const k of [2, 4, 8, 10]) second(T(k), triad.slice(1), s * 1.2, 0.03 * v);
      } else if (a === "waltz") {
        // valčík: basy na 1, brnknutý akord na 2 a 3
        bass(T(0), root, s * 3.6, 0.1 * v);
        for (const k of [4, 8]) for (const f of triad) harp(T(k), f, 0.035 * v, 0.25, 0.9);
      } else if (a === "pad") {
        pad(t0, h.tones.map(x => hz(r + 12 + x)), s * bar, 0.022 * v);
        if (barIndex % 2 === 0) bass(t0, root * 2, s * bar * 1.8, 0.05 * v);
      } else if (a === "choirpad") {
        for (const x of h.tones.slice(0, 3)) choir(t0, hz(r + 24 + x), s * bar, 0.5 * v, (x - 3) * 0.06, true);
      } else if (a === "drone") {
        const d = step.drone ? midi(step.drone) + step.tr : null;
        if (barIndex % 2 === 0) drone(t0, d != null ? hz(d) : root, s * bar * 2, 0.032 * v);
      } else if (a === "kozadrone") {
        const d = (step.drone ? midi(step.drone) : r) + step.tr;
        if (barIndex % 2 === 0) drone(t0, hz(d + 12), s * bar * 2, 0.028 * v, true);
      }
    }
  }

  // tichý cimbálový doprovod (bez tremola)
  function voiceDulcimerSoft(t, f, v) {
    voice(t, 0.05 * v, 0.35, 0.3, (env, peak) => {
      const lp = filter("lowpass", 3000);
      lp.connect(env);
      osc("triangle", f, t, t + 0.5, lp, -5);
      osc("triangle", f, t, t + 0.5, lp, 5);
      env.gain.exponentialRampToValueAtTime(peak, t + 0.003);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    });
  }

  function percussion(kind, bar, t0, s, v) {
    if (!kind) return;
    const T = k => t0 + s * k;
    if (kind === "goral" || kind === "war2") {
      for (let k = 0; k < bar; k += 4) drum(T(k), (k % 8 === 0 ? 0.22 : 0.18) * v, "low");
      for (let k = 2; k < bar; k += 4) drum(T(k), 0.06 * v, "high");
      if (kind === "war2") {
        drum(T(0), 0.16 * v, "tom");
        drum(T(bar - 1), 0.07 * v, "high");
        for (let k = 1; k < bar; k += 2) drum(T(k), 0.03 * v, "tick");
      }
    } else if (kind === "frame") {
      // bubínek s rolničkami
      for (let k = 0; k < bar; k += bar === 12 ? 6 : 4) drum(T(k), 0.12 * v, "low");
      for (let k = 2; k < bar; k += 2) if (k % (bar === 12 ? 6 : 4)) drum(T(k), 0.05 * v, "jingle");
    } else if (kind === "war") {
      for (const k of [0, 6, 8]) drum(T(k), 0.22 * v, "low");
      for (const k of [4, 12]) drum(T(k), 0.14 * v, "tom");
      drum(T(14), 0.1 * v, "tom");
      for (const k of [10, 15]) drum(T(k), 0.05 * v, "high");
    } else if (kind === "war6") {
      for (const k of [0, 6]) drum(T(k), 0.22 * v, "low");
      for (const k of [3, 9]) drum(T(k), 0.12 * v, "tom");
      for (const k of [10, 11]) drum(T(k), 0.05 * v, "high");
    } else if (kind === "heart") {
      for (let k = 0; k < bar; k += 8) {
        drum(T(k), 0.16 * v, "low");
        drum(T(k + 1.5), 0.1 * v, "low");
      }
    } else if (kind === "march") {
      drum(T(0), 0.16 * v, "low");
      drum(T(8), 0.13 * v, "low");
      for (const k of [4, 12]) drum(T(k), 0.08 * v, "high");
      for (const k of [14, 15]) drum(T(k), 0.04 * v, "high");
    } else if (kind === "roll") {
      // vířivé tympány a velký úder na konec
      for (let k = 0; k < bar; k += 0.5) drum(T(k), (0.03 + 0.08 * k / bar) * v, "tom");
      drum(T(bar), 0.25 * v, "low");
    }
  }

  /* ---------- přehrávač ---------- */
  let want = "menu";     // nálada, kterou hra chce
  let scene = "menu";    // nálada, která hraje
  let play = null;       // { tune, step, part, i, t, bar, barT, bus }
  let nextAt = 0;        // kdy začne další skladba (po tichu)
  let lastId = "";
  let stingerDone = "";  // znělka win/lose už dohrála -> dál menu
  const bags = {};
  let onTrack = null;

  // skutečná nálada: po dohrané znělce hraje menu
  const effective = w => (w === "win" || w === "lose") && stingerDone === w ? "menu" : w;

  // zamíchaný sáček skladeb nálady, žádná dvakrát po sobě
  function pick(sc) {
    const pool = POOLS[sc] || POOLS.menu;
    if (pool.length === 1) return pool[0];
    let bag = bags[sc];
    if (!bag || !bag.length) {
      bag = pool.slice();
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      if (bag[bag.length - 1].id === lastId) bag.unshift(bag.pop());
      bags[sc] = bag;
    }
    let k = bag.length - 1;
    if (bag[k].id === lastId && k > 0) k--;
    return bag.splice(k, 1)[0];
  }

  function start(t, tune, fadeIn = 0) {
    scene = effective(want);
    tune = tune || pick(scene);
    lastId = tune.id;
    play = { tune, step: 0, t, bus: tuneBus(t, tune.wet || 0.3, fadeIn, tune.gain || 1) };
    beginStep(t);
    if (onTrack && !rendering) setTimeout(() => onTrack && onTrack(current()), Math.max(0, (t - M.ctx.currentTime) * 1000));
  }

  function beginStep(t) {
    const st = play.tune.form[play.step];
    play.st = st;
    play.part = play.tune.parts[st.s];
    play.i = 0;
    play.t = t;
    play.bar = 0;
    play.barT = t;
  }

  // ukončí skladbu: doznění + ticho, než začne další
  function finish(t) {
    const sc = scene;
    if (play.tune.once) stingerDone = want;
    fadeBus(play.bus, t + 1.5, 3);
    play = null;
    const [a, b] = GAP[sc] || [3, 6];
    nextAt = t + a + Math.random() * (b - a);
  }

  // rychlé prolnutí do jiné nálady (boj, konec zápasu, menu)
  function crossfade(now, tune) {
    if (play) fadeBus(play.bus, now, 2.5);
    play = null;
    start(now + 0.6, tune, 1.2);
  }

  const HARD = new Set(["menu", "battle", "undead-battle", "win", "lose"]);

  function tick() {
    if (!M || !enabled || !A.running || rendering) return;

    const now = M.ctx.currentTime;
    // po pauze (ztlumení, skrytá záložka) se zmeškané noty nedohánějí, hraje se dál od teď
    if (play && play.t < now - 0.15) {
      fadeBus(play.bus, now, 0.5);
      play = null;
      nextAt = now + 0.3;
    }
    const target = effective(want);
    if (target !== scene && (HARD.has(target) || HARD.has(scene))) {
      if (play || nextAt > now + 1.5) crossfade(now);
      else scene = target;
    }
    plan(now, now + 0.35);
  }

  function plan(now, ahead) {
    for (;;) {
      if (!play) {
        if (rendering) return; // ukázka = jedna skladba
        if (nextAt < now) nextAt = now + 0.2;
        if (nextAt >= ahead) return;
        start(nextAt);
      }

      const { tune, st, part } = play;
      const s = 60 / tune.tempo / 4;
      cur = play.bus;

      // doprovod a bicí plánované po taktech
      while (play.barT < ahead && play.bar < part.harm.length) {
        accompany(tune, st, part.harm[play.bar], play.barT, s, play.bar);
        percussion(st.drums, tune.bar, play.barT, s, st.v);
        play.bar++;
        play.barT += tune.bar * s;
      }

      if (play.t >= ahead) return;

      if (play.i >= part.notes.length) {
        // průchod skončil: jemná změna nálady (den/noc) přejde tady, jinak další průchod
        const sc = effective(want);
        play.step++;
        if (play.step >= tune.form.length || sc !== scene) finish(play.t);
        else beginStep(play.t);
        continue;
      }

      const note = part.notes[play.i];
      const dur = note.len * s;

      if (note.n != null) {
        // drobné „lidské“ zaváhání a síla úhozu
        const jt = play.t + (Math.random() - 0.5) * 0.008;
        const v = st.v * (0.9 + Math.random() * 0.2);
        const n = note.n + st.tr + st.oct;
        // ozdoba: u houslí a kozy občas krátký příraz shora na dlouhé notě
        if ((st.lead === "fiddle" || st.lead === "koza") && note.len >= 4 && Math.random() < 0.25) {
          lead(st.lead, jt, hz(n + 2), 0.05, v * 0.7);
          lead(st.lead, jt + 0.05, hz(n), dur - 0.05, v);
        } else {
          lead(st.lead, jt, hz(n), dur, v);
        }
        if (st.lead2 != null) {
          const inst = st.lead2i || st.lead;
          const quiet = PLUCK[inst] ? 0.7 : 0.5;
          lead(inst, jt, hz(n + st.lead2), dur, v * quiet, st.lead2 < 0);
        }
      }

      play.t += dur;
      play.i++;
    }
  }

  setInterval(tick, 70);

  function current() {
    const t = play ? play.tune : null;
    return t ? { id: t.id, name: t.name, scene } : null;
  }

  // Ukázka pro ladění: vyrenderuje skladbu (id) nebo náladu offline do AudioBufferu (bez vlivu na hru).
  let rendering = false;

  async function render(what, seconds, rate = 44100) {
    const saved = { M, out, wet, cur, play, scene, want, lastId, nextAt, stingerDone };
    rendering = true;

    try {
      const tune = TUNES.find(t => t.id === what);
      if (!seconds) {
        // celá skladba + doznění
        seconds = tune
          ? tune.form.reduce((sum, st) => sum + tune.parts[st.s].length * 15 / tune.tempo, 0) + 4
          : 30;
      }
      const off = new OfflineAudioContext(2, Math.round(rate * seconds), rate);
      const bus = off.createGain();
      bus.connect(off.destination);
      const noiseBuf = off.createBuffer(1, rate * 2, rate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

      build({ ctx: off, bus, noise: noiseBuf }, 0.5);
      want = scene = tune ? tune.scenes[0] : what;
      stingerDone = "";
      play = null;
      nextAt = 0.2;
      start(0.2, tune || null);
      // jen jedna skladba: po jejím konci už nic nezačínat
      const end = seconds - 0.5;
      for (let t = 0; t < end; t += 0.5) {
        plan(t, Math.min(end, t + 0.5));
        if (tune && !play) break;
      }
      return await off.startRendering();
    } finally {
      ({ M, out, wet, cur, play, scene, want, lastId, nextAt, stingerDone } = saved);
      rendering = false;
    }
  }

  function refresh() {
    if (!out) return;
    out.gain.setTargetAtTime(gainNow(), M.ctx.currentTime, 0.6);
  }

  PK.music = {
    // menu | peace | night | battle | undead | undead-battle | win | lose
    setScene(next) {
      if (next !== want) {
        want = next;
        if (next !== "win" && next !== "lose") stingerDone = "";
      }
      if (!M && A.running && setup()) refresh();
    },
    unlock() {
      if (setup()) refresh();
    },
    // přeskočí na jinou skladbu stejné nálady
    next() {
      if (!M || !enabled || !A.running) return;
      const now = M.ctx.currentTime;
      const sc = effective(want);
      crossfade(now, pick(sc));
    },
    setEnabled(v) {
      enabled = !!v;
      try { localStorage.setItem("pk-music", enabled ? "1" : "0"); } catch (e) { /* ignore */ }
      if (enabled) setup();
      if (!enabled && play) {
        fadeBus(play.bus, M.ctx.currentTime, 0.5);
        play = null;
      }
      refresh();
      if (onTrack) onTrack(current());
    },
    setLevel(v) {
      level = Math.max(0, Math.min(1, v));
      try { localStorage.setItem("pk-music-vol", String(level)); } catch (e) { /* ignore */ }
      refresh();
    },
    set onTrack(fn) { onTrack = fn; },
    get current() { return current(); },
    get enabled() { return enabled; },
    get level() { return level; },
    get scene() { return scene; },
    render,
    tunes: TUNES.map(t => ({ id: t.id, name: t.name, scenes: t.scenes.slice() })),
    _tunes: TUNES
  };
})();
