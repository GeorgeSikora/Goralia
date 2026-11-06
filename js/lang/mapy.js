/*
 * Názvy a popisy map s krajinami (tools/genmaps-krajiny.js) a názvy krajin, v angličtině a po našimu.
 * Načítá se po js/lang/en.js a szl.js. Klíč = český text (js/i18n.js).
 * Po našimu podle /mnt/project-files/i18n/ponaszymu-pravidla.md: český pravopis + ł, ó, dź, žádné dlouhé samohlásky.
 */
(() => {
  const PK = window.PK;
  if (!PK || !PK.i18n) return;

  PK.i18n.add("en", {
    /* krajiny (krajiny.js) */
    "Krajina": "Landscape",
    "Louka": "Meadow", "louka": "meadow",
    "Podzim": "Autumn", "podzim": "autumn",
    "Zima": "Winter", "zima": "winter",
    "Bažina": "Marsh", "bažina": "marsh",
    "Vysočina": "Highlands", "vysočina": "highlands",
    "Pustina": "Wasteland", "pustina": "wasteland",
    "Hráči: {0} · Velikost: {1} ({2}×{3}) · Zlaté doly: {4} · Krajina: {5}": "Players: {0} · Size: {1} ({2}×{3}) · Gold mines: {4} · Landscape: {5}",

    /* mapy */
    "Ostrovy a brody": "Islands and Fords",
    "Řeka se uprostřed rozdělí na dvě ramena a obtéká ostrov se dvěma doly. Na ostrov i na druhý břeh se jde jen brody na cestách; u základen leží klidná jezírka.":
      "In the middle the river splits into two arms flowing around an island with two mines. The island and the far bank can only be reached by fords on the roads; quiet ponds lie by the bases.",
    "Mlžná bažina": "Misty Marsh",
    "Základny stojí na suchých loukách, mezi nimi se táhnou tůně, potůčky a mlhou zahalené vrbiny. Pěšiny vedou kolem vody a brody přes ni.":
      "The bases stand on dry meadows; between them stretch pools, brooks and willow thickets shrouded in mist. Paths lead around the water and fords across it.",
    "Zamrzlé jezero": "Frozen Lake",
    "Zimní mapa. Uprostřed leží zamrzlé jezero, do kterého stékají potoky z hor. Cesty ho obcházejí ze severu a z jihu přes brody.":
      "A winter map. A frozen lake lies in the middle, fed by streams from the mountains. Roads go around it to the north and south across fords.",
    "Podzimní hvozd": "Autumn Forest",
    "Hustý podzimní les plný dřeva. Tři cesty vedou přes potok, který vytéká z lesního jezírka; mezi nimi jsou mýtiny s doly.":
      "A dense autumn forest full of wood. Three roads cross a brook flowing out of a forest pond; between them lie clearings with mines.",
    "Kamenný kaňon": "Stone Canyon",
    "Vysočina s vřesem. Dlouhým kaňonem vede hlavní cesta, nad ním jsou horská jezera a sněhem pokryté vrcholy. Do kaňonu se dá sejít dvěma průsmyky z každé strany.":
      "Heather highlands. The main road runs along a long canyon, with mountain lakes and snow-capped peaks above it. Two passes on each side lead down into the canyon.",
    "Tři krajiny": "Three Lands",
    "Tři království, tři krajiny: zelená louka, podzimní lesy a zasněžené pláně. Potoky z kraje mapy stékají do jezera uprostřed a cesta kolem něj je propojuje brody.":
      "Three kingdoms, three lands: green meadow, autumn woods and snowy plains. Streams from the edge of the map flow into a lake in the middle, and the road around it links them with fords.",
    "Vřesový vrch": "Heather Peak",
    "Uprostřed se zvedá zasněžený masiv se třemi hřebeny, pod ním leží horská plesa. Okružní cesta vede kolem hor; o doly mezi hřebeny se přou vždy dva sousedé.":
      "A snowy massif with three ridges rises in the middle, with mountain tarns below. A ring road runs around the mountains; the mines between the ridges are always contested by two neighbours.",
    "Říční delta": "River Delta",
    "Velká řeka se rozvětví do tří ramen, která se vlévají do laguny na jihu. Severní království dělí jeden brod, jižní tři. Mezi rameny leží bažinaté ostrůvky s doly.":
      "A great river splits into three arms that flow into a lagoon in the south. The northern kingdoms are separated by one ford, the southern ones by three. Marshy islets with mines lie between the arms.",
    "Spálené pláně": "Burnt Plains",
    "Pustina po válce s nemrtvými. Čtyři poslední zelené oázy obklopuje popel a seschlá tráva; uprostřed leží kráter se skalním valem a bohatými doly.":
      "A wasteland after the war with the undead. Ash and withered grass surround the last four green oases; in the middle lies a crater with a rocky rim and rich mines.",
    "Zimní průsmyky": "Winter Passes",
    "Zimní mapa. Pohoří ve tvaru kříže dělí kraj na čtvrtiny a uprostřed leží zamrzlé jezero. Mezi sousedy vede vždy jen jeden průsmyk.":
      "A winter map. A cross-shaped mountain range divides the land into quarters, with a frozen lake in the middle. Only one pass leads between neighbours.",
    "Jezerní kraj": "Lake Country",
    "Čtyři potoky stékají z kraje mapy do velkého jezera uprostřed. Okružní cesta kolem jezera má čtyři brody, na březích čekají doly a podzimní háje.":
      "Four streams flow from the edge of the map into a large lake in the middle. The ring road around the lake has four fords; mines and autumn groves wait on its shores.",
    "Vřesoviště": "Heathland",
    "Zvlněná vysočina s vřesem, skalními výchozy a horským plesem uprostřed. Potok teče od severu k jihu, přejít se dá třemi brody.":
      "Rolling heather highlands with rocky outcrops and a mountain tarn in the middle. A brook flows from north to south and can be crossed at three fords.",
    "Šest ostrovů": "Six Islands",
    "Šest království na ostrovech. Mezi nimi tečou široké průplavy, které se stékají do dvou bažinatých jezer; na sousední ostrov se jde jen brody na cestách.":
      "Six kingdoms on islands. Wide channels between them meet in two marshy lakes; the neighbouring island can only be reached by fords on the roads.",
    "Podzimní kraje": "Autumn Lands",
    "Šest království v podzimní krajině. Dvě řeky tečou přes lesní jezera, mezi nimi se zvedá skalnatá vysočina s vřesem.":
      "Six kingdoms in an autumn landscape. Two rivers flow through forest lakes, and between them rises a rocky heather upland.",
    "Souostroví": "Archipelago",
    "Osm ostrovních království ve dvou řadách. Průplavy mezi ostrovy se sbíhají do tří jezer, každý soused je za brodem.":
      "Eight island kingdoms in two rows. The channels between the islands meet in three lakes; every neighbour is across a ford.",
    "Velká zima": "The Great Winter",
    "Zimní mapa pro osm hráčů. Království stojí v kruhu kolem velkého zamrzlého jezera, do kterého stéká osm potoků. Okružní cesta je přechází brody.":
      "A winter map for eight players. The kingdoms stand in a circle around a great frozen lake fed by eight streams. The ring road crosses them at fords.",
    "Mrtvá země": "Dead Land",
    "Kooperace: dva hráči proti nemrtvým. Na západě poslední zelená údolí, na východě spálená zem a Nekropole. Řeku mezi nimi lze přejít třemi brody.":
      "Co-op: two players against the undead. The last green valleys in the west, scorched earth and the Necropolis in the east. The river between them can be crossed at three fords.",
    "Ledová krypta": "Ice Crypt",
    "Kooperace: tři hráči proti nemrtvým v zimě. Nekropole stojí uprostřed mapy za zamrzlým příkopem, přes který vedou tři brody. Hráči útočí ze tří stran.":
      "Co-op: three players against the undead in winter. The Necropolis stands in the middle of the map behind a frozen moat crossed by three fords. The players attack from three sides.",
    "Močály nemrtvých": "Marshes of the Undead",
    "Kooperace: čtyři hráči proti nemrtvým. Nekropole se rozlézá uprostřed bažin a království v rozích ji musí dobýt dřív, než je zaplaví vlny nemrtvých.":
      "Co-op: four players against the undead. The Necropolis spreads in the middle of the marshes, and the kingdoms in the corners must take it before waves of undead overrun them."
  });

  PK.i18n.add("szl", {
    "Krajina": "Kraj",
    "Louka": "Łónka", "louka": "łónka",
    "Podzim": "Jeseň", "podzim": "jeseň",
    "Zima": "Zima", "zima": "zima",
    "Bažina": "Bažina", "bažina": "bažina",
    "Vysočina": "Vysočina", "vysočina": "vysočina",
    "Pustina": "Pustina", "pustina": "pustina",
    "Hráči: {0} · Velikost: {1} ({2}×{3}) · Zlaté doly: {4} · Krajina: {5}": "Groče: {0} · Vělkošč: {1} ({2}×{3}) · Złote doły: {4} · Kraj: {5}",

    "Ostrovy a brody": "Ostrovy a brody",
    "Řeka se uprostřed rozdělí na dvě ramena a obtéká ostrov se dvěma doly. Na ostrov i na druhý břeh se jde jen brody na cestách; u základen leží klidná jezírka.":
      "Řyka se v postřodku rozdźeli na dvě ramjona a łobtyko ostrov z dvóma dołami. Na ostrov aji na drugi brzyg se idźe jyny brodami na cestach; při bazach ležóm spokojne jezerka.",
    "Mlžná bažina": "Mglisto bažina",
    "Základny stojí na suchých loukách, mezi nimi se táhnou tůně, potůčky a mlhou zahalené vrbiny. Pěšiny vedou kolem vody a brody přes ni.":
      "Bazy stojóm na suchych łónkach, mjyndzy nimi se čóngnóm tóně, potočki a vrbiny skryte ve mgle. Ščežki vedóm kole vody a brody přes ňóm.",
    "Zamrzlé jezero": "Zamarzłe jezero",
    "Zimní mapa. Uprostřed leží zamrzlé jezero, do kterého stékají potoky z hor. Cesty ho obcházejí ze severu a z jihu přes brody.":
      "Zimovo mapa. V postřodku leži zamarzłe jezero, do kěrego spłyvajóm potoki z gór. Cesty go łobchodźóm ze severu a z juhu přes brody.",
    "Podzimní hvozd": "Jesyňny las",
    "Hustý podzimní les plný dřeva. Tři cesty vedou přes potok, který vytéká z lesního jezírka; mezi nimi jsou mýtiny s doly.":
      "Gynsty jesyňny las pełny dřeva. Třy cesty vedóm přes potok, kěry vyčeko z lešnego jezerka; mjyndzy nimi sóm polany z dołami.",
    "Kamenný kaňon": "Kamjynny kaňon",
    "Vysočina s vřesem. Dlouhým kaňonem vede hlavní cesta, nad ním jsou horská jezera a sněhem pokryté vrcholy. Do kaňonu se dá sejít dvěma průsmyky z každé strany.":
      "Vysočina z vřosym. Dłógim kaňonym vedźe głóvno cesta, nad nim sóm górske jezera a šňygym přikryte vjyrchy. Do kaňonu se do zyjšč dvóma přesmykami z každej strony.",
    "Tři krajiny": "Třy kraje",
    "Tři království, tři krajiny: zelená louka, podzimní lesy a zasněžené pláně. Potoky z kraje mapy stékají do jezera uprostřed a cesta kolem něj je propojuje brody.":
      "Třy królestva, třy kraje: želóno łónka, jesyňne lasy a zašňyžone rovne. Potoki z kraja mapy spłyvajóm do jezera v postřodku a cesta kole ňego je spojuje brodami.",
    "Vřesový vrch": "Vřosovy vjyrch",
    "Uprostřed se zvedá zasněžený masiv se třemi hřebeny, pod ním leží horská plesa. Okružní cesta vede kolem hor; o doly mezi hřebeny se přou vždy dva sousedé.":
      "V postřodku se dźvigo zašňyžony masiv z třema gřebjyňami, pod nim ležóm górske plesa. Cesta vedźe kole gór; o doły mjyndzy gřebjyňami se bijóm dycki dva sómšedźi.",
    "Říční delta": "Řyčno delta",
    "Velká řeka se rozvětví do tří ramen, která se vlévají do laguny na jihu. Severní království dělí jeden brod, jižní tři. Mezi rameny leží bažinaté ostrůvky s doly.":
      "Vělko řyka se rozdźeli na třy ramjona, kěre spłyvajóm do laguny na juhu. Severne królestva dźeli jedyn bród, južne třy. Mjyndzy ramjonami ležóm bažinate ostrovki z dołami.",
    "Spálené pláně": "Spolóne rovne",
    "Pustina po válce s nemrtvými. Čtyři poslední zelené oázy obklopuje popel a seschlá tráva; uprostřed leží kráter se skalním valem a bohatými doly.":
      "Pustina po vojně z umarlokami. Štyry łostatni želóne oazy łobkoło popjoł a vyschło trova; v postřodku leži krater ze skalnym valym a bogatymi dołami.",
    "Zimní průsmyky": "Zimove přesmyki",
    "Zimní mapa. Pohoří ve tvaru kříže dělí kraj na čtvrtiny a uprostřed leží zamrzlé jezero. Mezi sousedy vede vždy jen jeden průsmyk.":
      "Zimovo mapa. Góry ve tvaru křiža dźelóm kraj na štvjyrči a v postřodku leži zamarzłe jezero. Mjyndzy sómšedźami vedźe dycki jyny jedyn přesmyk.",
    "Jezerní kraj": "Jezerny kraj",
    "Čtyři potoky stékají z kraje mapy do velkého jezera uprostřed. Okružní cesta kolem jezera má čtyři brody, na březích čekají doly a podzimní háje.":
      "Štyry potoki spłyvajóm z kraja mapy do vělkego jezera v postřodku. Cesta kole jezera mo štyry brody, na brzygach čakajóm doły a jesyňne gaje.",
    "Vřesoviště": "Vřosovisko",
    "Zvlněná vysočina s vřesem, skalními výchozy a horským plesem uprostřed. Potok teče od severu k jihu, přejít se dá třemi brody.":
      "Fałdźisto vysočina z vřosym, skalami a górskim plesym v postřodku. Potok čeče łod severu na juh, přejšč se do třema brodami.",
    "Šest ostrovů": "Šešč ostrovóv",
    "Šest království na ostrovech. Mezi nimi tečou široké průplavy, které se stékají do dvou bažinatých jezer; na sousední ostrov se jde jen brody na cestách.":
      "Šešč królestv na ostrovach. Mjyndzy nimi čečóm šyroke kanały, kěre spłyvajóm do dvóch bažinatych jezer; na sómšedni ostrov se idźe jyny brodami na cestach.",
    "Podzimní kraje": "Jesyňne kraje",
    "Šest království v podzimní krajině. Dvě řeky tečou přes lesní jezera, mezi nimi se zvedá skalnatá vysočina s vřesem.":
      "Šešč królestv v jesyňnym kraju. Dvě řyki čečóm přes lešne jezera, mjyndzy nimi se dźvigo skalisto vysočina z vřosym.",
    "Souostroví": "Ostrovje",
    "Osm ostrovních království ve dvou řadách. Průplavy mezi ostrovy se sbíhají do tří jezer, každý soused je za brodem.":
      "Ošym ostrovnych królestv ve dvóch řadach. Kanały mjyndzy ostrovami se zbjyrajóm do třech jezer, každy sómšad je za brodym.",
    "Velká zima": "Vělko zima",
    "Zimní mapa pro osm hráčů. Království stojí v kruhu kolem velkého zamrzlého jezera, do kterého stéká osm potoků. Okružní cesta je přechází brody.":
      "Zimovo mapa pro ošym gročóv. Królestva stojóm v kole kole vělkego zamarzłego jezera, do kěrego spłyvo ošym potokóv. Cesta kole ňego je přechodźi brodami.",
    "Mrtvá země": "Umarło žymja",
    "Kooperace: dva hráči proti nemrtvým. Na západě poslední zelená údolí, na východě spálená zem a Nekropole. Řeku mezi nimi lze přejít třemi brody.":
      "Kooperacyja: dva groče proči umarlokóm. Na zapadźe łostatni želóne doliny, na vychodźe spolóno žymja a Nekropola. Řyke mjyndzy nimi se do přejšč třema brodami.",
    "Ledová krypta": "Lodovo krypta",
    "Kooperace: tři hráči proti nemrtvým v zimě. Nekropole stojí uprostřed mapy za zamrzlým příkopem, přes který vedou tři brody. Hráči útočí ze tří stran.":
      "Kooperacyja: třo groče proči umarlokóm v zimě. Nekropola stoji v postřodku mapy za zamarzłym přikopym, přes kěry vedóm třy brody. Groče utočóm ze třech stron.",
    "Močály nemrtvých": "Močary umarlokóv",
    "Kooperace: čtyři hráči proti nemrtvým. Nekropole se rozlézá uprostřed bažin a království v rozích ji musí dobýt dřív, než je zaplaví vlny nemrtvých.":
      "Kooperacyja: štyry groče proči umarlokóm. Nekropola se rozłazi v postřodku bažin a królestva v rogach jóm třeba dobyč, niž je zaleje šturm umarlokóv."
  });
})();
