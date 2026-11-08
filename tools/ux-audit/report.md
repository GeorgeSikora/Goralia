# UX audit Goralie: workflows, problémy a návrhy

Testováno 6. 11. 2026 na `main` **29c0492** (po sloučení #26 kampaně, #43 tutoriálu, #45 hudby a #46 až #52),
lokálně s čistými testovacími daty, ne na goralia.cz. Na produkčních datech se nic nemazalo ani neodesílalo.
Prohlížeč: headless Chromium 1920×1080 (mobil 390×844). Skripty a postup spuštění jsou v [README.md](README.md).

Výstupy (mimo git, ve složce projektu `ux-audit/`):

- `videa/NN_nazev.webm` po jednotlivých workflows, `videa/goralia-workflows.mp4` (spojené, s kapitolami), `videa/kapitoly.txt`
- `screenshoty/` snímky problémů a selhání, `vysledky.json` kroky, časy, chyby konzole a sítě
- `analyza/desktop/`, `analyza/mobil/` snímky obrazovek pro kontrolu přístupnosti a mobilu, `analyza/analyza.json`

> **Jak číst časy:** kontejner nemá GPU, takže menu i hra běží v headless Chromiu kolem 12 snímků za sekundu.
> Časy „klik → obrazovka“ jsou proto delší, než uvidí hráč na běžném počítači. Serverové odpovědi a načtení
> statických souborů jsou změřené přímo a ty zkreslené nejsou.
>
> Odkazy na čas ve videu jsou ve tvaru `07 1:53 / MP4 24:10`: čas v samostatném videu workflow a čas ve spojeném MP4.

## 1. Přehled projitých workflows

| # | Workflow | Stav | Kroků | Délka videa | Kapitola v MP4 | Poznámka |
|---|---|---|---|---|---|---|
| 01 | Úvodní stránka a vstup do hry | OK | 6 | 37 s | 0:00 | `hero.mp4` se načítal 5 s (P8) |
| 02 | Registrace nového hráče | OK | 6 | 127 s | 0:37 | hlášky formuláře (P9, P10) |
| 03 | Přihlášení, profil a odhlášení | OK | 6 | 155 s | 2:45 | |
| 04 | Hráči a Síň slávy | OK | 5 | 90 s | 5:20 | drobnost P17 |
| 05 | Výzvy a sbírka odměn | OK | 4 | 124 s | 6:49 | mobil P11 |
| 06 | Nastavení, ovládání a jazyk | OK | 6 | 246 s | 8:53 | |
| 07 | Hra proti AI | problém | 13 | 368 s | 12:59 | P4, P5, P6 |
| 08 | Multiplayer: místnost pro dva hráče (dvě okna vedle sebe) | problém | 8 | 444 s | 19:07 | P6 |
| 09 | Editor map (běžný hráč) | OK | 8 | 91 s | 26:32 | skript hlásil „problém“ kvůli varování o neuložených změnách; to vyvolal sám skript odchodem ze stránky a je to správné chování (P18) |
| 10 | Admin: server panel, turnaj, mapa v editoru | OK | 7 | 183 s | 28:02 | |
| 11 | Turnaj: přihlášení hráče | OK | 4 | 59 s | 31:05 | |
| 12 | Tutoriál „Naučit se hrát“ | OK | 6 | 138 s | 32:05 | |
| 13 | Kampaň „Stín Morvanův“: 1. kapitola | problém | 4 | 70 s | 34:23 | skript prošel, problém jsem viděl na snímku (P19) |

Žádný workflow neselhal. Ve všech 13 bylo v konzoli a v síti 0 neočekávaných chyb; jediné 400 a 401 byly
záměrně špatné vstupy (prázdná registrace, špatné heslo).

Stav **problém** znamená, že workflow doběhl do konce, ale cestou narazil na něco, co stojí za opravu nebo otázku.

## 2. Nalezené problémy

Závažnost: **vysoká** = blokuje nebo kazí hlavní cestu hráče, **střední** = mate nebo zdržuje, **nízká** = kosmetika.
Kde si nejsem jistý, jestli jde o záměr, je bod označený jako **otázka**.

### Vysoká

**P1. Obrazovku nejde na mobilu přiblížit (přístupnost).**
`index.html:5` má `maximum-scale=1, user-scalable=no`. Slabozraký hráč si na telefonu nezvětší drobný text v menu, Výzvách
ani v nastavení. axe-core to hlásí jako kritické na všech obrazovkách `/play`.
Reprodukce: otevřít `/play` na telefonu, zkusit roztáhnout dvěma prsty. Snímek: `analyza/mobil/menu.png`.
Poznámka: ve hře zoom prohlížeče zřejmě koliduje s ovládáním kamery. Stačí povolit zoom v menu a zakázat ho až na plátně hry
(`touch-action: none` na canvasu).

**P2. Editor map je na mobilu (390 px) nepoužitelný.**
Stránka přetéká o 336 px do strany, pravý panel (náhled, Kontrola, Vrstvy) je mimo obrazovku a přepínače symetrie
a mřížky mají 13×13 px. Reprodukce: otevřít `/editor` na šířce 390 px. Snímek: `analyza/mobil/editor.png`.
Je otázka, jestli editor na mobilu vůbec podporovat. Pokud ne, stačí hláška „Editor je určený pro počítač“.

**P3. (opraveno v main) Po „Vzdát se“ ve hře proti AI hra zamrzla bez konce hry.**
Na starší `main` 97023df simulace zápas ukončila, ale klient zůstal ve stavu „hraje“ a obrazovka konce hry se neukázala.
V aktuální `main` je to opravené (v `game.js` podmínka `stepped || simMatch.phase === "ended"`) a workflow 07 nyní končí správně.
Uvádím pro úplnost. Pokud na goralia.cz ještě běží starší build, hráči na to narážejí, dokud se nenasadí nový Docker obraz.

### Střední

**P4. Po výcviku vojáka se výběr sám přeskočí z kasáren na novou jednotku (otázka).**
`game.js:2953`: když je `pendingTrain` > 0, první nová vlastní jednotka se automaticky vybere. Kdo chce cvičit víc vojáků
za sebou, musí kasárna pokaždé znovu najít a kliknout na ně. Navíc se vybere jakákoli nová jednotka, tedy i dělník
z hlavní budovy, pokud se zrovna objeví dřív.
Reprodukce: Hra proti AI → postavit kasárna → vybrat je → Cvičit vojáka → po vycvičení je vybraný voják, ne kasárna.
Video: `07 3:57 / MP4 16:56`. Snímek: `screenshoty/07_01_problem-vyber-kasaren-se-sam-prepnul-na-nove-vycvicenou-jedn.png`.
Otázka: je to záměr (rychlé poslání nového vojáka do boje)? Pokud ano, doporučuji aspoň přidat frontu výcviku (viz N2).

**P5. Velikost mapy se v lobby ukazuje dvakrát a pokaždé jinak.**
Seznam map počítá „velká“ podle rozměru (`maps.js:478`: šířka > 480 nebo výška > 240), detail mapy podle plochy
(`game.js:2218`). Mapa tak má v seznamu štítek „1v1 · velká“ a v detailu vedle „Velikost: střední (1800×1000)“.
Reprodukce: Hra proti AI → vybrat mapu se štítkem „velká“ → přečíst řádek pod náhledem. Video: `07 0:11 / MP4 13:10`.

**P6. Systémové okno prohlížeče místo dialogu ve hře.**
„Opravdu se chceš vzdát?“ (`game.js:3419`), „Rozehraná hra skončí. Spustit tutoriál?“ (`game.js:1982`) a v editoru
přepsání, smazání a zahození mapy (`editor.js`) používají `window.confirm`. Okno vypadá jinak než celá hra, v režimu
celé obrazovky z něj prohlížeč vyskočí a na mobilu blokuje hru. Video: `07 5:35 / MP4 18:34`, `08 6:20 / MP4 25:27`.

**P7. Načtení `/play` je těžké: 129 požadavků, 3,7 MB a cache se pokaždé ověřuje.**
Statické JS mají `Cache-Control: no-cache` bez `ETag` nebo `Last-Modified` (`server/server.js:278`). Prohlížeč tak
při každé návštěvě stáhne všech 129 souborů znovu, protože nemá podle čeho se zeptat „změnilo se to?“. Server sám
nekomprimuje (gzip/brotli). Na starší main to bylo 91 požadavků a 2,3 MB, takže to s novým obsahem roste.
Načtení ze serveru je rychlé (TTFB 2 až 4 ms, DOMContentLoaded 60 až 90 ms), čekání hráče tvoří hlavně načítací obrazovka:
`/play → hlavní menu` trvalo 5,0 až 5,7 s (headless). V menu bylo naměřeno 134 dlouhých úloh hlavního vlákna (> 50 ms),
celkem kolem 20 s, nejdelší 403 ms, takže menu reaguje na klik se zpožděním.
Otázka: komprimuje Nginx Proxy Manager na VPS? Pokud ano, přenos bude menší, ale opakovaná stahování zůstanou.

**P8. Úvodní video `hero.mp4` má 3,8 MB a načítalo se 5 s.**
Na úvodní stránce (`/`) je to největší soubor a hráč na mobilních datech na něj čeká. Video 01 0:05. Pomůže kratší
smyčka nebo menší bitrate, `preload="metadata"` a obrázek `poster`.

**P9. Registrace: chybové hlášky neodpovídají tomu, co je špatně.**
Odeslání prázdného formuláře ukáže jen pravidlo pro přezdívku. Hláška zůstane viditelná i po opravě pole a dál nic
neříká o e-mailu a hesle. Pravidlo pro heslo (minimální délka) se ukáže až po chybě. Video: `02 0:33 / MP4 1:10`.

**P10. Přezdívka nesmí obsahovat diakritiku (otázka).**
„Soupeř“ server odmítl (`NAME_RE` povoluje jen písmena bez háčků a čárek). Pro českou hru je to překvapivé a hláška
neříká proč. Pokud je to záměr (vyhledávání, URL profilu), stačí to napsat do nápovědy u pole.

**P11. Výzvy na mobilu: 33 malých šedých tlačítek „Zatím nemáš“.**
Odměny, které hráč ještě nemá, jsou tlačítka 91×20 px, která vypadají neaktivně, ale reagují. Na obrazovce Výzev je
82 textů menších než 12 px. Kontrast stavového textu je 4,22:1 (18 prvků, minimum je 4,5:1).
Snímky: `analyza/mobil/vyzvy.png`, `analyza/desktop/vyzvy.png`.

**P12. Hra na výšku na telefonu nemá nápovědu „otoč telefon“.**
Na šířce 390 px se hra spustí, ale spodní panel se zprávou a minimapou je nečitelně malý. Snímek: `analyza/mobil/hra.png`.

### Nízká

**P13. Klávesnice na úvodní stránce: polovina prvků nemá viditelný fokus.**
Z 25 zastavení klávesy Tab nemá 12 viditelný rámeček: obrázek hry (`figure.shot`), záložky Království / Nemrtví
z pekla a karty jednotek. Hráč ovládající web klávesnicí neví, kde je.

**P14. Klávesnice v menu hry: Tab mezi patičkou a tlačítkem celé obrazovky spadne na `body`.**
Jinak je menu klávesnicí ovladatelné dobře: Tab → Hra proti AI → Enter otevře lobby, fokus skočí na „Spustit hru“
a Esc vrátí do menu.

**P15. Kontrast a sémantika (axe-core).**
Patička úvodní stránky „© Jiří Sikora“ 4,1:1, vybraný štítek mapy v lobby 3,78:1, stav v Síni slávy 4,22:1.
Seznamy `#l-maps`, `#pl-list` a záložky editoru mají `role="listbox"`/`tablist` bez potomků se správnou rolí
(`aria-required-children`). V editoru jsou dva stejné landmarky `#e-left` (`landmark-unique`).

**P16. Malé dotykové cíle na mobilu.**
Odkazy v patičce menu (Goralia, Editor map, Podmínky, Soukromí) mají výšku 12 px, zaškrtávátka v Nastavení 20×20 px
a posuvníky hlasitosti 16 px. Doporučené minimum je 24 px, ideálně 44 px.

**P17. Síň slávy: popisek „Hledat“ je daleko od pole a pravidla bodování jsou drobným písmem.** Video: `04 0:28 / MP4 5:48`.

**P18. V editoru může na localhostu ukládat i host (jen poznámka k testu).**
Server pouští ukládání map z localhostu bez přihlášení (`isLocalRequest`). Na produkci to tak není, takže workflow 09
neukazuje, co uvidí běžný hráč při pokusu uložit. Nový „▶ Vyzkoušet“ bez uložení funguje dobře.

### Kampaň (zjištěno ze snímku, ne skriptem)

**P19. Kampaň: panel úkolů překrývá oznámení a oznámení překrývá legendu týmů.**
Hned po přeskočení úvodní cutscény 1. kapitoly začíná text „…dělníci postaví strážní věž u severní cesty.“ pod panelem
ÚKOLY (začátek věty není vidět) a jeho konec zakrývá štítek „Radim“ vpravo nahoře. Nápověda „Esc = přeskočit cutscénu“
ještě chvíli visí nad spodním panelem a zakrývá poslední řádek textu v něm.
Reprodukce: Kampaň → 1. kapitola → Esc. Video: `13 0:56 / MP4 35:19`. Snímek: `screenshoty/13_01_kampan-hra.png`.
Závažnost: **střední** (první věta kampaně, kterou hráč má číst).

**P20. Texty kampaně jsou jen česky.** Při jazyku English nebo Po našimu se kampaň ukáže česky (známý dluh z #26, v tomto běhu jsem to znovu neověřoval).
Závažnost: **nízká**, dokud nejsou zahraniční hráči.

## 3. Návrhy na vylepšení existujících workflows

Seřazeno podle poměru přínos / náročnost (nahoře nejvíc užitku za nejméně práce).

| # | Návrh | Přínos | Náročnost | Řeší |
|---|---|---|---|---|
| 1 | Povolit zoom stránky v menu (`user-scalable` pryč z viewportu, `touch-action: none` jen na canvasu hry) | vysoký | velmi nízká (1 řádek + test) | P1 |
| 2 | Sjednotit štítek velikosti mapy: seznam i detail přes stejnou funkci `sizeLabel` | střední | velmi nízká | P5 |
| 3 | Kampaň: posunout oznámení pod panel úkolů (nebo panel na chvíli schovat) a nápovědu Esc skrýt hned po přeskočení | střední | velmi nízká | P19 |
| 4 | Přidat `ETag`/`Last-Modified` a 304 odpovědi pro statické soubory, případně gzip; dlouhodobější cache s `?v=` u verzovaných souborů | vysoký (rychlejší každý další start) | nízká | P7 |
| 5 | Po výcviku nechat vybraná kasárna (nebo to dát jako volbu v nastavení) | střední | nízká | P4 |
| 6 | Registrace: hláška ke každému poli zvlášť, mizí po opravě, pravidla hesla a přezdívky předem pod polem | střední | nízká | P9, P10 |
| 7 | `hero.mp4` zmenšit a dát `preload="metadata"` + `poster` | střední | nízká | P8 |
| 8 | Hra na výšku: překryv „Otoč telefon na šířku“ | střední | nízká | P12 |
| 9 | Výzvy na mobilu: zamčené odměny jako ikonka zámku místo tlačítka, větší písmo | střední | nízká | P11 |
| 10 | Viditelný fokus (`:focus-visible`) na úvodní stránce, opravit role seznamů a kontrast tří prvků | nízký až střední | nízká | P13 až P15 |
| 11 | Nahradit `window.confirm` vlastním dialogem v pixel stylu (jeden komponent pro hru i editor) | střední | střední | P6 |
| 12 | Větší dotykové cíle na mobilu (patička, zaškrtávátka, posuvníky) | nízký | nízká | P16 |
| 13 | Editor na mobilu: buď hláška „jen pro počítač“, nebo vysouvací panely přes celou šířku | nízký (málokdo edituje na telefonu) | nízká / vysoká | P2 |
| 14 | Odlehčit menu: méně práce v hlavním vlákně (animace menu pozastavit, když je otevřené podmenu; dopéct grafiku jednou a cachovat) | střední | střední | P7 |

## 4. Návrhy na nové funkce

**N1. Pokračovat v rozehrané hře po obnovení stránky.**
Ve workflow 07 trvá od otevření `/play` po první rozkaz kolem 40 s (menu, výběr mapy, načtení). Když hráč omylem
zavře záložku nebo obnoví stránku, hra proti AI je pryč. Uložení stavu offline zápasu do `localStorage` a tlačítko
„Pokračovat“ v menu by tuhle ztrátu odstranilo.

**N2. Fronta výcviku v budovách (např. Shift+klik = 5×).**
Viděl jsem, že na každého vojáka je potřeba nový klik a po výcviku se výběr přepne (P4). Fronta ubere většinu
opakovaných kliků v nejčastější činnosti celé hry.

**N3. Rychlá hra jedním klikem.**
Hra proti AI vyžaduje projít seznam map, filtr a nastavení soupeře. Tlačítko „Rychlá hra“ (náhodná mapa 1v1,
střední AI) zkrátí cestu nového hráče do hry na jeden klik. Tutoriál to ukazuje dobře: „Naučit se hrát“ je hratelný
za 6 s.

**N4. Pozvánka do místnosti odkazem.**
Ve workflow 08 musí druhý hráč otevřít Multiplayer, najít místnost v seznamu a připojit se (připojení trvalo 13 s).
Odkaz `goralia.cz/play?room=…` ke zkopírování by hraní s kamarádem zjednodušil.

**N5. Indikace nepřečtených výzev a odměn v menu.**
Výzvy a sbírka odměn jsou schované v podmenu. Tečka nebo číslo u tlačítka „Výzvy“, když je hotová výzva nebo nová
odměna, hráče přivede zpátky.

**N6. Náhled mapy pro sdílení z editoru.**
Editor umí „Vyzkoušet“ a stáhnout JSON, ale běžný hráč na produkci mapu na server uložit nemůže. Odeslání mapy ke
schválení adminovi (fronta v záložce Mapy v admin panelu) by z editoru udělalo komunitní funkci.

**N7. Zobrazení chyb připojení ve hře.**
Během testů nepadla žádná chyba sítě, ale menu nemá žádný stav „server nedostupný“. Při výpadku multiplayeru by
hráč měl vidět jasnou hlášku místo prázdného seznamu místností. (Otázka: jak se to dnes chová, jsem netestoval.)

## 5. Co funguje dobře

- Serverové API je rychlé: registrace i přihlášení pod 50 ms, statické soubory jednotky ms.
- Úvodní stránka: First Contentful Paint 124 ms, DOMContentLoaded 313 ms.
- Celý tok multiplayeru (vytvoření místnosti, připojení, chat, start, vzdání) prošel ve dvou oknech bez chyby.
- Tutoriál vede krok za krokem, „Přeskočit“ funguje a cutscénu kampaně jde přeskočit klávesou Esc.
- Menu je ovladatelné klávesnicí (Enter/Esc), fokus po otevření lobby skočí na „Spustit hru“.
- Žádná chyba v konzoli ani neočekávaná chyba sítě v celém běhu (jediné 400/401 byly záměrně špatné vstupy).
