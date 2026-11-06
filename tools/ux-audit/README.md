# UX audit: nahrávání workflows a analýza

Playwright skripty, které projdou hlavní workflows Goralie jako běžný hráč (a admin),
nahrají je na video a změří, co se při tom děje. Report z prvního běhu je v [report.md](report.md).

## Spuštění

Potřebuješ Node 22+ (TypeScript běží bez sestavení), Playwright s Chromiem a pro spojené video ffmpeg.

```bash
# server s testovacími daty, ať se nesahá na produkční účty
GORALIA_ENV_FILE= GORALIA_DATA_DIR=/tmp/ux-data GORALIA_MAPS_DIR=/tmp/ux-maps \
GORALIA_ADMIN_NAME=admin GORALIA_ADMIN_EMAIL=admin@example.test GORALIA_ADMIN_PASSWORD=adminheslo123 \
npm start            # mapy předem zkopíruj: cp -r maps/* /tmp/ux-maps/

# Úkol 1: videa 1920×1080 (ux-audit-out/videa/NN_nazev.webm + goralia-workflows.mp4 s kapitolami)
node tools/ux-audit/record.ts --out ux-audit-out
node tools/ux-audit/record.ts --out ux-audit-out --only 07,08   # jen vybrané, ostatní výsledky zůstanou

# Úkol 2: znovu bez videa, jen měření (konzole, síť, časy kroků)
node tools/ux-audit/record.ts --mode audit --out ux-audit-out
# přístupnost (axe-core), klávesnice, výkon načítání a mobil 390 px
npm i --no-save axe-core && node tools/ux-audit/a11y.ts --out ux-audit-out
```

Admin se bere z `UX_ADMIN_NAME` a `UX_ADMIN_PASSWORD` (výchozí `admin` / `adminheslo123`, stejně jako výše).
Adresu serveru mění `--base` (nebo `UX_BASE`). Workflow s vlastním serverem (např. z neslité větve)
čte adresu z proměnné uvedené v `baseEnv`; bez ní se přeskočí.

## Soubory

- `lib.ts`: `Flow` (kroky, titulek workflow, popisky, zvýraznění prvku, viditelný kurzor, screenshoty při selhání,
  sběr chyb konzole a sítě), přepočet souřadnic hry (`worldToClient`, `hudButton`, `gameState`).
- `workflows.ts`: 13 workflows (úvodní stránka, registrace, přihlášení, Síň slávy, výzvy, nastavení, hra proti AI,
  multiplayer ve dvou oknech, editor map, admin, turnaj, tutoriál, kampaň).
- `record.ts`: spouští workflows, pojmenuje videa, spojí je do MP4 s kapitolami, zapíše `vysledky.json`.
- `a11y.ts`: kontrola klíčových obrazovek na 1920 px a 390 px, zapíše `analyza/analyza.json` a screenshoty.

Když krok selže, workflow se zastaví, do `screenshoty/` se uloží snímek, do `vysledky.json` krok a důvod,
a pokračuje se dalším workflow. Měkké problémy (`f.check`, `f.issue`) workflow nezastaví.

Pozor na čtení časů: bez GPU (headless Chromium v kontejneru) běží menu kolem 12 snímků za sekundu,
takže časy kliků v UI jsou delší než na běžném počítači. Serverové časy jsou v reportu změřené zvlášť.
