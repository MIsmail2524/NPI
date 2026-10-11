# NPI Global Trading: Store + Owner Dashboard

A complete online store for NPI Global Trading's hand tools, with a separate **Owner Dashboard** that a non-technical owner can use for everything: prices, photos, descriptions, stock, deals (Jumma Deal, flash sales…), orders and settings.

- **Shop:** `http://localhost:3000`
- **Owner Dashboard:** `http://localhost:3000/admin` (owner login required; there's also an "Owner login" link in the shop footer)

## First-time setup

```bash
npm install
npm run create-owner      # asks for the owner's email + password (no default password exists)
npm start
```

On first start the real catalog (57 products, 9 categories, from `data/catalog.json`) is loaded automatically, together with a weekly **Jumma Deal** (every Friday, 15% off 4 products).

## ⚠ Before going live: check prices and stock

Product prices are **opening estimates in PKR** and every product starts with **25 in stock**. The dashboard flags each product with "⚠ Check price" until the owner either edits the price or presses "It's correct ✓". Open **Products → ⚠ Check price** and go through them; it takes a few seconds per product. Set real stock in **Stock**.

## What the owner can do (no technical knowledge needed)

| Dashboard page | What it's for |
|---|---|
| Overview | Today's/7-day/30-day sales, new orders, low stock, best sellers, running deals |
| Products | Change price, sale price and stock **inline** (saves instantly); show/hide; feature; duplicate; bin with undo; bulk actions (e.g. "put 10 products on 15% sale") |
| Product editor | Name, category, photos (drag-and-drop; resized and background-removed automatically), **product video setup** (demo type, tap-to-place hinge/tip/close-ups, preview), **Tool Finder tags**, optional real video, price + one-tap discounts, bulk discount, stock in/out with reason and history, description, specs, uses, live preview |
| Stock | Receive / remove stock with a reason; full stock history |
| Deals & sales | Templates: Jumma Deal, Weekend Sale, Flash Sale, Category Sale, Clearance, Custom. Deals switch on/off automatically by day, time and date; customers see countdowns |
| Orders | New → Confirmed → Shipped → Delivered (or Cancelled, which restocks automatically); call / WhatsApp the customer; print invoice |
| Categories | Rename, reorder, cover photo, default hover clip |
| Customers, Reviews, Messages | Block customers, moderate reviews, answer enquiries (email / call / WhatsApp) |
| Store settings | Store texts, currency (Rs), time zone, delivery fee, free-delivery limit, bank details, pause ordering, contact numbers, change password |
| Activity log | Who changed what, plus failed login attempts |
| Backup & import | Download a full catalog backup; import/update products from a file |

## Product videos (every product)

Each product has an animated **product video**, rendered live in the browser from its real photo (`public/js/demo.js`). These are not filmed or AI-generated; they're animations of your real product photos.

1. **Intro:** the product on a spotlit studio stage with its name and price.
2. **Close-ups:** the camera zooms into each part and shows its specification ("Tip: Slotted + Phillips").
3. **In action:** the tool doing its job. Pliers open and close (the real photo is split at its hinge), screwdrivers drive screws, drill bits drill steel/wood/concrete with chips flying, the disc cuts tile on a grinder, tapes measure with a live reading, levels settle until the bubble is centred, hammers drive nails, rivet guns set rivets, and so on (27 demo types).
4. **Made for:** the product's uses.
5. **Get yours:** price and an Add to cart button.

Where it appears: hovering a product card plays the working demo, and on phones the card in the middle of the screen plays by itself. Clicking the product image opens the full video, and the product page shows it above the photos. Sound effects are off until the customer turns them on.

**Owner setup** (Dashboard → product → "Product video & Tool Finder"): pick what the video shows, pick the photo, then tap the photo to mark the hinge pin, working tip or bubble vial and one close-up spot per specification. Press "Preview the video". If the owner uploads a real video clip of the product, it's shown too.

## Tool Finder

`/finder` asks the customer about their job (screws, electrical, plumbing, nuts & bolts, measuring, levelling, drilling, carpentry, sheet metal, tiles). It then recommends the best-matching products with reasons, a video for each, alternatives and a one-tap kit. Matching uses each product's **Tool Finder tags**, which the owner sets in the product editor.

## Product photos

`scripts/build_catalog.py` turns the studio photos in `data/NPI Products/` into clean cut-outs: no white fringe, no floor shadow, and see-through holes. It writes a light 900 px image for the shop and a sharp 1600 px `-hd` image for video close-ups (about 13 MB in total, from 298 MB). File names contain a content hash, so browsers never show stale images. It needs Python 3 with Pillow and numpy, plus `gcc` (a tiny C helper, `scripts/fastfill.c`, is compiled automatically).

After rebuilding photos or changing video setups in the script, update an existing store **without losing anything** (prices, stock, orders and accounts are untouched):

```bash
python3 scripts/build_catalog.py
npm run sync-catalog
```

## Security

- Passwords hashed with scrypt; generic login errors; 5 wrong attempts lock an account for 15 minutes; rate limits on login, sign-up, orders, contact form and uploads.
- Sessions in HttpOnly SameSite cookies, rotated at login; owner sessions expire after 8 idle hours; changing a password logs out other devices.
- CSRF token + same-origin check on every change; strict Content-Security-Policy (no inline scripts), clickjacking protection, `nosniff`, HSTS in production.
- All output escaped (XSS-safe templating); every SQL query parameterised; every input validated and length-limited on the server.
- Prices, discounts and stock are always recalculated on the server at checkout; stock is reserved atomically, so two customers can't buy the last unit and stock can never go negative.
- Customers can only see their own orders; the owner dashboard and its files are only served to the logged-in owner.
- Uploads are checked by their real bytes (JPG/PNG/WEBP/GIF/MP4/WEBM only; SVG/HTML rejected), get random names, have GPS/EXIF data stripped, and are served in a sandbox.
- Full activity log of owner actions.

Run the automated checks with `npm test`.

## Going live (production)

1. Run behind HTTPS (e.g. nginx or Caddy as a reverse proxy) and start with `NODE_ENV=production` (secure cookies, HSTS). Behind a proxy also set `TRUST_PROXY=1`.
2. `HOST=0.0.0.0` if the proxy is on another machine (default listens on 127.0.0.1 only).
3. Back up `data/npi.sqlite` and the `uploads/` folder regularly. The dashboard's "Download backup" covers product data only.
4. Never set `NPI_RATE_MULT` in production (it exists only for tests).

## Project layout

```
server/            Express API (auth, store, owner API, pricing & deals engine, orders)
public/            Shop (index.html, css/, js/) and Owner Dashboard (admin/)
scripts/           build_catalog.py: photo processing + catalog
data/              catalog.json, database (npi.sqlite), original photos
uploads/           Web-ready product photos and owner uploads
test/              Automated API + security tests
legacy/npi.html    The previous single-page prototype (reference only)
```
