# Kampaň: Stín Morvanův (scénář)

Vygenerováno z `js/campaign.js` příkazem `node tools/campaign-script.js`, ručně neupravovat.

Každá replika má stálé id. Nahrávka se uloží jako `assets/kampan/hlasy/<id>.mp3` a id se přidá do seznamu `VOICED` v `js/campaign.js`; replika pak počká, až hlas dohraje.

## Postavy

| Postava | Replik |
|---|---|
| Vypravěč | 8 |
| Jitka | 13 |
| Radim z Bystré | 19 |
| Sedlák Bartoš | 1 |
| Bratr Kryštof | 13 |
| Hlas ze tmy | 3 |
| Strážný Matěj | 2 |
| Morvan | 11 |
| Vojvoda Hostivít | 10 |
| Vratislav | 1 |
| Padlý Hostivít | 4 |

## Kapitola I: Popel nad Bystrou

Na sever od vesnice Bystrá začala zem kouřit popelem. Rytíř Radim musí s hrstkou sedláků ubránit vesnici před první nocí mrtvých.

| id | Postava | Text |
|---|---|---|
| `k1.uvod.01` | Vypravěč | Goralie, rok po Velké válce. Lidé znovu orají pole a staví domy. Ale na severu, ve Vraním lese, začala zem kouřit popelem. |
| `k1.uvod.02` | Jitka | Radime! Radime, stůj! |
| `k1.uvod.03` | Radim z Bystré | Jitko? Co se děje? Vypadáš, jako bys viděla ducha. |
| `k1.uvod.04` | Jitka | Hůř. Ve Vraním lese jsem viděla mrtvé. Chodí, Radime. Jdou sem. |
| `k1.uvod.05` | Sedlák Bartoš | Mrtví nechodí, děvče. Kolik jsi toho u mě v hospodě vypila? |
| `k1.uvod.06` | Jitka | Ani kapku! Byl mezi nimi starý Ondra. Ten, co jsme ho loni pohřbili. Měl prázdné oči. |
| `k1.uvod.07` | Radim z Bystré | Bartoši, zvoň na poplach. Ať se všichni stáhnou ke Gmině a muži vezmou zbraně. |
| `k1.uvod.08` | Radim z Bystré | Bystrá nepadne. Ne, dokud stojím na nohou. |
| `k1.vlna.01` | Jitka | Jdou z lesa! Držte cestu! |
| `k1.vlna.02` | Radim z Bystré | Další jdou od spálené země. Kostlivci mají luky, kryjte se za věžemi! |
| `k1.vlna.03` | Jitka | Radime, tohle je něco jiného... něco obrovského! |
| `k1.vlna.04` | Radim z Bystré | To byli jen první. Postavte věže u cesty, noc je ještě dlouhá. |
| `k1.konec.01` | Vypravěč | Úsvit přišel pomalu. Z Vraního lesa už nikdo nevyšel. |
| `k1.konec.02` | Bratr Kryštof | Pokoj vám, lidé z Bystré. Přicházím pozdě, jak vidím. |
| `k1.konec.03` | Radim z Bystré | Mnich? Tak daleko od hor? Kdo jsi? |
| `k1.konec.04` | Bratr Kryštof | Bratr Kryštof z kláštera na Lysé hoře. Pohřbívám mrtvé, kteří nechtějí zůstat v zemi. |
| `k1.konec.05` | Jitka | Takže se mi to nezdálo. |
| `k1.konec.06` | Bratr Kryštof | Nezdálo. Někdo je volá. Za Hněvínem se otevřela stará brána a z ní vane chlad, který probouzí kosti. |
| `k1.konec.07` | Radim z Bystré | V Hněvíně vládne vojvoda Hostivít. Musí se to dozvědět, a hned. |
| `k1.konec.08` | Bratr Kryštof | Pak vyrazíme ještě dnes. Nejkratší cesta vede Vraním lesem. |
| `k1.konec.09` | Hlas ze tmy | Jen pojďte, malí lidé. Každý z vás, kdo padne, mi přidá dalšího vojáka. |

## Kapitola II: Vraní les

Družina prochází mrtvým lesem ke strážnici Hněvína. Na cestě čekají přepadení a u brodu poprvé promluví ten, kdo mrtvé volá.

