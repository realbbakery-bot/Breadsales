# Breadsales 🥖 — orders & inventory for home bakers

A small, bilingual (formal Arabic / English) web app for home and micro bakers.

- **Customers** open one link (share it on Instagram / WhatsApp). They see what is in stock, pick items, choose a pickup date and reserve. No app install and no account needed.
- **Stock is deducted automatically** when an order is placed. This happens inside a database transaction, so two customers can never both buy the last loaf.
- **Bakers** use a phone-friendly dashboard at `/admin` to:
  - see today's orders and what to hand over
  - mark orders *ready* or *picked up*, or cancel them (cancelling puts the items back into stock)
  - adjust stock with +/− buttons, add items with photos, and open or close the shop with one switch
- After ordering, the customer can **send the order to the baker on WhatsApp** in one tap. The baker can message or call any customer from the order card.

## Run it

Requires **Node.js 22.13 or newer**. There are no other dependencies and nothing to `npm install`.

```bash
ADMIN_PASSWORD='choose-a-strong-one' npm start
# Shop:      http://localhost:3000/
# Dashboard: http://localhost:3000/admin
npm run seed   # optional: adds 5 sample products
npm test       # 15 tests: stock deduction, no overselling, restocking, auth
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
  - cancelling an order returns its items to stock
- **One stock pool per item, not per bake day.** This suits a "drop" model: bake on Friday, set the stock, sell out. If you take pre-orders for several different bake days at once, you need per-day stock. That is the next feature to add.
- One bakery per installation. It is not a multi-baker marketplace.
