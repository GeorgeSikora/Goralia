/*
 * Mapy s krajinami (biomy) pro generátor tools/genmaps.js.
 * Každá mapa je symetrická (zrcadlově nebo otočně), takže lesy, doly i terén jsou pro všechny hráče stejné.
 * Souřadnice: základny a doly v logických jednotkách, voda, cesty, hory, krajiny a popel v art px.
 */
"use strict";

module.exports = ({ makers, Draft, grid, gridRoads }) => {
  // body kružnice / elipsy (art px), uzavřená lomená čára
  const ring = (cx, cy, rx, ry, n = 24, a0 = 0) => {
    const pts = [];
    for (let k = 0; k <= n; k++) {
      const a = a0 + (k / n) * Math.PI * 2;
      pts.push([Math.round((cx + Math.cos(a) * rx) * 10) / 10, Math.round((cy + Math.sin(a) * ry) * 10) / 10]);
    }
    return pts;
  };
  const arc = (cx, cy, rx, ry, a0, a1, n = 8) => {
    const pts = [];
    for (let k = 0; k <= n; k++) {
      const a = a0 + ((a1 - a0) * k) / n;
      pts.push([Math.round((cx + Math.cos(a) * rx) * 10) / 10, Math.round((cy + Math.sin(a) * ry) * 10) / 10]);
    }
    return pts;
  };
  const deg = d => (d * Math.PI) / 180;
  // plácek před radnicí (art px), odkud vedou cesty; stejně jako autoTerrain
  const plaza = (d, i) => {
    const b = d.bases[i];
    return [b.x / 2, b.y / 2 + (b.y <= d.LH / 2 ? 17 : -17)];
  };

  /* ================= 2 hráči ================= */

  makers.push(() => {
    const d = new Draft("ostrovy-a-brody", "Ostrovy a brody",
      "Řeka se uprostřed rozdělí na dvě ramena a obtéká ostrov se dvěma doly. Na ostrov i na druhý břeh se jde jen brody na cestách; u základen leží klidná jezírka.",
      900, 560, 2101);
    d.base(330, 560);
    d.base(1470, 560);
    d.symmetric(true, false);
    // kmen řeky ze severu, dvě ramena kolem ostrova, kmen na jih
    d.river([[452, 0], [448, 60], [450, 118]], 10, 2);
    d.river([[450, 442], [452, 500], [450, 560]], 10, 2);
    d.symRiver([[450, 112], [405, 165], [382, 230], [384, 330], [405, 395], [450, 448]], 9, 3);
    // jezírka u základen s potůčkem od kraje mapy
    const pond = { cx: 190, cy: 112, rx: 44, ry: 26 };
    d.symLake(pond.cx, pond.cy, pond.rx, pond.ry);
    d.symRiver([[150, 0], [158, 40], [175, 95]], 4, 2);
    // cesty: hlavní přes ostrov (dva brody), severní a jižní brodem přes kmen řeky
    const p = plaza(d, 0);
    d.symRoad([p, [260, 292], [340, 284], [450, 280]], 8, true, 2);
    d.symRoad([p, [205, 205], [300, 140], [400, 92], [450, 86]], 6, true, 3);
    d.symRoad([p, [210, 390], [320, 455], [410, 490], [450, 494]], 6, true, 3);
    // skalnaté rohy
    d.symRidge([[30, 470], [100, 500], [170, 520]], 12);
    d.symRidge([[300, 25], [360, 18]], 10);
    d.symBiome("autumn", 450, 280, 64); // ostrov hraje podzimními barvami
    d.symGold([[900, 470], [900, 650], [690, 210]]);
    d.scatterTreesSym(300);
    return d;
  });

  makers.push(() => {
    const d = new Draft("mlzna-bazina", "Mlžná bažina",
      "Základny stojí na suchých loukách, mezi nimi se táhnou tůně, potůčky a mlhou zahalené vrbiny. Pěšiny vedou kolem vody a brody přes ni.",
      880, 540, 2202);
    d.theme = "swamp";
    d.base(320, 540);
    d.base(1440, 540);
    d.symmetric(true, false);
    const north = { cx: 440, cy: 120, rx: 46, ry: 34 };
    const south = { cx: 440, cy: 430, rx: 50, ry: 34 };
    d.lake(north.cx, north.cy, north.rx, north.ry);
    d.lake(south.cx, south.cy, south.rx, south.ry);
    d.stream([[442, 0], [438, 40], [441, 70]], 5, north, 2);
    d.stream([[440, 540], [444, 500], [440, 470]], 5, south, 2);
    d.symLake(290, 92, 40, 24);
    d.symLake(120, 470, 44, 24);
    d.symLake(330, 390, 26, 18);
    // potůček z tůně do středního jezírka
    d.symRiver([[322, 100], [365, 112], [404, 118]], 4, 2);
    d.symRiver([[150, 470], [220, 455], [300, 440], [350, 434], [400, 432]], 4, 3);
    const p = plaza(d, 0);
    d.symRoad([p, [250, 296], [330, 260], [400, 268], [440, 270]], 7, true, 3);
    d.symRoad([p, [190, 200], [250, 160], [360, 170], [440, 176]], 5, false, 3);
    d.symRoad([p, [200, 380], [260, 470], [360, 495], [440, 500]], 5, true, 3);
    d.symBiome("meadow", 160, 270, 95);
    d.symGold([[880, 640], [590, 250], [700, 880]]);
    d.scatterTreesSym(380, { spread: 110 });
    return d;
  });

  makers.push(() => {
    const d = new Draft("zamrzle-jezero", "Zamrzlé jezero",
      "Zimní mapa. Uprostřed leží zamrzlé jezero, do kterého stékají potoky z hor. Cesty ho obcházejí ze severu a z jihu přes brody.",
      840, 560, 2303);
    d.theme = "winter";
    d.base(320, 560);
    d.base(1360, 560);
    d.symmetric(true, false);
    const lake = { cx: 420, cy: 280, rx: 86, ry: 72 };
    d.lake(lake.cx, lake.cy, lake.rx, lake.ry);
    d.stream([[421, 0], [417, 70], [423, 150]], 6, lake, 3);
    d.stream([[419, 560], [423, 490], [418, 410]], 6, lake, 3);
    d.symLake(165, 470, 36, 22);
    d.symRidge([[340, 22], [372, 52], [388, 92]], 12);
    d.symRidge([[340, 538], [372, 508], [388, 470]], 12);
    d.symRidge([[30, 60], [90, 40], [150, 46]], 12);
    const p = plaza(d, 0);
    d.symRoad([p, [240, 220], [320, 165], [420, 150]], 7, true, 3);
    d.symRoad([p, [240, 360], [320, 405], [420, 418]], 7, true, 3);
    d.symGold([[660, 220], [660, 900]]);
    d.scatterTreesSym(300);
    return d;
  });

  makers.push(() => {
    const d = new Draft("podzimni-hvozd", "Podzimní hvozd",
      "Hustý podzimní les plný dřeva. Tři cesty vedou přes potok, který vytéká z lesního jezírka; mezi nimi jsou mýtiny s doly.",
      920, 540, 2404);
    d.theme = "autumn";
    d.base(320, 540);
    d.base(1520, 540);
    d.symmetric(true, false);
    const lake = { cx: 460, cy: 86, rx: 54, ry: 32 };
    d.lake(lake.cx, lake.cy, lake.rx, lake.ry);
    d.stream([[461, 0], [458, 30]], 5, lake, 1);
    d.river([[460, 100], [455, 220], [466, 330], [458, 440], [460, 540]], 6, 4);
    const p = plaza(d, 0);
    d.symRoad([p, [300, 275], [460, 270]], 8, true, 3);
    d.symRoad([p, [220, 190], [320, 160], [460, 158]], 6, true, 4);
    d.symRoad([p, [220, 380], [320, 420], [460, 430]], 6, true, 4);
    d.symRidge([[30, 480], [90, 510], [160, 520]], 12);
    d.symBiome("meadow", 160, 270, 70);
    d.symGold([[640, 330], [640, 760]]);
    d.scatterTreesSym(520, { extraCenters: [[700, 440], [700, 650], [860, 440], [860, 660], [560, 160], [560, 900]], spread: 120 });
    return d;
  });

  makers.push(() => {
    const d = new Draft("kamenny-kanon", "Kamenný kaňon",
      "Vysočina s vřesem. Dlouhým kaňonem vede hlavní cesta, nad ním jsou horská jezera a sněhem pokryté vrcholy. Do kaňonu se dá sejít dvěma průsmyky z každé strany.",
      1000, 480, 2505);
    d.theme = "highland";
    d.base(300, 480);
    d.base(1700, 480);
    d.symmetric(true, false);
    // hřebeny nad a pod kaňonem s průsmyky
    d.symRidge([[270, 150], [360, 142]], 16, 2);
    d.symRidge([[425, 146], [500, 150]], 16, 2);
    d.symRidge([[270, 330], [360, 338]], 16, 2);
    d.symRidge([[425, 334], [500, 330]], 16, 2);
    d.symLake(330, 60, 34, 20);
    d.symLake(330, 420, 34, 20);
    d.symBiome("winter", 470, 150, 46);
    d.symBiome("winter", 470, 330, 46);
    const p = plaza(d, 0);
    d.symRoad([p, [260, 240], [380, 240], [500, 240]], 8, true, 2);
    d.symRoad([p, [200, 130], [300, 100], [390, 96], [500, 96]], 6, true, 3);
    d.symRoad([p, [200, 350], [300, 385], [390, 392], [500, 392]], 6, true, 3);
    d.symRoad([[392, 97], [392, 170], [395, 240]], 5, false, 2);
    d.symRoad([[392, 391], [392, 310], [395, 240]], 5, false, 2);
    d.symGold([[1000, 400], [1000, 570], [720, 140], [720, 820]]);
    d.scatterTreesSym(300);
    return d;
  });

  /* ================= 3 hráči ================= */

  makers.push(() => {
    const d = new Draft("tri-krajiny", "Tři krajiny",
      "Tři království, tři krajiny: zelená louka, podzimní lesy a zasněžené pláně. Potoky z kraje mapy stékají do jezera uprostřed a cesta kolem něj je propojuje brody.",
      1000, 1000, 2606);
    const C = 1000;
    d.base(C, C + 640);
    d.base(Math.round(C - 640 * Math.cos(deg(30))), Math.round(C - 640 * Math.sin(deg(30))));
    d.base(Math.round(C + 640 * Math.cos(deg(30))), Math.round(C - 640 * Math.sin(deg(30))));
    d.rotational(3);
    d.lake(500, 500, 74, 70);
    d.symLake(500, 70, 34, 22);
    d.symRiver([[500, 88], [496, 200], [505, 320], [500, 440]], 6, 3);
    d.symRidge([[390, 70], [440, 120]], 12);
    d.symRidge([[610, 70], [560, 120]], 12);
    // okružní cesta kolem jezera s brody a paprsky k základnám
    d.road(ring(500, 500, 150, 150, 30, deg(15)), 7, true, 0);
    d.symRoad([plaza(d, 0), [500, 760], [500, 650]], 8, true, 2);
    d.biomes.push(["autumn", Math.round(d.bases[1].x / 2), Math.round(d.bases[1].y / 2), 300]);
    d.biomes.push(["winter", Math.round(d.bases[2].x / 2), Math.round(d.bases[2].y / 2), 300]);
    d.symGold([[1000, 330], [1000, 1290]]);
    d.scatterTreesSym(450);
    return d;
  });

  makers.push(() => {
    const d = new Draft("vresovy-vrch", "Vřesový vrch",
      "Uprostřed se zvedá zasněžený masiv se třemi hřebeny, pod ním leží horská plesa. Okružní cesta vede kolem hor; o doly mezi hřebeny se přou vždy dva sousedé.",
      940, 940, 2707);
    d.theme = "highland";
    const C = 940;
    d.base(C, C + 620);
    d.base(Math.round(C - 620 * Math.cos(deg(30))), Math.round(C - 620 * Math.sin(deg(30))));
    d.base(Math.round(C + 620 * Math.cos(deg(30))), Math.round(C - 620 * Math.sin(deg(30))));
    d.rotational(3);
    d.symRidge([[470, 470], [472, 400], [468, 340]], 26, 2);
    // pramen pod zasněženým hřebenem stéká do horského plesa na okraji mapy (okružní cestu přechází brodem)
    d.symLake(470, 95, 44, 26);
    d.symRiver([[469, 316], [473, 250], [466, 180], [470, 105]], 5, 3);
    d.biomes.push(["winter", 470, 470, 120]);
    d.road(ring(470, 470, 215, 215, 30, deg(10)), 7, true, 0);
    d.symRoad([plaza(d, 0), [470, 720], [470, 685]], 8, true, 2);
    d.symGold([[940, 400]]);
    d.symGold([[760, 1300]]);
    d.symRidge([[330, 880], [380, 905]], 10);
    d.scatterTreesSym(380);
    return d;
  });

  /* ================= 4 hráči ================= */

  makers.push(() => {
    const d = new Draft("ricni-delta", "Říční delta",
      "Velká řeka se rozvětví do tří ramen, která se vlévají do laguny na jihu. Severní království dělí jeden brod, jižní tři. Mezi rameny leží bažinaté ostrůvky s doly.",
      1200, 800, 2808);
    d.theme = "swamp";
    d.base(420, 440);
    d.base(1980, 440);
    d.base(420, 1160);
    d.base(1980, 1160);
    d.symmetric(true, false);
    const lagoon = { cx: 600, cy: 770, rx: 190, ry: 60 };
    d.lake(lagoon.cx, lagoon.cy, lagoon.rx, lagoon.ry);
    d.river([[601, 0], [597, 120], [600, 250]], 11, 3);
    d.river([[600, 250], [604, 400], [598, 560], [600, 720]], 8, 3);
    d.symRiver([[600, 250], [520, 330], [470, 450], [455, 600], [470, 740]], 8, 4);
    d.symLake(150, 90, 40, 24);
    d.symBiome("meadow", 210, 230, 130);
    d.symBiome("meadow", 210, 570, 120);
    const pn = plaza(d, 0);
    const ps = plaza(d, 2);
    d.symRoad([pn, [350, 200], [500, 195], [600, 196]], 7, true, 3);
    d.symRoad([ps, [360, 560], [460, 520], [540, 500], [600, 500]], 7, true, 3);
    d.symRoad([pn, [130, 300], [125, 400], [135, 470], ps], 7, true, 3);
    d.symRidge([[30, 720], [90, 760], [170, 770]], 12);
    d.symGold([[1060, 1000], [1060, 520], [840, 700]]);
    d.scatterTreesSym(500, { spread: 115 });
    return d;
  });

  makers.push(() => {
    const d = new Draft("spalene-plane", "Spálené pláně",
      "Pustina po válce s nemrtvými. Čtyři poslední zelené oázy obklopuje popel a seschlá tráva; uprostřed leží kráter se skalním valem a bohatými doly.",
      1100, 760, 2909);
    d.theme = "wastes";
    d.base(420, 400);
    d.base(1780, 400);
    d.base(420, 1120);
    d.base(1780, 1120);
    d.symmetric(true, true);
    d.ash.push([550, 380, 150]);
    d.symAsh(330, 120, 70);
    d.symAsh(80, 380, 60);
    d.symBiome("meadow", 210, 205, 95);
    // val kráteru: oblouky nad osami, mezery na úhlopříčkách pro cesty
    d.symRidge(arc(550, 380, 175, 130, deg(-25), deg(25), 6), 13, 1);
    d.symRidge(arc(550, 380, 175, 130, deg(65), deg(115), 6), 13, 1);
    d.symLake(300, 300, 26, 16);
    const p = plaza(d, 0);
    d.symRoad([p, [330, 260], [430, 310], [490, 345]], 7, true, 2);
    d.symRoad([p, [380, 200], [550, 190]], 6, true, 3);
    d.symRoad([p, [190, 300], [195, 380]], 6, true, 3);
    d.symGold([[1000, 690], [1100, 540]]);
    d.scatterTreesSym(300, { spread: 110 });
    return d;
  });

  makers.push(() => {
    const d = new Draft("zimni-prusmyky", "Zimní průsmyky",
      "Zimní mapa. Pohoří ve tvaru kříže dělí kraj na čtvrtiny a uprostřed leží zamrzlé jezero. Mezi sousedy vede vždy jen jeden průsmyk.",
      1100, 800, 3010);
    d.theme = "winter";
    d.base(420, 420);
    d.base(1780, 420);
    d.base(420, 1180);
    d.base(1780, 1180);
    d.symmetric(true, true);
    d.lake(550, 400, 74, 56);
    d.symRidge([[640, 400], [720, 398], [800, 402]], 20, 2);
    d.symRidge([[870, 400], [960, 396], [1070, 400]], 20, 2);
    d.symRidge([[550, 470], [552, 560]], 20, 2);
    d.symRidge([[550, 640], [548, 710], [550, 790]], 20, 2);
    const p = plaza(d, 0);
    d.symRoad([p, [380, 212], [470, 205], [550, 200]], 7, true, 3);
    d.symRoad([p, [240, 300], [262, 360], [262, 400]], 7, true, 2);
    d.symLake(140, 110, 36, 22);
    d.symGold([[860, 600], [560, 120]]);
    d.scatterTreesSym(360);
    return d;
  });

  makers.push(() => {
    const d = new Draft("jezerni-kraj", "Jezerní kraj",
      "Čtyři potoky stékají z kraje mapy do velkého jezera uprostřed. Okružní cesta kolem jezera má čtyři brody, na březích čekají doly a podzimní háje.",
      1100, 760, 3111);
    d.base(420, 400);
    d.base(1780, 400);
    d.base(420, 1120);
    d.base(1780, 1120);
    d.symmetric(true, true);
    const lake = { cx: 550, cy: 380, rx: 130, ry: 88 };
    d.lake(lake.cx, lake.cy, lake.rx, lake.ry);
    d.stream([[551, 0], [546, 120], [552, 230]], 7, lake, 3);
    d.stream([[549, 760], [554, 640], [548, 530]], 7, lake, 3);
    d.stream([[0, 381], [150, 376], [300, 384], [400, 380]], 7, lake, 3);
    d.stream([[1100, 379], [950, 384], [800, 376], [700, 380]], 7, lake, 3);
    d.road(ring(550, 380, 200, 150, 32, deg(30)), 7, true, 0);
    const p = plaza(d, 0);
    d.symRoad([p, [320, 250], [395, 278]], 7, true, 2);
    d.symRoad([p, [380, 170], [470, 140], [550, 132]], 6, false, 3);
    d.symLake(140, 110, 40, 24);
    d.symBiome("autumn", 330, 120, 95);
    d.symBiome("autumn", 80, 250, 60);
    d.symGold([[820, 480], [1100, 200]]);
    d.scatterTreesSym(420);
    return d;
  });

  makers.push(() => {
    const d = new Draft("vresoviste", "Vřesoviště",
      "Zvlněná vysočina s vřesem, skalními výchozy a horským plesem uprostřed. Potok teče od severu k jihu, přejít se dá třemi brody.",
      1200, 700, 3212);
    d.theme = "highland";
    d.base(400, 380);
    d.base(2000, 380);
    d.base(400, 1020);
    d.base(2000, 1020);
    d.symmetric(true, true);
    const tarn = { cx: 600, cy: 350, rx: 56, ry: 42 };
    d.lake(tarn.cx, tarn.cy, tarn.rx, tarn.ry);
    d.stream([[601, 0], [596, 120], [603, 240]], 6, tarn, 3);
    d.stream([[599, 700], [604, 580], [597, 460]], 6, tarn, 3);
    d.symRidge([[390, 300], [430, 330]], 11);
    d.symRidge([[300, 60], [360, 48], [420, 62]], 12);
    d.symRidge([[30, 300], [24, 350]], 12);
    d.symRidge([[740, 160], [790, 190]], 10);
    d.symBiome("winter", 400, 40, 60);
    const p = plaza(d, 0);
    d.symRoad([p, [380, 185], [500, 175], [600, 172]], 7, true, 3);
    d.symRoad([p, [300, 280], [470, 330], [540, 350]], 6, true, 3);
    d.symRoad([p, [140, 300], [140, 350]], 6, true, 2);
    d.symGold([[900, 540], [650, 700], [1200, 70]]);
    d.scatterTreesSym(380);
    return d;
  });

  /* ================= 6 hráčů ================= */

  makers.push(() => {
    const d = new Draft("sest-ostrovu", "Šest ostrovů",
      "Šest království na ostrovech. Mezi nimi tečou široké průplavy, které se stékají do dvou bažinatých jezer; na sousední ostrov se jde jen brody na cestách.",
      1500, 1000, 3313);
    const pos = grid(d, 3, 2, 1000, 960);
    d.symmetric(true, true);
    d.lake(500, 500, 66, 50);
    d.lake(1000, 500, 66, 50);
    d.river([[501, 0], [497, 150], [503, 300], [500, 450]], 11, 3);
    d.river([[1001, 0], [997, 150], [1003, 300], [1000, 450]], 11, 3);
    d.river([[499, 1000], [503, 850], [497, 700], [500, 550]], 11, 3);
    d.river([[999, 1000], [1003, 850], [997, 700], [1000, 550]], 11, 3);
    d.river([[0, 500], [150, 496], [300, 504], [440, 500]], 11, 3);
    d.river([[560, 500], [750, 504], [940, 500]], 11, 3);
    d.river([[1060, 500], [1200, 504], [1350, 496], [1500, 500]], 11, 3);
    gridRoads(d, pos, 3, 2, 7);
    d.symBiome("swamp", 500, 500, 120);
    d.symRidge([[60, 60], [130, 45], [200, 60]], 12);
    d.symGold([[1250, 760], [250, 760]]);
    d.scatterTreesSym(520);
    return d;
  });

  makers.push(() => {
    const d = new Draft("podzimni-kraje", "Podzimní kraje",
      "Šest království v podzimní krajině. Dvě řeky tečou přes lesní jezera, mezi nimi se zvedá skalnatá vysočina s vřesem.",
      1500, 900, 3414);
    d.theme = "autumn";
    const pos = grid(d, 3, 2, 1000, 900);
    d.symmetric(true, true);
    const l1 = { cx: 500, cy: 450, rx: 60, ry: 48 };
    const l2 = { cx: 1000, cy: 450, rx: 60, ry: 48 };
    d.lake(l1.cx, l1.cy, l1.rx, l1.ry);
    d.lake(l2.cx, l2.cy, l2.rx, l2.ry);
    d.stream([[501, 0], [496, 150], [504, 300], [500, 380]], 8, l1, 3);
    d.stream([[499, 900], [504, 750], [496, 600], [500, 520]], 8, l1, 3);
    d.stream([[1001, 0], [996, 150], [1004, 300], [1000, 380]], 8, l2, 3);
    d.stream([[999, 900], [1004, 750], [996, 600], [1000, 520]], 8, l2, 3);
    gridRoads(d, pos, 3, 2, 7);
    d.symRidge([[690, 420], [730, 400]], 14);
    d.symRidge([[690, 480], [730, 500]], 14);
    d.biomes.push(["highland", 750, 450, 130]);
    d.symBiome("meadow", 250, 225, 80);
    d.symRidge([[60, 420], [50, 480]], 12);
    d.symGold([[1250, 900], [1500, 140]]);
    d.scatterTreesSym(560);
    return d;
  });

  /* ================= 8 hráčů ================= */

  makers.push(() => {
    const d = new Draft("souostrovi", "Souostroví",
      "Osm ostrovních království ve dvou řadách. Průplavy mezi ostrovy se sbíhají do tří jezer, každý soused je za brodem.",
      1800, 1000, 3515);
    const pos = grid(d, 4, 2, 900, 1000);
    d.symmetric(true, true);
    for (const x of [450, 900, 1350]) {
      d.lake(x, 500, 60, 46);
      d.river([[x + 1, 0], [x - 3, 150], [x + 3, 300], [x, 450]], 10, 3);
      d.river([[x - 1, 1000], [x + 3, 850], [x - 3, 700], [x, 550]], 10, 3);
    }
    d.river([[0, 500], [200, 496], [395, 500]], 10, 3);
    d.river([[505, 500], [680, 504], [845, 500]], 10, 3);
    d.river([[955, 500], [1120, 496], [1295, 500]], 10, 3);
    d.river([[1405, 500], [1600, 504], [1800, 500]], 10, 3);
    gridRoads(d, pos, 4, 2, 7);
    d.symBiome("swamp", 450, 500, 110);
    d.biomes.push(["swamp", 900, 500, 110]);
    d.symBiome("autumn", 225, 250, 130);
    d.symGold([[1350, 760], [450, 760]]);
    d.scatterTreesSym(600);
    return d;
  });

  makers.push(() => {
    const d = new Draft("velka-zima", "Velká zima",
      "Zimní mapa pro osm hráčů. Království stojí v kruhu kolem velkého zamrzlého jezera, do kterého stéká osm potoků. Okružní cesta je přechází brody.",
      1600, 1200, 3616);
    d.theme = "winter";
    const C = [1600, 1200];
    for (let k = 0; k < 8; k++) {
      const a = deg(22.5 + 45 * k);
      d.base(Math.round(C[0] + 1250 * Math.cos(a)), Math.round(C[1] + 880 * Math.sin(a)));
    }
    d.symmetric(true, true);
    const lake = { cx: 800, cy: 600, rx: 150, ry: 110 };
    d.lake(lake.cx, lake.cy, lake.rx, lake.ry);
    d.stream([[1600, 601], [1400, 596], [1200, 604], [1000, 600]], 6, lake, 3);
    d.stream([[0, 599], [200, 604], [400, 596], [600, 600]], 6, lake, 3);
    d.stream([[801, 0], [796, 200], [803, 400]], 6, lake, 3);
    d.stream([[799, 1200], [804, 1000], [797, 800]], 6, lake, 3);
    d.symRiver([[1530, 1135], [1350, 1010], [1150, 880], [960, 740]], 6, 4);
    d.road(ring(800, 600, 260, 200, 40, deg(4)), 7, true, 0);
    for (let i = 0; i < 8; i++) {
      const [px, py] = plaza(d, i);
      const a = Math.atan2((py - 600) / 200, (px - 800) / 260);
      d.road([[px, py], [800 + Math.cos(a) * 260, 600 + Math.sin(a) * 200]], 7, true);
    }
    d.symGold([[2150, 1500], [3100, 1200]]);
    d.symRidge([[1520, 60], [1580, 120]], 12);
    d.scatterTreesSym(620);
    return d;
  });

  /* ================= kooperace proti nemrtvým ================= */

  makers.push(() => {
    const d = new Draft("mrtva-zeme", "Mrtvá země",
      "Kooperace: dva hráči proti nemrtvým. Na západě poslední zelená údolí, na východě spálená zem a Nekropole. Řeku mezi nimi lze přejít třemi brody.",
      1300, 800, 3717);
    d.theme = "wastes";
    d.base(380, 480);
    d.base(2150, 800);
    d.base(380, 1120);
    d.coop = { ai: 1 };
    d.hellR = 650;
    d.symmetric(false, true);
    d.biomes.push(["meadow", 190, 400, 260]);
    d.river([[640, 0], [636, 150], [645, 300], [640, 400]], 9, 3);
    d.river([[640, 800], [644, 650], [636, 500], [640, 400]], 9, 3);
    d.symAsh(820, 140, 80);
    d.symRidge([[460, 120], [520, 160], [560, 230]], 14);
    d.symRidge([[30, 80], [100, 60]], 12);
    const hell = [1075, 400];
    d.symRoad([plaza(d, 0), [300, 220], [450, 300], [640, 330], [800, 360], hell], 7, true, 3);
    d.road([[190, 257], [175, 400], [190, 543]], 6, true, 3);
    d.symRoad([[190, 257], [400, 120], [640, 100], [850, 160], [990, 290], [1075, 400]], 6, true, 3);
    d.symGold([[900, 330], [1100, 140]]);
    d.scatterTreesSym(280);
    return d;
  });

  makers.push(() => {
    const d = new Draft("ledova-krypta", "Ledová krypta",
      "Kooperace: tři hráči proti nemrtvým v zimě. Nekropole stojí uprostřed mapy za zamrzlým příkopem, přes který vedou tři brody. Hráči útočí ze tří stran.",
      1400, 1000, 3818);
    d.theme = "winter";
    d.base(450, 1640);
    d.base(1400, 920);
    d.base(2350, 1640);
    d.base(1400, 330);
    d.coop = { ai: 1 };
    d.hellR = 520;
    d.symmetric(true, false);
    // příkop kolem pevnosti
    d.river(ring(700, 480, 230, 190, 28, 0), 9, 0);
    const hell = [700, 470];
    d.symRoad([plaza(d, 0), [380, 700], [500, 600], hell], 7, true, 3);
    d.road([plaza(d, 3), [700, 220], hell], 7, true, 3);
    d.symRoad([plaza(d, 0), [350, 870], [500, 900], [700, 905]], 6, true, 3);
    d.symRoad([plaza(d, 3), [480, 160], [300, 300], [220, 500], [225, 803]], 6, true, 3);
    d.symLake(120, 580, 40, 26);
    d.symRidge([[30, 60], [100, 40], [170, 50]], 12);
    d.symGold([[1000, 1280], [750, 640], [1400, 1680]]);
    d.scatterTreesSym(380);
    return d;
  });

  makers.push(() => {
    const d = new Draft("mocaly-nemrtvych", "Močály nemrtvých",
      "Kooperace: čtyři hráči proti nemrtvým. Nekropole se rozlézá uprostřed bažin a království v rozích ji musí dobýt dřív, než je zaplaví vlny nemrtvých.",
      1600, 1100, 3919);
    d.theme = "swamp";
    d.base(420, 420);
    d.base(2780, 420);
    d.base(1600, 1100);
    d.base(420, 1780);
    d.base(2780, 1780);
    d.coop = { ai: 2 };
    d.hellR = 620;
    d.symmetric(true, true);
    d.symLake(500, 140, 50, 30);
    d.symLake(150, 550, 44, 28);
    d.symLake(610, 300, 34, 22);
    // tůně u okraje odtékají potůčkem za mapu, horní a dolní jsou spojené
    d.symRiver([[120, 550], [60, 546], [0, 552]], 5, 2);
    d.symRiver([[540, 140], [620, 160], [700, 150], [800, 145]], 5, 3);
    d.symBiome("meadow", 210, 215, 110);
    const hell = [800, 550];
    d.symRoad([plaza(d, 0), [360, 280], [520, 340], [650, 470], hell], 7, true, 3);
    d.symRoad([plaza(d, 0), [400, 200], [600, 215], [800, 220]], 6, true, 3);
    d.symRoad([plaza(d, 0), [260, 360], [270, 450], [270, 550]], 6, true, 3);
    d.symGold([[1000, 700], [700, 1100]]);
    d.scatterTreesSym(460);
    return d;
  });
};