| id | Postava | Text |
|---|---|---|
| `k2.uvod.01` | Vypravěč | Družina vyrazila za úsvitu. Vraní les byl tichý. Příliš tichý. |
| `k2.uvod.02` | Jitka | Neslyším ani jednoho ptáka. Ani vránu, a přitom se tomu tu říká Vraní les. |
| `k2.uvod.03` | Bratr Kryštof | Mrtví nesou ticho s sebou. Držte se cesty a nespouštějte zbraně. |
| `k2.uvod.04` | Radim z Bystré | Ke strážnici Hněvína je to den cesty. Kdo zaostane, zůstane tu navždy. |
| `k2.ves.01` | Strážný Matěj | Díky nebesům! Mysleli jsme, že tu umřeme jako ostatní. Půjdeme s vámi. |
| `k2.boj.01` | Jitka | Z lesa! Z obou stran! |
| `k2.brod.01` | Morvan | Radim z Bystré. Slyšel jsem o tobě. Tví mrtví sousedé o tobě mluví s láskou. |
| `k2.brod.02` | Radim z Bystré | Kdo jsi? Ukaž se! |
| `k2.brod.03` | Morvan | Jsem Morvan. Kdysi jsem býval dvorním mágem Goralie. Dnes jsem její budoucnost. |
| `k2.brod.04` | Bratr Kryštof | Lich. Prodal duši za věčný život a dostal věčnou smrt. |
| `k2.brod.05` | Morvan | Hezky řečeno, mnichu. Uvidíme, jak se ti bude kázat bez jazyka. |
| `k2.brod.06` | Morvan | Vstaňte, mí věrní! |
| `k2.brod.07` | Radim z Bystré | Rozbijte jim kosti! Pak přes brod! |
| `k2.boj.02` | Bratr Kryštof | Zrůda ze sešitých těl! Mířte na ni všichni najednou! |
| `k2.straz.01` | Strážný Matěj | Pomoc! Ze tmy lezou další! Strážnice dlouho nevydrží! |
| `k2.konec.01` | Vojvoda Hostivít | Radim z Bystré. Říká se, že jsi s hrstkou sedláků ubránil celou vesnici. |
| `k2.konec.02` | Radim z Bystré | Vojvodo. Mrtví vstávají. Za tvým hradem se otevřela brána a vede je lich jménem Morvan. |
| `k2.konec.03` | Vojvoda Hostivít | Vím. Viděl jsem je z hradeb. A viděl jsem mezi nimi... svého syna Vratislava. |
| `k2.konec.04` | Bratr Kryštof | Pane, to už není tvůj syn. Je to jen schránka, kterou nosí cizí vůle. |
| `k2.konec.05` | Vojvoda Hostivít | Mlč, mnichu! Neviděl jsi jeho tvář. |
| `k2.konec.06` | Vojvoda Hostivít | Hněvín se chystá na obléhání. Pomůžeš mi ho udržet, rytíři? |
| `k2.konec.07` | Radim z Bystré | Do posledního muže, vojvodo. |
| `k2.konec.08` | Jitka | Radime... viděl jsi jeho oči? Ten muž se bojí víc než my všichni. |

## Kapitola III: Obležení Hněvína

Hněvín obléhají hordy z hor. Radim musí vydržet do úsvitu, než dorazí knížecí vojsko. A Morvan má pro vojvodu nabídku.

