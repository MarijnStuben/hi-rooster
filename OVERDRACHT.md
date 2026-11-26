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

- **GitHub:** `MarijnStuben/hi-rooster`, branch `master`

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

Automatisch via GitHub Actions (`.github/workflows/deploy.yml`): elke push naar `master` zet de code op de droplet.

1. Back-up van de database naar `backups/pre-deploy-<datum>.db`.
2. Code kopiëren met rsync. `data/`, `backups/`, `node_modules/` en `.env` blijven onaangeraakt; er wordt niets verwijderd.
3. `npm install --omit=dev` en `pm2 restart hi-rooster --update-env`.

Benodigde repository secrets: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PATH`, `DEPLOY_SSH_KEY` (optioneel `DEPLOY_RESTART_CMD`).

Live code terughalen naar GitHub (als er ooit direct op de server is gewerkt): push een commit op een `claude/`-branch met `[sync-droplet]` in het bericht (`.github/workflows/sync-from-droplet.yml`).

**Beheer-API:** naast inloggen accepteren alle `/api/admin/*`-routes ook `Authorization: Bearer <ADMIN_API_TOKEN>`. Alleen actief als `ADMIN_API_TOKEN` (minimaal 32 tekens) in de pm2-omgeving staat.

## Automatische processen

- **Nachtelijke backup om 02:00** via cron op de server (SQL-dump).
- **Handmatige backup** via de Backups-tab in het adminpaneel.
- **Wekelijkse opschoning op maandag:** de app controleert elk uur of het maandag is. Dan worden datums vóór vandaag verwijderd, met aanmeldingen en personen. Vooraf wordt altijd een backup gemaakt. Dit draait alleen zolang de app draait.

## Functies in het adminpaneel

- **Wachtrij:** aanmeldingen goedkeuren, bewerken of afwijzen.
- **Klinieken:** klinieken en datums beheren. "Automatisch aanvullen" herkent het patroon uit de frequentieomschrijving van de kliniek en controleert dat tegen de historie. Er is altijd een voorbeeld (Voorbeeld) voordat er iets wordt opgeslagen.
- **Gepasseerde datums verwijderen:** verwijdert datums vóór vandaag, met automatische backup vooraf.
- **Weekoverzicht:** berichten voor vrijwilligers en de kliniek, en het vinkje "aangemeld bij kliniek".
- **Backups:** overzicht, downloaden en handmatig een backup maken (alleen beheerders).
- **Voorlichters:** profielen en ervaring bekijken, zoeken, bewerken, samenvoegen, verwijderen (alleen beheerders).
- **Gebruikers:** aanmelders en beheerders aanmaken, wachtwoord resetten, verwijderen (alleen beheerders).

## Gebruikers en rechten

Er zijn twee rollen (`users.role`):

- **admin** (beheerder met volledige rechten, bijvoorbeeld `bob`): ziet en doet alles, inclusief klinieken aanmaken/bewerken/verwijderen, gebruikers beheren, back-ups en "gepasseerde datums verwijderen".
- **manager** (aanmelder): ziet in wachtrij, weekoverzicht en klinieken alleen de klinieken waarvoor die persoon verantwoordelijk is (`clinics.manager_id`). Mag voor die klinieken aanmeldingen goedkeuren, afwijzen en bewerken, het vinkje "aangemeld bij kliniek" zetten, en datums toevoegen, vrijgeven, verwijderen en automatisch aanvullen.

Regels:

- Elke kliniek heeft hooguit één verantwoordelijke; één gebruiker kan meerdere klinieken hebben. Een kliniek zonder verantwoordelijke is alleen zichtbaar voor beheerders.
- Beheerders maken gebruikers aan in het tabblad **Gebruikers** (tijdelijk wachtwoord, minimaal 8 tekens). De nieuwe gebruiker moet het bij de eerste keer inloggen wijzigen (`users.must_change_password`). Een reset door een beheerder werkt hetzelfde en logt de gebruiker meteen uit.
- De verantwoordelijke koppel je in **Klinieken → Bewerken**.
- Rechten worden **op de server** afgedwongen (`requireAuth`, `adminOnly`, `guardDate`, `guardRegistration` in `server.js`), niet alleen in het scherm.
- Bestaande gebruikers werden bij de migratie `admin`, zodat niemand toegang verloor. Inloggen is niet hoofdlettergevoelig.
- Gebruikers kunnen zichzelf of de laatste beheerder niet verwijderen.
- De API-sleutel (`ADMIN_API_TOKEN`) heeft altijd beheerdersrechten.

## Voorlichters (profielen en ervaring)

Elke persoon die zich aanmeldt krijgt automatisch een **voorlichtersprofiel** (`educators`): voornaam, achternaam, geboortedatum, 06-nummer. Het tabblad **Voorlichters** (alleen beheerders) toont per profiel wie, wat en waar, en hoe vaak: *Voorlichting gegeven kliniek: N* en *Voorlichting gegeven PI: N*, met een vinkje als iemand eerder voorlichting gaf. In de wachtrij en het weekoverzicht staat dezelfde ervaring bij elke persoon (ook voor aanmelders, voor hun eigen klinieken).

- **Soort locatie:** elke kliniek is `kliniek` of `pi` (`clinics.type`). Bij de migratie is dat geraden aan de naam (P.I. / penitentiair / gevangenis = PI). Aanpassen kan bij Klinieken → Bewerken.
- **Wat telt als "gegeven":** een goedgekeurde aanmelding met een datum van vandaag of eerder, plus de geschiedenis (`educator_sessions`) en handmatig ingevulde eerdere aantallen (`prior_kliniek`, `prior_pi`).
- **Geschiedenis blijft bewaard:** de wekelijkse opschoning verwijdert datums en aanmeldingen, maar bewaart eerst de goedgekeurde voorlichtingen in `educator_sessions`. Dat geldt ook bij het handmatig verwijderen van een datum of kliniek.
- **Herkenning:** dezelfde persoon wordt herkend aan naam + geboortedatum (hoofdletters en accenten maken niet uit). Zonder geboortedatum wordt op naam gematcht als die maar bij één profiel hoort. Profielen met ontbrekende gegevens krijgen het label *Onvolledig*. Typfouten geven een tweede profiel; die kun je **samenvoegen** (de oude schrijfwijze blijft herkend).
- **Profiel verwijderen** haalt het profiel en de ervaring weg; de aanmeldingen zelf blijven tot de opschoning, maar krijgen geen nieuw profiel.
- **Privacy:** profielen bewaren naam, geboortedatum en 06-nummer ook nadat de aanmelding is opgeschoond. Verwijder een profiel als iemand daarom vraagt.

### Geschiedenis importeren uit back-ups

`tools/import-voorlichters.js` leest alle back-ups (`backups/*.sql` en `*.db`) en voegt goedgekeurde voorlichtingen uit het verleden toe. Op de server:

```bash
cd /var/www/hi-rooster
node tools/import-voorlichters.js            # proefrun, wijzigt niets
node tools/import-voorlichters.js --apply    # echt uitvoeren (maakt eerst backups/pre-import-*.db)
```

Of via GitHub: een commit op een `claude/`-branch met `[import-dry]` of `[import-apply]` in het bericht. Meerdere keren draaien is veilig (niets wordt dubbel geteld), maar draai het liever eenmalig: een verwijderd of samengevoegd profiel kan door een nieuwe import terugkomen. Er worden maximaal 14 back-ups bewaard, dus de geschiedenis reikt niet verder terug dan die back-ups. Eerdere voorlichtingen kunnen per profiel handmatig worden opgeteld.

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
