# Tunes

Lični muzički player bez pretplate. Na jednom mjestu spaja muziku sa računara i besplatne, legalne izvore:

| Izvor | Šta dobijaš | Ključ |
|---|---|---|
| Folder na računaru | MP3, FLAC, M4A, OGG, WAV… sa omotima i tagovima | – |
| Audius | Nezavisni izvođači koji sami objavljuju muziku za besplatno slušanje | – |
| Internet Archive | Live Music Archive (koncerti uz dozvolu izvođača), netlabel izdanja, stare ploče | – |
| Radio Browser | Preko 40.000 internet radio stanica, sa nazivom pjesme koja ide uživo | – |
| hearthis.at | DJ miksevi i elektronska muzika (offline kopije gdje izvođač dozvoljava preuzimanje) | – |
| Mixcloud | DJ setovi i radio emisije, u Mixcloudovom plejeru (bez preuzimanja) | – |
| SoundCloud | Pjesme, setovi i izvođači preko zalijepljenog linka, u SoundCloudovom plejeru | – |
| LRCLIB | Tekstovi pjesama, često sinhronizovani sa muzikom | – |
| ListenBrainz | Historija slušanja, statistike i preporuke (opciono) | token |
| Jamendo | Creative Commons muzika (opciono) | client ID |

## Pokretanje

Dvoklik na **`start.command`**. Otvoriće se `http://localhost:4545`.

Ručno iz terminala:

```bash
npm install
npm start
```

`npm start` prvo napravi interfejs (oko sekunde), pa pokrene server. Otvoreni prozori (tab, aplikacija u Docku, telefon) se sami osvježe kad se pojavi nova verzija interfejsa: odmah ako ništa ne svira, a inače ponude dugme Osvježi. Treba Node.js 22.18 ili noviji.

Za rad na interfejsu: `npm run dev` pokreće Vite sa automatskim osvježavanjem na `http://localhost:5173`, a zahtjeve šalje Tunes serveru koji radi uporedo (`npm start`).

Za telefon: klikni **Slušaj na mobitelu** u lijevom meniju i skeniraj QR kod kamerom telefona (ista Wi-Fi mreža). Link nosi tajni ključ, pa niko drugi u mreži ne može ući. Kad isključiš pristup, stari link prestaje raditi.

