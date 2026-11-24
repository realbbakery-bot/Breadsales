# Hosting bakeries under their own names

One server hosts every bakery. Each bakery is reached only through **its own domain**
(`sarahsbakery.com`). It has its own database, photos and login. Your name never appears
anywhere a customer can see.

```
sarahsbakery.com ─┐                       ┌─ data/bakeries/sarahs-bakery/  (Sarah's orders, menu, photos)
noorbread.com ────┼─► Caddy (HTTPS) ─► app ┼─ data/bakeries/noor-bread/
console.<yours> ──┘                       └─ owner console (only you)
```

## Why a small VPS (and not Railway/Render)

Every bakery brings its own domain, and hosting platforms limit domains per app:

- **Railway:** 2 custom domains per service on Hobby, 20 on Pro.
- **Render:** 2 per workspace on Hobby, 15 on Pro, then $0.25 a month for each extra domain.

A VPS running Caddy has **no domain limit**, and Caddy issues each certificate automatically.
Any provider works (Hetzner, DigitalOcean, Vultr…). The smallest plan, about 1–2 GB of RAM, is
plenty for dozens of home bakeries.

## One-time server setup (about 30 minutes)

1. **Create the server:** Ubuntu 24.04, smallest plan. Turn on the provider's automatic
   backups/snapshots too: that is a second, off-server copy of everything.
2. **Point your console address at it.** In your own domain's DNS, add an **A record**
   `console` → the server's IP address. That gives you `console.alamalkhubz.com`.
   Customers never see this address.
3. **Install Docker** on the server (`curl -fsSL https://get.docker.com | sh`).
4. **Copy this project to the server**, for example with `git clone`.
5. **Configure and start:**
   ```bash
   cd Breadsales/deploy
   cp .env.example .env
   nano .env        # set OWNER_PASSWORD, OWNER_DOMAIN, ACME_EMAIL, TZ
   docker compose up -d --build
   ```
6. **Check it.** Open `https://console.alamalkhubz.com` and log in with `OWNER_PASSWORD`.

## Adding a bakery (about 10 minutes each)

1. **The baker buys her domain**, e.g. `sarahsbakery.com` (about $10–15 a year at Namecheap,
   GoDaddy, Cloudflare…). It should be bought **in her name**, so she owns it.
2. **In her domain's DNS settings**, she (or you, with her login) adds two records:

   | Type | Name | Value |
   |---|---|---|
   | A | `@` | your server's IP |
   | A | `www` | your server's IP |

3. **In your owner console**, click **Add a bakery** and enter:
   - her name in English and Arabic
   - her domain (`sarahsbakery.com`). `www.` works automatically.

   Then copy the generated password and send it to her privately.
4. **Wait for DNS** (usually minutes, sometimes a few hours). Then open `https://sarahsbakery.com`.
   The first visit takes a few seconds while the certificate is issued.
5. **She logs in** at `https://sarahsbakery.com/admin` and does four things:
   - changes her password
   - fills in **Settings** (WhatsApp, currency, pickup info)
   - adds her **Menu** and recipes
   - plans her first **Bake day**
6. **She shares `https://sarahsbakery.com`** on Instagram, TikTok and WhatsApp. The link preview
   shows her bakery's name.

## Day to day

| Task | Where |
|---|---|
| Baker forgot her password | Console → **Reset baker password** → send her the new one |
| Baker stopped paying | Console → **Suspend**. The shop goes offline and all data is kept. **Reactivate** brings it back as it was. |
| Download a bakery's data | Console → **Backup** (database file), or the baker's own **Settings → Download my data** (readable JSON) |
| Automatic backups | Every day, every bakery is copied to `/data/backups/<date>/`, and the last 14 days are kept |
| Update the app for everyone | On the server: `git pull && docker compose up -d --build` (in `deploy/`) |

## Copying backups off the server

The daily backups live on the same server as the data. They protect against mistakes and bugs,
**not** against losing the server. Keep at least one copy elsewhere:
- turn on your VPS provider's snapshot backups, and/or
- download the **Backup** files from the console now and then.