| id | Postava | Text |
|---|---|---|
| `k3.uvod.01` | Vypravěč | Třetí noc obléhání. Z hor sestupovala mlha a s ní hordy, kterým nebylo konce. |
| `k3.uvod.02` | Vojvoda Hostivít | Posel z jihu přinesl zprávu. Kníže posílá vojsko, ale dorazí až za úsvitu. |
| `k3.uvod.03` | Radim z Bystré | Pak musíme vydržet do úsvitu. |
| `k3.uvod.04` | Vojvoda Hostivít | Hradby jsou staré a mužů je málo. Drž západní bránu, já budu držet východ. |
| `k3.uvod.05` | Bratr Kryštof | Pane, a co uděláš, až tvůj syn přijde k hradbám? |
| `k3.uvod.06` | Vojvoda Hostivít | ...To, co musím. |
| `k3.zjeveni.01` | Morvan | Hostivíte! Vojvodo Hněvína! Pojď blíž, mám pro tebe dar. |
| `k3.zjeveni.02` | Vratislav | Otče... je mi zima. Otče, proč jsi mě nechal v té zemi? |
| `k3.zjeveni.03` | Vojvoda Hostivít | Vratislave! Synu můj... |
| `k3.zjeveni.04` | Radim z Bystré | Hostivíte, stůj! Je to past! |
| `k3.zjeveni.05` | Morvan | Otevři mi Bránu, vojvodo, a vrátím ti ho. Celého. Teplého. Živého. |
| `k3.zjeveni.06` | Vojvoda Hostivít | ...Dej mi čas. |
| `k3.zjeveni.07` | Morvan | Čas mám, vojvodo. To ty ho nemáš. |
| `k3.boj.01` | Jitka | Radime, z hor jich jde dvakrát tolik! Morvan se nám vysmívá! |
| `k3.konec.01` | Vypravěč | Za úsvitu zazněly z jihu rohy. Knížecí vojsko dorazilo k Hněvínu. |
| `k3.konec.02` | Jitka | Radime! Vojvoda... Hostivít odešel severní bránou. Sám! |
| `k3.konec.03` | Vojvoda Hostivít | Morvane! Přišel jsem. Vrať mi syna. |
| `k3.konec.04` | Morvan | Nejdřív mi dej, co jsi slíbil. Odhoď prapor Hněvína a klekni, vojvodo. |
| `k3.konec.05` | Morvan | Vstaň, můj rytíři. Už nikdy neucítíš chlad. Ani teplo. Ani lítost. |
| `k3.konec.06` | Padlý Hostivít | Ano, můj pane. |
| `k3.konec.07` | Bratr Kryštof | Bože na nebesích... Ztratili jsme ho. |
| `k3.konec.08` | Radim z Bystré | Ještě ne. Půjdu za ním až k té bráně. A když bude třeba, zavřu ji jeho vlastním mečem. |

## Kapitola IV: Brána pekel

Poslední bitva. Za horským valem stojí Nekropole, Morvan a padlý vojvoda Hostivít. Zničte Nekropoli a zavřete Bránu navždy.

| id | Postava | Text |
|---|---|---|
| `k4.uvod.01` | Vypravěč | Hostivít padl do tmy a Morvanovi zbýval jediný krok: otevřít Bránu dokořán. |
| `k4.uvod.02` | Morvan | Slyšíš je, vojvodo? Tisíce mrtvých za Bránou. Čekají jen na tvůj rozkaz. |
| `k4.uvod.03` | Padlý Hostivít | Slyším jen jeden hlas. Kde je můj syn, Morvane? |
| `k4.uvod.04` | Morvan | Všude kolem tebe. V každém z nich je kousek Vratislava. |
| `k4.uvod.05` | Radim z Bystré | Tady to skončí. Zničíme Nekropoli a Brána se zavře. |
| `k4.uvod.06` | Bratr Kryštof | Morvanova moc proudí Nekropolí. Padne-li ona, padne i on. |
| `k4.uvod.07` | Jitka | A Hostivít? |
| `k4.uvod.08` | Radim z Bystré | Ten si vybral. Ale jestli v něm zbyl aspoň kousek člověka, najdu ho. |
| `k4.boj.02` | Hlas ze tmy | Moje tělo je jen schránka, rytíři! Dokud stojí Nekropole, já nezemřu! |
| `k4.vojvoda.01` | Padlý Hostivít | Radime... Viděl jsem ho. Nebyl to on. Nikdy to nebyl on. |
| `k4.vojvoda.02` | Radim z Bystré | Já vím, vojvodo. Už je konec. Odpočívej. |
| `k4.vojvoda.03` | Padlý Hostivít | Zavři tu bránu... a pohřbi mě v Hněvíně. Vedle syna. |
| `k4.konec.01` | Vypravěč | Nekropole se zřítila a z Brány vyšlehl poslední, zoufalý výkřik. |
| `k4.konec.02` | Hlas ze tmy | Tohle... není konec... Goralie jednou zapomene... a já se vrátím... |
| `k4.konec.03` | Bratr Kryštof | Brána je zavřená. Morvanův hlas utichl. |
| `k4.konec.04` | Jitka | Myslíš, že je pryč nadobro? |
| `k4.konec.05` | Bratr Kryštof | Zlo nikdy neumírá nadobro. Jen čeká, až zapomeneme. |
| `k4.konec.06` | Radim z Bystré | Tak nezapomeneme. Postavíme tu strážnici a každé jaro sem někdo přijde hlídat. |
| `k4.konec.07` | Vypravěč | Tak skončila zima mrtvých. Hostivít spočinul v Hněvíně vedle svého syna. A Goralie nezapomněla. |
