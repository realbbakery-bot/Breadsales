# Breadsales 🥖 — orders & inventory for home bakers

A small, bilingual (formal Arabic / English) web app for home and micro bakers.

Built for bakers who bake **once or twice a week** (artisan sourdough and similar).

### The baker's week

1. **Recipes (baker's math).** Each bread gets a formula in baker's percentages (flours = 100%), a dough weight per piece, a dough-loss % and the levain's hydration. The editor checks that the flours add up to 100%. It shows formula and overall hydration (counting the levain's own flour and water) and previews the weights for any number of loaves.
2. **Production.** Pick a bake day and set the loaves per bread. Start from the current quantities, or from *orders + extra* once the cutoff has passed. You get the grams of every ingredient per bread, one combined weighing list, and how much levain to build (split into flour and water). The page prints cleanly for the kitchen.
3. **Apply → inventory.** One button publishes those loaf counts as the bake day's available quantities. The shop sells from them immediately. Quantities can't go below what customers have already reserved.
4. **Sales.** Customers reserve until the cutoff. The bake sheet and orders tabs track everything to pickup.

- **Bake days.** The baker plans each bake: the date, when orders close (for example the evening before, so they know the count before building the levain), and how many of each item they will bake. A new bake day is pre-filled from the last one, one week later with the same quantities.
- **Customers** open one link (share it on Instagram / WhatsApp). They pick a bake day, see what is left for it, and reserve. No app install and no account needed.
- **Inventory updates automatically.** Each order reserves from that bake day's quantities. The check and the reservation happen inside a single database transaction, so a bake can never be oversold. Cancelling an order frees its items. Raising a quantity takes effect immediately. A quantity can't be lowered below what is already reserved.
- **Bakers** use a phone-friendly dashboard at `/admin`:
  - **Bake sheet:** what to bake for a given day, sales, and how full each item is
  - **Bake days:** plan a bake, pause one, see each bake's orders
  - **Orders:** mark *ready* or *picked up*, cancel, WhatsApp or call the customer
  - **Production:** dough calculator and weighing list per bake day
  - **Menu:** items with photos, prices, a usual quantity per bake, an optional per-order limit, and each item's recipe
  - **Settings:** default order cutoff, shop on/off switch, currency, WhatsApp
- After ordering, the customer can **send the order to the baker on WhatsApp** in one tap. The baker can message or call any customer from the order card.

## Run it

Requires **Node.js 22.13 or newer**. There are no other dependencies and nothing to `npm install`.

```bash
ADMIN_PASSWORD='choose-a-strong-one' npm start
# Shop:      http://localhost:3000/
# Dashboard: http://localhost:3000/admin
npm run seed   # optional: sample sourdough menu, 4 recipes, 2 bake days
npm test       # 24 tests: baker's math, reservations, no overselling, cutoffs, auth
```

If you start without `ADMIN_PASSWORD`, the server prints a one-time **setup code** in its log. Enter that code at `/admin` to create a password.

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | Where the SQLite database and uploaded photos live. **Back this folder up.** |
| `ADMIN_PASSWORD` | – | Single-bakery mode: sets the dashboard password on first start |
| `OWNER_PASSWORD` | – | Turns on multi-bakery hosting and protects the owner console |
| `TRUST_PROXY` | – | Set to `1` behind a hosting proxy (Render, Railway, Fly) so rate limits and secure cookies work |
| `TZ` | server's | Set to your timezone, e.g. `Asia/Riyadh`, so "today" and pickup dates are correct |

## Hosting many bakeries under their own names

Set `OWNER_PASSWORD` and the same server hosts any number of bakeries, each on its own domain, with fully separate data. A private owner console lets you add bakeries, connect domains, reset passwords, suspend and back up. **See [docs/HOSTING.md](docs/HOSTING.md)** for the step-by-step server setup (Docker + Caddy, automatic HTTPS) and the checklist for onboarding each baker.

Without `OWNER_PASSWORD` the app runs as a single bakery, as in **Run it** above. That is handy for trying it locally.

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
- **Baker's math convention:** levain is entered as its own percentage of the main flour. Its flour is not part of the 100%, but it does count in the overall hydration. Recipes that list prefermented flour as part of the 100% need converting.
- No ingredient stock or costing yet: the weighing list says what to weigh, not what is in the pantry or what a loaf costs.
- One bakery per installation. It is not a multi-baker marketplace.
- The database format changed when bake days were added. An install from the earlier version must start with an empty `DATA_DIR`.