Van kuće: instaliraj [Tailscale](https://tailscale.com/download) na računar i telefon (isti nalog) i koristi karticu **Van kuće (Tailscale)**. Računar mora ostati upaljen.

Kad nešto svira na jednom uređaju, na drugom se pojavi traka **Nastavi ovdje**. Dodirni je i slušanje se nastavlja od iste sekunde, a prvi uređaj se pauzira.

Da izgleda kao prava aplikacija: klikni **Instaliraj aplikaciju** u lijevom meniju. U Chrome-u, Edge-u i Brave-u to odmah otvori instalaciju, a u ostalim preglednicima pokaže samo korake za taj preglednik (Safari: **File → Add to Dock**). Na telefonu se isto dugme zove **Dodaj na početni ekran**.

## Gdje je šta

- Muzika: `~/Music/Tunes` (u Postavkama možeš dodati još foldera). Nove pjesme se pojave same.
- Podaci (omiljene, plejliste, historija): `data/db.json`. Rezervna kopija: Postavke → Preuzmi kopiju.

## Mogućnosti

- Jezik: engleski, bosanski, srpski, hrvatski, slovenski, makedonski, albanski, njemački, španski, francuski, portugalski ili turski (Postavke), mijenja se bez prekidanja muzike. Tema, boje, jezik i izgled plejera se prenose na svaki browser i uređaj.
- Tema: crna, noćni indigo ili svijetla (Postavke)
- Prilagodi po svom ukusu: osam boja akcenta, bilo koja boja po izboru ili boja iz omota pjesme koja svira; „Sada svira” preko zamućenog omota, u bojama omota ili na običnoj pozadini; mali, normalni ili veliki tekst i prozračne ili kompaktne liste pjesama (posebno za svaki uređaj), uz pregled uživo u Postavkama. Postavke su podijeljene u tri taba: Izgled, Muzika te Reprodukcija i podaci
- Podijeli pjesmu ili plejlistu: pošalji link bilo kome (WhatsApp, Poruke…; na računaru ga kopiraj ili pokaži QR kod). Otvara se u besplatnoj verziji za telefon, spremno za puštanje, čuvanje u omiljene ili dodavanje u plejlistu, bez računa i aplikacije; podijeljena plejlista se čuva jednim dodirom. Samo pjesme s interneta i stanice: fajlovi s tvog računara ostaju tvoji, a podijeljena plejlista ih izostavi (i kaže koliko)
- Samo ono što koristiš: isključi izvore koji ti ne trebaju (nestanu iz menija, Pretrage, Otkrij i Početne) i izaberi koje sekcije Početna prikazuje i kojim redom
- Pretraga kroz sve izvore odjednom, sa kategorijama: pjesme, setovi i miksevi, albumi i koncerti, izvođači, radio. Kad pređeš mišem preko izvora, piše šta on nudi. Na iPhoneu tastatura ima dugme Search, koje i skloni tastaturu
- Jedan klik ili dodir pušta pjesmu u svakoj listi; na pjesmi koja svira pauzira i nastavlja, a na telefonu ta pjesma uvijek pokazuje dugme za pauzu
- Otkrij: popularna muzika sa Audius-a, DJ miksevi po žanru sa hearthis.at, popularni DJ setovi i radio emisije po žanru sa Mixclouda, koncerti sa Internet Archive-a
- Izdvojene radio stanice: ručno odabrane stanice bez reklama koje podržavaju slušaoci (Radio Paradise, NTS, FIP, KEXP, Radio Swiss Jazz) na vrhu stranice Radio, provjerene da sviraju i na računaru i na telefonu
- Stranice izvođača sa Audius-a (sve njihove pjesme i setovi)
- Izvođači, albumi, pjesme, omiljene
- Historija svega što pustiš (pjesme, miksevi i radio stanice), svaka stavka jednom po danu, s brojem slušanja, plus najslušaniji izvođači. ListenBrainz (opciono) dobija pjesmu po svom pravilu: pola pjesme ili 4 minuta
- Preuzimanja za slušanje bez interneta: pjesma, album, plejlista ili omiljene ostaju na uređaju dok ih ne obrišeš, za putovanja. Sortiranje, pretraga i vlastiti redoslijed na ekranu Preuzimanja
- Plejliste sa miješanim izvorima, promjena redoslijeda prevlačenjem, izvoz u M3U
- Pametne plejliste: Moj miks, Najslušanije, Zaboravljene omiljene, Nedavno dodano…
- Nasumično, ponavljanje, red za puštanje, tajmer za spavanje; jedno dugme otvara red i tekst pjesme, a svaka pjesma iz reda pušta se klikom na omot
- Ekvalizer sa 10 opsega i gotovim postavkama
- Izgled plejera: radio skala sa spektrom zvuka uživo, Minimalno (samo linija), Ogledalo ili U bojama; klik ili prevlačenje premotava
- Dugmad plejera na računaru: samo kad je miš iznad trake plejera (podrazumijevano), iznad trake napretka ili pored nje u jednom redu
- „Sada svira” preko cijelog ekrana sa tekstom pjesme; dugme za red mijenja tekst redom za puštanje, bez izlaska iz punog ekrana. Tekst dolazi iz samog fajla (ugrađen ili `.lrc` pored pjesme) ili sa LRCLIB-a, ali samo kad se izvođač, naslov i trajanje poklapaju
- Mini plejer: mali prozor uvijek na vrhu (Picture-in-Picture) sa omotom, dugmadima i napretkom
- Na telefonu: kompaktna traka plejera, a sve kontrole su u „Sada svira”. **Dodaj na početni ekran** (iPhone i Android), uz uputstvo i za Tailscale verziju
- Slušanje na mobitelu kod kuće (Wi-Fi) i van kuće (Tailscale), preko QR koda
- Offline buffer: trenutna i sljedeće pjesme se skidaju na telefon, pa muzika svira i kad nestane interneta. Pjesme koje nisu puštane 3 dana brišu se same
- Nastavak slušanja na drugom uređaju od iste sekunde (laptop → mobitel i obrnuto); muzika svira samo na jednom uređaju ili tabu
- Mixcloud: DJ setovi i radio emisije u pretrazi (Sve, Setovi i miksevi) i u Otkrij, puštaju se preko zvaničnog Mixcloud plejera koji stoji u malom prozoru koji se može spustiti
- SoundCloud linkovi: zalijepi link pjesme, seta ili izvođača u pretragu i svira preko zvaničnog SoundCloud plejera
- Ikonica aplikacije: četiri varijante u Postavke → Izgled; izbor važi na svim uređajima
- Tasteri za muziku na Mac-u i kontrolni centar; na zaključanom ekranu iPhonea i u CarPlay ekranu Now Playing: pjesma, omot, prethodna/sljedeća
- Čuvanje legalno preuzimljivih pjesama (Internet Archive, Jamendo, Audius gdje je dozvoljeno) u biblioteku
- Uvoz Spotify plejlisti preko Exportify CSV-a: pronalazi pjesme koje već imaš i pokazuje šta nedostaje
- Verzija samo za telefon na <https://ajdinl.github.io/tunes/>: bez računara i servera, otvori link na telefonu i dodaj ga na početni ekran. Online izvori, omiljene, plejliste, historija i preuzimanja, sve se čuva na telefonu

## Prečice

`Razmak` pusti/pauziraj, `← →` premotaj, `Shift + ← →` prethodna/sljedeća, `↑ ↓` jačina, `L` omiljena, `S` nasumično, `R` ponavljanje, `Q` red, `T` tekst, `E` ekvalizer, `F` cijeli ekran, `/` pretraga.

## Testovi

```
npx playwright install chromium   # jednom
npm test                          # provjera tipova, build, unit i API testovi (Vitest), end-to-end testovi (Playwright)
```

Testovi pokreću vlastite servere sa generisanom muzikom i lažnim internetom, pa ne diraju tvoje podatke i rade bez interneta. Detalji (na engleskom): [tests/README.md](tests/README.md).
