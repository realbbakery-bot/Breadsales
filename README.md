# Breadsales 🥖 — orders & inventory for home bakers

A small, bilingual (formal Arabic / English) web app for home and micro bakers.

Built for bakers who bake **once or twice a week** (artisan sourdough and similar).

- **Bake days.** The baker plans each bake: the date, when orders close (for example the evening before, so they know the count before building the levain), and how many of each item they will bake. A new bake day is pre-filled from the last one, one week later with the same quantities.
- **Customers** open one link (share it on Instagram / WhatsApp). They pick a bake day, see what is left for it, and reserve. No app install and no account needed.
- **Inventory updates automatically.** Each order reserves from that bake day's quantities. The check and the reservation happen inside a single database transaction, so a bake can never be oversold. Cancelling an order frees its items. Raising a quantity takes effect immediately. A quantity can't be lowered below what is already reserved.
- **Bakers** use a phone-friendly dashboard at `/admin`:
  - **Bake sheet:** what to bake for a given day, sales, and how full each item is
  - **Bake days:** plan a bake, pause one, see each bake's orders
  - **Orders:** mark *ready* or *picked up*, cancel, WhatsApp or call the customer
  - **Menu:** items with photos, prices, a usual quantity per bake, and an optional per-order limit
  - **Settings:** default order cutoff, shop on/off switch, currency, WhatsApp
- After ordering, the customer can **send the order to the baker on WhatsApp** in one tap. The baker can message or call any customer from the order card.

## Run it

Requires **Node.js 22.13 or newer**. There are no other dependencies and nothing to `npm install`.

```bash
ADMIN_PASSWORD='choose-a-strong-one' npm start
# Shop:      http://localhost:3000/
# Dashboard: http://localhost:3000/admin
npm run seed   # optional: sample sourdough menu + 2 bake days
npm test       # 19 tests: reservations, no overselling, cutoffs, cancel, auth
```

If you start without `ADMIN_PASSWORD`, the server prints a one-time **setup code** in its log. Enter that code at `/admin` to create a password.

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | Where the SQLite database and uploaded photos live. **Back this folder up.** |
| `ADMIN_PASSWORD` | – | Sets the dashboard password on first start |
| `TRUST_PROXY` | – | Set to `1` behind a hosting proxy (Render, Railway, Fly) so rate limits and secure cookies work |
| `TZ` | server's | Set to your timezone, e.g. `Asia/Riyadh`, so "today" and pickup dates are correct |

## Hosting

The app must run on a server so that every customer sees the same stock. Any host that runs Node and has a **persistent disk** works, for example:

- Render with a disk
- Railway with a volume
- Fly.io with a volume
- a small VPS

Point `DATA_DIR` at the persistent disk. Free tiers that wipe the disk on every restart will lose your orders.

## Defaults to change in Settings

- Currency is set to SAR (ر.س) and the country calling code to 966. Change both in **Settings**.
- Add your WhatsApp number so customers can send their orders to you.

## Known limits (v1)

- **No online payment.** Orders are reservations, paid on pickup. Fake or no-show orders are possible. Limits in place:
  - 10 orders per hour per connection
  - an optional "max per order" for each item
  - cancelling an order frees its items
  - order cutoffs

  A deposit through a payment provider is the real fix if no-shows become a problem.
- **Bake days are created by hand** (pre-filled, so it is a few taps). Fully automatic recurring schedules are not built.
- **No automatic notifications.** The baker sees new orders in the dashboard. Customers message the baker on WhatsApp in one tap.
- One bakery per installation. It is not a multi-baker marketplace.
- The database format changed when bake days were added. An install from the earlier version must start with an empty `DATA_DIR`.
