# Goralia – export grafiky do PNG

Všechna grafika ve hře se kreslí kódem (js/pixel.js, units.js, buildings.js, props.js,
icons.js, font.js, world.js, fx.js). Tento export spustil **přesně ten samý kód** v
prohlížeči a výsledné obrázky uložil do PNG. Hra ani její soubory se nijak nezměnily –
jde čistě o snímek toho, co hra vykresluje.

* Vše je v **nativním rozlišení 1 art px = 1 px** (hra to pak zvětšuje celým násobkem).
  Při zvětšování v jiném enginu používej filtr *nearest neighbour*, jinak se pixely rozmažou.
* Průhledné pozadí (RGBA).
* Ke každé animaci je **JSON** s rozměry snímků, délkou snímků v ms a kotevními body.
  Spritesheety jednotek jsou ve formátu kompatibilním s exportem z **Aseprite**
  (`frames` + `meta.frameTags`), takže je načte Phaser, Godot, Unity importéry apod.
* Náhledy animací jako GIF (4× zvětšené, na zeleném podkladu) jsou v `_preview/`.

## Struktura

| Složka | Obsah |
|---|---|
| `units/<typ>/<typ>_<tým>.png` | Spritesheet jednotky, buňka 32×32. Řádky: `idle` (2), `walk` (6), `attack` (3), `cast` (3, jen hrdina), `death` (5). Pro všech 16 týmových barev. |
| `units/<typ>/<typ>_<tým>_hitflash.png` | Stejný sheet „rozsvícený“ při zásahu. |
| `units/<typ>/portraits/` | Portréty do HUD (40×40, 2 snímky idle). |
| `units/carry/` | Náklad na zádech dělníka (zlato, dřevo). |
| `buildings/<typ>/<typ>_<tým>.png` | Budovy (radnice, kasárna, chatrč, kovárna pro všechny týmy; věž; citadela). JSON obsahuje kotvu, body pro prapory, kouř, záři a plameny. |
| `…_blueprint.png` | Modrá „předloha“ budovy ve výstavbě. |
| `buildings/banners/` | Vlající prapory, 4 snímky 11×16, 4,5 fps. |
| `buildings/rubble/` | Trosky zničených budov. |
| `props/trees/` | 3 druhy stromů: kmen, koruna (plná / vykácená ze ⅓ / ze ⅔) a složené obrázky. |
| `props/mine/` | Zlatý důl plný a vytěžený. |
| `props/doodads/` | Dekorace: houby, krystaly, kameny, sloupy, lucerny, hory, hradby… (+ JSON s kotvami a záři). |
| `effects/flame/` | Plamen, 4 snímky 7×11, 9 fps. |
| `effects/fx/` | Efekty z částicového systému (zásah, sek, level up, léčení, ohnivá koule, šíp, smrt, zřícení budovy…) předrenderované při 30 fps v mřížce 96×96. |
| `effects/shadow/`, `effects/glow/` | Stíny pod objekty a záře (aditivně). |
| `ui/icons`, `ui/icons_disabled` | Ikony příkazů 16×16 (aktivní / neaktivní). |
| `ui/pictograms` | Malé HUD piktogramy (mince, dřevo, srdce…). |
| `ui/cursors` | Kurzory 16 a 32 px, hotspoty v `cursors.json`. |
| `ui/emblems` | Znak Prstenu (logo „G“) ve variantách z HUD. |
| `ui/fonts` | Bitmapové písmo 5×7 (s českou diakritikou) a 3×5: atlas PNG + JSON + BMFont `.fnt`. |
| `terrain/maps/<mapa>/` | Upečený terén každé mapy, 4 snímky vody a náhled s objekty. |
| `terrain/shared/` | Dlaždice mraků, mlha, teplý přechod, stébla trávy (3 snímky). |

## Časování animací (podle game.js)

| Animace | Snímky | Časování |
|---|---|---|
| idle | 2 | 1,4 fps (714 ms) |
| walk | 6 | podle ušlé vzdálenosti: snímek každých 4,67 logických px; při základní rychlosti ≈ dělník 11,8 / voják 9,6 / lučištník 10,5 / hrdina 11,4 fps. Snímky 0 a 3 jsou ve hře o 1 px výš (pohupování). |
| attack | 3 | jeden úder 0,3 s (105 / 90 / 105 ms); při těžbě dokola 4,5 fps |
| cast (hrdina) | 3 | 0,5 s (150 / 200 / 150 ms) |
| death | 5 | záblesk 140 ms → ležící tělo 785 ms → rozpad 3×250 ms |
| prapor | 4 | 4,5 fps |
| plamen | 4 | 9 fps |
| voda | 4 | 3,2 fps |

## Kotvy

* **Jednotky:** bod nohou je v buňce na **(16, 30)**, postava kouká doprava. Pro pohled doleva
  sprite zrcadli. Další body (hlava, lucerna hrdiny, oko nájezdníka) jsou v JSON pod `meta.points`.
* **Budovy, stromy, dekorace:** `anchor` / `ax, ay` v JSON = bod, který leží na zemi.

Záře (glow), kouř, mihotání plodů na stromech, jiskry v dole a oči nájezdníků hra dokresluje za
běhu – jejich pozice a barvy jsou v příslušných JSON, aby šly zopakovat.
