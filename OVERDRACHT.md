# Overdracht: H&I Rooster

Webapplicatie voor het voorlichtingsrooster van H&I. Vrijwilligers melden zich aan voor voorlichtingen bij instellingen. Beheerders beheren aanmeldingen, klinieken en datums via het adminpaneel.

Wachtwoorden (beheerder `bob`, SSH, GitHub) staan in de wachtwoordmanager van Marijn. Ze horen niet in een bestand of in een chat.

## Live omgeving

- **Website:** https://rooster-hi.nl
- **Adminpanel:** https://rooster-hi.nl/admin
- **Server:** DigitalOcean Droplet, IP `209.38.99.165`, SSH als `root`
- **Database:** `/var/www/hi-rooster/data/hi-rooster.db` (SQLite, niet in Git)
- **Backups:** `/var/www/hi-rooster/backups/` (laatste 14 bewaard)

## Repository

- **GitHub:** `git@github.com:MarijnStuben/hi-rooster.git`, branch `main`

## Stack

- Node.js + Express (`server.js`), SQLite via `better-sqlite3` (`db.js`)
- Auth: `express-session` + `bcryptjs`
- Proces: PM2 (`pm2 status`, `pm2 logs hi-rooster`, `pm2 restart hi-rooster`)
- Nginx als reverse proxy (stuurt `X-Forwarded-For` door), Let's Encrypt SSL met automatische verlenging

## Projectstructuur

- `server.js`: Express-routes, backup-functies, login-blokkade, wekelijkse opschoning
- `db.js`: schema, migraties, queries, seed-data
- `schedule.js`: herkenning van datumpatronen (omschrijving en historie) en het genereren van toekomstige datums
- `public/`: publieke roosterpagina
- `admin/`: adminpaneel
- `backups/`, `data/`: niet in Git (persoonsgegevens)

## Deployment

```bash
git add <bestanden>
git commit -m "omschrijving"
git push
ssh root@209.38.99.165 "cd /var/www/hi-rooster && git pull && pm2 restart hi-rooster --update-env"
```

Commit alleen bestanden die je bewust wijzigt.

## Automatische processen

- **Nachtelijke backup om 02:00** via cron op de server (SQL-dump).
- **Handmatige backup** via de Backups-tab in het adminpaneel.
- **Wekelijkse opschoning op maandag:** de app controleert elk uur of het maandag is. Dan worden datums vóór vandaag verwijderd, met aanmeldingen en personen. Vooraf wordt altijd een backup gemaakt. Dit draait alleen zolang de app draait.

## Functies in het adminpaneel

- **Wachtrij:** aanmeldingen goedkeuren, bewerken of afwijzen.
- **Klinieken:** klinieken en datums beheren. "Automatisch aanvullen" herkent het patroon uit de frequentieomschrijving van de kliniek en controleert dat tegen de historie. Er is altijd een voorbeeld (Voorbeeld) voordat er iets wordt opgeslagen.
- **Gepasseerde datums verwijderen:** verwijdert datums vóór vandaag, met automatische backup vooraf.
- **Weekoverzicht:** berichten voor vrijwilligers en de kliniek, en het vinkje "aangemeld bij kliniek".
- **Backups:** overzicht, downloaden en handmatig een backup maken.

## Domeinregels

- **Klinieken:** 13 actief. Het patroon per kliniek staat in het veld `frequency`. Dat veld is vrije tekst en varieert sterk; controleer bij twijfel de historie.
- **Youzz Jeugdkliniek** heeft `allow_public_signup = 0`: aanmeldingen gaan daar alleen via de admin.
- **Bericht 1** = controle bij de vrijwilliger vóór aanmelding.
- **Bericht 2** = aanmelding bij de kliniek. Geen telefoonnummers; de contactgegevens van de kliniek staan als los klikbaar blok erboven.
- **WhatsApp op de publieke site:** Marijn, 06-18904592.

## Openstaande aandachtspunten

1. **Emergis Dubbeldiagnose en Emergis Verslavingszorg:** de historische weekdagen zijn niet consistent (dinsdag, donderdag en woensdag door elkaar). Toegevoegde datums daar zijn minder zeker. Controleer dit met Marijn.
2. **Wachtwoord van `bob`** is eerder in een chat gedeeld. Laat Marijn het wijzigen.
3. **SESSION_SECRET** moet op de server staan (pm2-omgeving). Zonder die variabele worden beheerders bij elke herstart uitgelogd.
4. **Opschoning op maandag** draait alleen als de app dan draait.
5. **Lokaal `better-sqlite3`:** na een wijziging van de Node-versie: `npm rebuild better-sqlite3`.

## Handige commando's op de server

```bash
pm2 status
pm2 logs hi-rooster
pm2 restart hi-rooster --update-env
nginx -t && systemctl reload nginx
crontab -l
```
