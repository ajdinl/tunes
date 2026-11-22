# Slušaonica

Lični muzički player bez pretplate. Na jednom mjestu spaja muziku sa računara i besplatne, legalne izvore:

| Izvor | Šta dobijaš | Ključ |
|---|---|---|
| Folder na računaru | MP3, FLAC, M4A, OGG, WAV… sa omotima i tagovima | – |
| Audius | Nezavisni izvođači koji sami objavljuju muziku za besplatno slušanje | – |
| Internet Archive | Live Music Archive (koncerti uz dozvolu izvođača), netlabel izdanja, stare ploče | – |
| Radio Browser | Preko 40.000 internet radio stanica, sa nazivom pjesme koja ide uživo | – |
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

Za telefon: klikni **Slušaj na mobitelu** u lijevom meniju i skeniraj QR kod kamerom telefona (ista Wi-Fi mreža). Link nosi tajni ključ, pa niko drugi u mreži ne može ući. Kad isključiš pristup, stari link prestaje raditi.

Da izgleda kao prava aplikacija: u Safari-ju odaberi **File → Add to Dock**, a u Chrome-u ili Brave-u klikni ikonicu za instalaciju u adresnoj traci.

## Gdje je šta

- Muzika: `~/Music/Biblioteka` (u Postavkama možeš dodati još foldera). Nove pjesme se pojave same.
- Podaci (omiljene, plejliste, historija): `data/db.json`. Rezervna kopija: Postavke → Preuzmi kopiju.

## Mogućnosti

- Jezik: bosanski ili engleski (Postavke)
- Tema: crna ili noćni indigo (Postavke)
- Pretraga kroz sve izvore odjednom, sa kategorijama: pjesme, setovi i miksevi, albumi i koncerti, izvođači, radio
- Stranice izvođača sa Audius-a (sve njihove pjesme i setovi)
- Izvođači, albumi, pjesme, omiljene, historija sa statistikom
- Plejliste sa miješanim izvorima, promjena redoslijeda prevlačenjem, izvoz u M3U
- Pametne plejliste: Moj miks, Najslušanije, Zaboravljene omiljene, Nedavno dodano…
- Nasumično, ponavljanje, red za puštanje, tajmer za spavanje
- Ekvalizer sa 10 opsega i gotovim postavkama
- Skala sa spektrom zvuka uživo; klik ili prevlačenje premotava
- „Sada svira” preko cijelog ekrana sa tekstom pjesme
- Tasteri za muziku na Mac-u i kontrolni centar (Media Session)
- Čuvanje legalno preuzimljivih pjesama (Internet Archive, Jamendo, Audius gdje je dozvoljeno) u biblioteku
- Uvoz Spotify plejlisti preko Exportify CSV-a: pronalazi pjesme koje već imaš i pokazuje šta nedostaje

## Prečice

`Razmak` pusti/pauziraj, `← →` premotaj, `Shift + ← →` prethodna/sljedeća, `↑ ↓` jačina, `L` omiljena, `S` nasumično, `R` ponavljanje, `Q` red, `T` tekst, `E` ekvalizer, `F` cijeli ekran, `/` pretraga.
