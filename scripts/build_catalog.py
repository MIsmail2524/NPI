#!/usr/bin/env python3
"""
Builds the real NPI product catalog from the studio photos in data/NPI Products/.

  python3 scripts/build_catalog.py

For every photo it: auto-rotates, removes the white studio background (flood-fill
from the edges, so white handles inside the tool are kept), keeps the studio
shadow as a soft dark shadow, trims, resizes to 1000px and saves a light WebP
into uploads/. It then writes data/catalog.json, which the server loads on first
start. Prices are opening estimates in PKR and are flagged "to confirm" in the
owner dashboard until the owner edits them.
"""
import json, os, sys
from collections import deque
from PIL import Image, ImageOps, ImageFilter, ImageDraw
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PIPELINE_VERSION = 'cutout-v5'  # bump when the cut-out algorithm changes
SRC = os.path.join(ROOT, 'data', 'NPI Products')
OUT = os.path.join(ROOT, 'uploads')
os.makedirs(OUT, exist_ok=True)

CATEGORIES = [
    # slug, name, motion used for hover clips
    ('screwdrivers', 'Screwdrivers & Bits', 'twist'),
    ('pliers', 'Pliers & Pincers', 'snip'),
    ('cutters', 'Cutters, Saws & Blades', 'snip'),
    ('wrenches', 'Wrenches, Sockets & Keys', 'turn'),
    ('tapes', 'Measuring Tapes', 'pull'),
    ('levels', 'Spirit Levels', 'tilt'),
    ('hammers', 'Hammers', 'swing'),
    ('drilling', 'Drill Bits', 'drill'),
    ('riveting', 'Rivet Tools', 'squeeze'),
]

# id, category, name, price (PKR), photos, specs, description, uses, extra
P = []
def add(cat, name, price, photos, specs, desc, uses, motion=None, featured=False, sku=None):
    P.append(dict(cat=cat, name=name, price=price, photos=photos, specs=specs, desc=desc, uses=uses,
                  motion=motion, featured=featured, sku=sku))

# ---------------- Screwdrivers & bits ----------------
add('screwdrivers', 'NPI 2-Way Insulated Screwdriver', 950,
    ['2 way insolated screw driver .jpg', '2 way npi screw driver .jpg', 'Pach ks 2 way .jpg'],
    [('Type', 'Interchangeable 2-way blade'), ('Tips', 'Slotted + Phillips'), ('Blade', 'Fully insulated shaft'), ('Handle', 'Two-tone soft grip')],
    'An electrician\'s screwdriver with a fully insulated, reversible blade: slotted on one end, Phillips on the other. Pull the blade out, flip it and you have the second tip in seconds. The bright red-and-yellow soft-grip handle is easy to spot in a tool bag and comfortable for long panel jobs.',
    ['Switchboard and DB panel work', 'Socket and switch fitting', 'Appliance repair', 'General household fixing'], featured=True)
add('screwdrivers', 'NPI 2-Way Screwdriver (Full Rod)', 650,
    ['2 way npi full rod.jpg', 'npi full rod yellow .jpg', '2 way scrwdriver rod.jpg'],
    [('Type', 'Interchangeable through-rod'), ('Tips', 'Slotted + Phillips'), ('Rod', 'Hardened steel, reversible'), ('Handle', 'Yellow/black ergonomic grip')],
    'One handle, two drivers. The hardened steel rod slides fully through the handle and reverses from slotted to Phillips. The contoured yellow-and-black grip gives you real turning force without blisters.',
    ['Furniture assembly', 'Cabinet hinges and handles', 'Workshop and garage use', 'Everyday home repairs'])
add('screwdrivers', 'NPI Screwdriver (Black & White Grip)', 450,
    ['screwdriver npi insolated.jpg', 'npi screwdriver 2 insolated.jpg'],
    [('Tip', 'Slotted'), ('Shaft', 'Chrome steel'), ('Handle', 'Black/white anti-slip grip')],
    'A dependable everyday screwdriver with a chrome steel shaft and a chunky black-and-white anti-slip handle that stays grippy even with oily hands.',
    ['General repairs', 'Electrical fittings', 'Workshop bench use'])
add('screwdrivers', 'Milestone Flat Screwdriver (Orange Grip)', 380,
    ['plase red milestone.jpg'],
    [('Tip', 'Wide slotted'), ('Shaft', 'Hardened steel'), ('Handle', 'Ribbed orange/black grip')],
    'A heavy-duty flat screwdriver with a wide, hardened tip and a ribbed two-tone handle for maximum torque on stubborn slotted screws.',
    ['Stubborn slotted screws', 'Machinery maintenance', 'Light prying and scraping'])
add('screwdrivers', 'Super Flat Screwdriver (Yellow Grip)', 350,
    ['plase super.jpg'],
    [('Tip', 'Slotted'), ('Shaft', 'Hardened steel'), ('Handle', 'Textured yellow/black grip')],
    'A compact slotted screwdriver with a textured anti-slip handle: the go-to driver for daily jobs around the house and shop.',
    ['Household repairs', 'Electrical covers and plates', 'Toolbox essential'])
add('screwdrivers', 'Milestone Phillips Screwdriver (Yellow Grip)', 380,
    ['nose plase milestone 1.jpg'],
    [('Tip', 'Phillips'), ('Shaft', 'Hardened steel'), ('Handle', 'Cushioned yellow/black grip')],
    'A precise Phillips screwdriver with a cushioned grip. The tip seats deep in cross-head screws to reduce slipping and cam-out.',
    ['Cross-head screws', 'Furniture and fixtures', 'Appliance panels'])
add('screwdrivers', 'NPI Double-End Screwdriver Bits (10 pcs)', 750,
    ['screrw bits npi .jpg'],
    [('Pieces', '10'), ('Steel', 'S2 alloy'), ('Type', 'Double-ended PH2'), ('Pack', 'Hanging storage case')],
    'Ten double-ended S2-steel bits in a reusable hanging case. Each bit has two working ends, so you get twice the life before you swap.',
    ['Cordless drill/driver use', 'Drywall and gypsum fixing', 'Furniture assembly lines', 'Roofing and cladding'], featured=True)
add('screwdrivers', 'NPI Magnetic Ring Screw Bits PH2 (5 pcs)', 850,
    ['screw bit npi 3.jpg', 'screw bit .jpg'],
    [('Pieces', '5'), ('Tip', 'PH2'), ('Feature', 'Magnetic holding ring'), ('Steel', 'S2 impact grade')],
    'Impact-grade PH2 bits with a gold magnetic ring that holds the screw firmly on the tip. Start screws one-handed, even overhead.',
    ['Impact drivers', 'Overhead and ceiling work', 'Gypsum board fixing', 'Steel-frame screws'])
add('screwdrivers', 'NPI Double-End PH2 Bits (2 pcs)', 180,
    ['screw bit 1.jpg'],
    [('Pieces', '2'), ('Tip', 'PH2 both ends'), ('Steel', 'S2 alloy')],
    'A spare pair of double-ended PH2 bits. Keep them in your pocket so you never stop a job for a worn bit.',
    ['Cordless drills', 'Spare bits for the site'])

# ---------------- Pliers & pincers ----------------
add('pliers', 'Milestone Combination Pliers (Orange Grip)', 1250,
    ['plase milestone 1.jpg', 'plase milestone red.jpg'],
    [('Type', 'Combination'), ('Jaws', 'Gripping + side cutter'), ('Handle', 'Dual-material orange/black')],
    'Grip, twist, bend and cut with one tool. Serrated jaws hold firmly, and the hardened side cutter snips wire cleanly. The dual-material handles reduce hand fatigue.',
    ['Electrical wiring', 'Bending and twisting wire', 'Gripping nuts and fittings', 'General maintenance'], featured=True)
add('pliers', 'Milestone Combination Pliers (Yellow Grip)', 1250,
    ['plase milestone yellow .jpg', 'plase yellow grip milestone.jpg'],
    [('Type', 'Combination'), ('Jaws', 'Gripping + side cutter'), ('Handle', 'Dual-material yellow/black')],
    'The same tough combination pliers in high-visibility yellow: easy to find in a crowded toolbox.',
    ['Electrical wiring', 'Wire cutting', 'Gripping and bending'])
add('pliers', 'Milestone Combination Pliers (Red/White Grip)', 1250,
    ['plase milestone.jpg', 'milestone plase 2.jpg'],
    [('Type', 'Combination'), ('Jaws', 'Gripping + side cutter'), ('Handle', 'Red/white comfort grip')],
    'Classic combination pliers with a premium red-and-white comfort grip and precision-ground jaws.',
    ['Electrical wiring', 'Wire cutting', 'Home and workshop use'])
add('pliers', 'Long Nose Pliers (Red/White Grip)', 1100,
    ['nose plas npi red.jpg', 'nose plase milestone.jpg'],
    [('Type', 'Long nose'), ('Jaws', 'Serrated tip + cutter'), ('Handle', 'Red/white comfort grip')],
    'Long, slim jaws reach into tight spaces to grip small parts, bend loops in wire and pull pins, with a built-in cutter near the pivot.',
    ['Electronics and fine wiring', 'Bending wire loops', 'Retrieving small parts', 'Jewellery and crafts'])
add('pliers', 'Milestone Long Nose Pliers (Yellow Grip)', 1100,
    ['nose plas milestone 2.jpg', 'nose plase ms .jpg'],
    [('Type', 'Long nose'), ('Jaws', 'Serrated tip + cutter'), ('Handle', 'Yellow/black dual-material')],
    'Precision long nose pliers with a high-visibility yellow grip, made for reaching where fingers can\'t.',
    ['Panel wiring', 'Tight-space gripping', 'Wire forming'])
add('pliers', 'Milestone Long Nose Pliers (Orange Grip)', 1100,
    ['nose plase milestone .jpg', 'nosse plase milestone 4.jpg'],
    [('Type', 'Long nose'), ('Jaws', 'Serrated tip + cutter'), ('Handle', 'Orange/black dual-material')],
    'Slim-jaw pliers with an orange/black anti-slip grip for detailed gripping and wire work.',
    ['Electrical and electronics', 'Automotive clips', 'Fine assembly'])
add('pliers', 'Milestone Diagonal Cutting Pliers', 1150,
    ['cable cutter milestone.jpg', 'nose plase npi red.jpg'],
    [('Type', 'Diagonal side cutter'), ('Edges', 'Induction-hardened'), ('Handle', 'Orange/black dual-material')],
    'Hardened diagonal cutting edges snip copper and steel wire flush and clean. Long handles give strong leverage with little effort.',
    ['Cutting electrical wire', 'Trimming cable ties', 'Flush-cutting pins and leads'])
add('pliers', 'NPI Locking Grip Pliers (Chrome)', 1350,
    ['grip plase .jpg', 'grip plase silver .jpg'],
    [('Type', 'Locking / vice-grip'), ('Jaw', 'Curved, serrated'), ('Adjustment', 'Screw knob + quick release'), ('Finish', 'Chrome plated')],
    'Clamp it and let go. These locking pliers lock onto bolts, pipes and workpieces with huge holding force, and release instantly with the lever.',
    ['Removing rounded bolts', 'Clamping for welding', 'Holding pipes', 'Emergency wrench'], featured=True)
add('pliers', 'NPI Locking Grip Pliers (Black)', 1250,
    ['black grip plase.jpg', 'grip plase black .jpg'],
    [('Type', 'Locking / vice-grip'), ('Jaw', 'Curved, serrated'), ('Adjustment', 'Screw knob + quick release'), ('Finish', 'Black oxide')],
    'Locking pliers in a tough black-oxide finish that resists rust in workshop conditions.',
    ['Rounded nuts and bolts', 'Clamping work', 'Pipe gripping'])
add('pliers', 'Locking Grip Pliers (Cushion Grip)', 1550,
    ['grip wala grip plase.jpg', 'PPR Cutter Blue NPI.jpg'],
    [('Type', 'Locking / vice-grip'), ('Jaw', 'Curved, serrated'), ('Handle', 'Blue/yellow cushion grip'), ('Release', 'Quick-release lever')],
    'Full locking power with soft cushioned handles, so you can squeeze hard all day without sore palms.',
    ['Mechanics and fabricators', 'Clamping and welding', 'Stuck fasteners'])
add('pliers', 'NPI Circlip Pliers (Internal)', 650,
    ['lock plase.jpg', 'locking plier 2.jpg', 'locking plier.jpg'],
    [('Type', 'Internal circlip / snap ring'), ('Tips', 'Hardened'), ('Spring', 'Return spring'), ('Handle', 'Yellow PVC dipped')],
    'Removes and fits internal retaining rings (circlips) inside bores and housings. A return spring keeps the tips ready for the next ring.',
    ['Bearing housings', 'Motorcycle and auto repair', 'Pump and gearbox service'])
add('pliers', 'NPI Circlip Pliers (External)', 650,
    ['straight locking plase.jpg'],
    [('Type', 'External circlip / snap ring'), ('Tips', 'Straight, hardened'), ('Spring', 'Return spring'), ('Handle', 'Yellow PVC dipped')],
    'Opens external snap rings on shafts and axles. The straight hardened tips grip the ring holes securely.',
    ['Shafts and axles', 'Machinery maintenance', 'Auto repair'])
add('pliers', 'NPI End Cutting Pincers (Jamoor)', 750,
    ['jamoor yellow.jpg', 'jhamoor .jpg', 'jhamoor 1.jpg', 'jhamoor yellow.jpg'],
    [('Type', 'End cutting pincers'), ('Jaws', 'Forged, hardened'), ('Handle', 'Yellow PVC dipped')],
    'The carpenter\'s jamoor. Rounded forged jaws pull nails out of wood and cut wire and nail heads flush with the surface.',
    ['Pulling nails', 'Cutting nail heads flush', 'Shuttering and woodwork', 'Tying and cutting binding wire'])

# ---------------- Cutters, saws & blades ----------------
add('cutters', 'NPI Cable Cutter', 1800,
    ['cable cutter npi.jpg', 'cable cutter npi 1.jpg'],
    [('Type', 'Cable shear'), ('Blades', 'Hardened curved blades'), ('Handle', 'Long red/black grips')],
    'Curved shear blades wrap around copper and aluminium cable and cut it cleanly without crushing, and the long handles do the hard work.',
    ['Copper and aluminium cable', 'Electrical installation', 'Battery cables'], featured=True)
add('cutters', 'NPI PPR Pipe Cutter (Blue)', 1450,
    ['ppr cutter blue npi 1.jpg', 'ppr cutter blue npi 3.jpg'],
    [('Type', 'Ratchet pipe cutter'), ('For', 'PPR, PVC, PE pipe'), ('Blade', 'Stainless steel'), ('Body', 'Aluminium alloy')],
    'A ratchet-action pipe cutter that slices PPR, PVC and PE pipe square and burr-free in a few squeezes, ready for fusion or fittings.',
    ['PPR plumbing', 'PVC conduit', 'Irrigation pipe'])
add('cutters', 'PPR Pipe Cutter (Red)', 1450,
    ['ppr cutter red .jpg', 'ppr cutter red 3.jpg'],
    [('Type', 'Ratchet pipe cutter'), ('For', 'PPR, PVC, PE pipe'), ('Blade', 'Stainless steel'), ('Body', 'Aluminium alloy')],
    'Fast, square cuts on plastic pipe every time. The red ratchet cutter is built for plumbers who cut all day.',
    ['PPR plumbing', 'Conduit and ducting', 'Garden pipe'])
add('cutters', 'NPI Heavy-Duty Snap-Off Cutter', 650,
    ['paper blade silver 5 blade.jpg', 'measuring tape .jpg'],
    [('Blade', '18 mm snap-off'), ('Body', 'Metal, heavy duty'), ('Lock', 'Auto-lock slider'), ('Spares', 'Blades included')],
    'A metal-bodied snap-off utility knife with an auto-locking slider. Snap off a segment for a fresh, razor-sharp edge every time.',
    ['Cartons and packaging', 'Gypsum board', 'Carpet and vinyl', 'Leather and rubber'])
add('cutters', 'NPI Hacksaw Frame', 1100,
    ['ari frame npi.jpg'],
    [('Blade', '12 in (300 mm), included'), ('Frame', 'Steel, tensioned'), ('Handle', 'Rubber pistol grip')],
    'A rigid, high-tension hacksaw frame with a rubber pistol grip for straight, controlled cuts through metal, pipe and plastic.',
    ['Cutting steel rod and pipe', 'Bolts and threaded bar', 'PVC and conduit'])
add('cutters', 'Electric Planer Blades (Pair)', 900,
    ['makheta blade.jpg'],
    [('Pieces', '2'), ('Type', 'Reversible planer knives'), ('Fits', '82 mm electric planers')],
    'A replacement pair of reversible planer knives. Turn them over when one edge dulls for twice the working life.',
    ['Electric hand planers', 'Door and frame trimming', 'Woodworking'])
add('cutters', 'NPI Turbo Diamond Cutting Disc 125 mm', 650,
    ['Hot press.jpg'],
    [('Size', 'Ø125 × 1.2 × 10 × 22.23 mm'), ('Type', 'Hot-pressed turbo diamond'), ('Cuts', 'Tile, marble, granite, concrete')],
    'A hot-pressed turbo diamond blade for angle grinders: ultra-thin 1.2 mm rim for fast, chip-free cuts in tile, marble and granite.',
    ['Tile and ceramic', 'Marble and granite', 'Concrete and block'], motion='spin', featured=True)

# ---------------- Wrenches, sockets & keys ----------------
add('wrenches', 'NPI Adjustable Wrench (Black)', 1650,
    ['Wrench NPI Black .jpg', 'wrench npi black 1.jpg'],
    [('Type', 'Adjustable spanner'), ('Finish', 'Black phosphate'), ('Jaw', 'Wide opening, polished'), ('Handle', 'Rubber comfort grip')],
    'A heavy adjustable wrench with a wide-opening polished jaw and a rubber comfort grip. One tool replaces a whole set of spanners.',
    ['Plumbing fittings', 'Nuts and bolts', 'Machinery maintenance', 'Automotive work'], featured=True)
add('wrenches', 'Socket Set 1/2" (11 pcs)', 3800,
    ['gooti set 4.jpg', 'gooti set .jpg', 'gootiyan.jpg'],
    [('Pieces', '11'), ('Drive', '1/2 in'), ('Material', 'Chrome vanadium'), ('Includes', 'Ratchet, extension, sockets')],
    'A complete 1/2" drive socket kit: quick-reverse ratchet, extension bar and chrome-vanadium sockets on a storage rail.',
    ['Car and motorcycle repair', 'Machinery assembly', 'Generator and pump service'], sku='TF-11')
add('wrenches', 'CR-V Allen Key Set (9 pcs)', 950,
    ['alkey set .jpg', 'alj=ket set crv open .jpg'],
    [('Pieces', '9'), ('Material', 'Chrome vanadium (CR-V)'), ('Type', 'L-shaped keys'), ('Holder', 'Size-marked clip')],
    'Nine CR-V L-keys in a colour-coded holder with every size marked, so you grab the right key first time.',
    ['Furniture assembly', 'Machinery and bikes', 'Door hardware'])
add('wrenches', 'NPI T-Handle Socket Wrench', 450,
    ['T pana black .jpg'],
    [('Type', 'T-handle box spanner'), ('Finish', 'Black oxide'), ('Grip', 'Sliding T-bar')],
    'A T-handle box wrench for fast spinning of nuts on long studs and recessed bolts.',
    ['Motorcycle repair', 'Recessed nuts', 'Assembly lines'])

# ---------------- Measuring tapes ----------------
add('tapes', 'NPI Measuring Tape 5 m / 16 ft (NP1008)', 750,
    ['fita card npi.jpg', 'fita card.jpg'],
    [('Length', '5 m / 16 ft'), ('Blade width', '19 mm'), ('Case', 'Rubber-armoured ABS'), ('Model', 'NP1008')],
    'A rubber-armoured 5 m tape with a wide 19 mm blade, belt clip and wrist strap. Clear metric and imperial markings.',
    ['Construction and fit-out', 'Carpentry', 'Interior measurements'], featured=True, sku='NP1008')
add('tapes', 'NPI Great Wall Measuring Tape 3.5 m', 550,
    ['fita greatewall 3.5.jpg', 'fita grate wall.jpg', 'fita greate wall.jpg', 'Greate wall.jpg'],
    [('Length', '3.5 m / 12 ft (also 3 m)'), ('Blade width', '16 mm'), ('Case', '100% new ABS'), ('Claim', 'Extra 40% longer life')],
    'A compact everyday tape in a tough red ABS case with wrist strap. Small enough for a pocket, accurate enough for the site.',
    ['Home use', 'Tailoring and interiors', 'Quick site checks'])
add('tapes', 'NPI Colour Measuring Tape 5 m', 650,
    ['fita rangeen 2 .jpg', 'fita rangeen7.jpg', 'fita rangeen 4.jpg', 'fita rangeen 6.jpg', 'fita rangeen.jpg'],
    [('Length', '5 m / 16 ft'), ('Colours', 'Orange, green'), ('Case', 'ABS with wrist strap'), ('Lock', 'Blade lock')],
    'Bright, colourful 5 m tapes that never get lost on site. Blade lock, belt clip and wrist strap included.',
    ['Construction', 'Woodwork', 'Shops and retail counters'])
add('tapes', 'NPI Colour Measuring Tape 3.5 m', 450,
    ['fita rangeen 7.jpg', 'fita rangeen 5.jpg', 'fita rangeen 1 .jpg'],
    [('Length', '3.5 m / 12 ft'), ('Colours', 'Yellow, red'), ('Case', 'ABS with wrist strap'), ('Lock', 'Blade lock')],
    'A pocket-size 3.5 m tape in bright yellow or red. Ideal for homes, tailors and quick measurements.',
    ['Home use', 'Tailoring', 'Interior work'])
add('tapes', 'Milestone Fibreglass Long Tape 15 m / 50 ft', 1400,
    ['fita kapra 1.jpg', 'fita kapra.jpg'],
    [('Length', '15 m / 50 ft'), ('Tape', 'Fibreglass, non-conductive'), ('Case', 'Closed reel with winding handle')],
    'A closed-reel fibreglass tape for long distances. It won\'t stretch, rust or conduct electricity, and winds back fast with the folding handle.',
    ['Plot and land measurement', 'Sports fields', 'Building layout'])
add('tapes', 'NPI Steel Long Measuring Tape 30 m / 100 ft', 2900,
    ['fita steel 30 .jpg', 'fita steel.jpg', 'fita steel .jpg'],
    [('Length', '30 m / 100 ft'), ('Tape', 'Steel blade'), ('Case', 'Impact-resistant reel'), ('Winding', 'Folding crank handle')],
    'A professional 30 m steel tape for surveyors and contractors. The steel blade gives precise long readings that don\'t sag or stretch.',
    ['Site surveying', 'Plot measurement', 'Road and boundary work'], featured=True)

# ---------------- Spirit levels ----------------
add('levels', 'Sola Aluminium Box Level', 2800,
    ['level sola.jpg', 'level sola 1.jpg'],
    [('Brand', 'Sola'), ('Body', 'Aluminium, yellow'), ('Vials', 'Level + plumb'), ('Scale', 'Printed ruler edge')],
    'A premium Sola aluminium level with crystal-clear vials and a printed ruler edge. Accurate readings for tiling, masonry and fitting.',
    ['Tiling', 'Masonry and block work', 'Door and window fitting'], featured=True)
add('levels', 'NPI Aluminium Spirit Level (3 Vials)', 1650,
    ['level silver npi.jpg', 'level silver 1 .jpg'],
    [('Body', 'Aluminium'), ('Vials', '3 (level, plumb, 45°)'), ('Scale', 'Ruler edge')],
    'A sturdy aluminium level with three vials for horizontal, vertical and 45° readings, all in one tool.',
    ['Shelving and cabinets', 'Tiling', 'Frames and fixtures'])
add('levels', 'Aluminium Slim Level (Silver)', 900,
    ['level silver .jpg'],
    [('Body', 'Slim aluminium'), ('Vials', '1 centre vial')],
    'A slim, lightweight aluminium level for quick checks on shelves, frames and fittings.',
    ['Picture frames', 'Shelves', 'Light fitting work'])
add('levels', 'Slim Spirit Level (Yellow)', 850,
    ['level sola .jpg'],
    [('Body', 'Slim profile, yellow'), ('Vials', '1 centre vial')],
    'A long, slim level in high-visibility yellow for masonry and plastering checks.',
    ['Plastering', 'Masonry', 'General levelling'])
add('levels', 'Torpedo Level (Red)', 750,
    ['level red simple.jpg'],
    [('Type', 'Torpedo'), ('Vials', '3'), ('Body', 'Red, compact')],
    'A compact three-vial torpedo level that fits in a pocket but gives full-size accuracy.',
    ['Conduit and pipework', 'Appliance installation', 'Tight spaces'])
add('levels', 'Torpedo Level (Blue)', 650,
    ['level simple choota.jpg'],
    [('Type', 'Torpedo'), ('Vials', '3'), ('Body', 'Blue/black, compact')],
    'A small three-vial torpedo level with a hanging hole: handy, light and accurate.',
    ['Electrical boxes', 'Plumbing', 'Small fixtures'])
add('levels', 'Torpedo Level (Sky Blue)', 600,
    ['level simple.jpg'],
    [('Type', 'Torpedo'), ('Vials', '3'), ('Body', 'Sky blue/black')],
    'An affordable three-vial torpedo level for everyday levelling jobs.',
    ['Home DIY', 'Fixtures and fittings', 'Pipe work'])
add('levels', "Mason's Pointed Level", 450,
    ['level simple 1.jpg', 'level simple 3.jpg'],
    [('Type', 'Pointed mason level'), ('Vials', '1 centre vial'), ('Colours', 'Sky blue, black')],
    'A traditional pointed-end mason\'s level, light and easy to use on bricks, blocks and plaster.',
    ['Brick and block laying', 'Plaster work', 'Tile checks'])

# ---------------- Hammers ----------------
add('hammers', 'NPI Claw Hammer (Fibreglass Handle)', 1450,
    ['hammer npi .jpg', 'Hammer.jpg'],
    [('Type', 'Claw hammer'), ('Head', 'Forged, polished face'), ('Handle', 'Fibreglass, anti-shock orange grip')],
    'A forged claw hammer on a fibreglass handle that absorbs shock. Drive nails hard all day, then use the curved claw to pull them.',
    ['Carpentry and shuttering', 'Nailing and demolition', 'General construction'], featured=True)
add('hammers', 'KTC Claw Hammer (Green Grip)', 1250,
    ['hammer KTC.jpg', 'hammer ktc 2.jpg'],
    [('Brand', 'KTC'), ('Type', 'Claw hammer'), ('Head', 'Forged steel'), ('Handle', 'Green rubber grip')],
    'A well-balanced claw hammer with a forged head and a non-slip green rubber grip.',
    ['Carpentry', 'Home repairs', 'Furniture work'])

# ---------------- Drill bits ----------------
add('drilling', 'NPI HSS Cobalt Drill Bit Set (Orange Case)', 2600,
    ['drill bits cobalt .jpg'],
    [('Type', 'HSS-Co cobalt twist bits'), ('For', 'Stainless & hard steel'), ('Case', 'Indexed plastic case')],
    'Cobalt-alloy HSS bits for drilling stainless steel and hard metals. They stay sharp where ordinary bits burn out.',
    ['Stainless steel', 'Hard steel and cast iron', 'Fabrication shops'], featured=True)
add('drilling', 'NPI HSS Drill Bit Set (Blue Case)', 1600,
    ['drill bits.jpg'],
    [('Type', 'HSS twist bits'), ('For', 'Steel, aluminium, wood, plastic'), ('Case', 'Indexed plastic case')],
    'A graded set of HSS twist bits in an indexed case, the everyday metal-drilling kit.',
    ['Mild steel', 'Aluminium', 'Wood and plastic'])
add('drilling', 'NPI HSS Twist Drill Bit (Fully Ground)', 150,
    ['drill bits white npi 4.jpg', 'drill bit white.jpg'],
    [('Type', 'HSS fully ground'), ('Sold', 'Per piece; all common sizes')],
    'A bright, fully-ground HSS twist bit for clean, accurate holes in metal. Sold individually: ask for your size.',
    ['Metal drilling', 'Workshop stock', 'Replacement bits'])
add('drilling', 'NPI Masonry Drill Bit', 220,
    ['mansory drill bit.jpg', 'drill bit 1.jpg'],
    [('Type', 'Carbide-tipped masonry'), ('Length', '100 mm'), ('Pack', 'Protective tube')],
    'A carbide-tipped bit for brick, block and concrete, packed in a protective tube.',
    ['Wall plugs and anchors', 'Brick and block', 'Concrete'])
add('drilling', 'NPI Long Drill Bit (Tube Pack)', 450,
    ['npi drill bit black dabbi wali .jpg'],
    [('Type', 'Long-series bit'), ('Pack', 'Protective tube')],
    'A long-series drill bit for deep holes, delivered in a sturdy protective tube.',
    ['Deep holes', 'Through-wall drilling', 'Cable routing'])

# ---------------- Rivet tools ----------------
add('riveting', 'NPI Hand Riveter (Blue)', 1350,
    ['ripet plase blue.jpg', 'ripet gun 5.jpg'],
    [('Type', 'Hand rivet gun'), ('Rivets', '2.4 / 3.2 / 4.0 / 4.8 mm'), ('Nozzles', 'Interchangeable, stored on tool')],
    'A hand rivet gun with four interchangeable nozzles stored on the tool. Join sheet metal, aluminium and plastics in seconds.',
    ['Aluminium windows and doors', 'Sheet metal and ducting', 'Signboards'], featured=True)
add('riveting', 'Hand Riveter (Red)', 1350,
    ['ripet plas red.jpg', 'ripet plase .jpg'],
    [('Type', 'Hand rivet gun'), ('Rivets', '2.4 / 3.2 / 4.0 / 4.8 mm'), ('Nozzles', 'Interchangeable, stored on tool')],
    'A strong hand riveter with long handles for easy pulling and four nozzle sizes on board.',
    ['Aluminium fabrication', 'Ducting', 'Vehicle body work'])
add('riveting', 'Hand Riveter (Yellow)', 1350,
    ['ripet plas yellow.jpg', 'ripet plase yellow.jpg'],
    [('Type', 'Hand rivet gun'), ('Rivets', '2.4 / 3.2 / 4.0 / 4.8 mm'), ('Nozzles', 'Interchangeable, stored on tool')],
    'A high-visibility yellow riveter with a return spring and four nozzle sizes.',
    ['Sheet metal', 'Aluminium work', 'General fabrication'])


def slugify(s):
    import re
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', s.lower())).strip('-')[:80]


# ---------- fast helpers: tiny C flood fill / labelling (compiled on first run), numpy morphology ----------
import ctypes, subprocess
_LIB = None
def _lib():
    global _LIB
    if _LIB is None:
        here = os.path.dirname(os.path.abspath(__file__))
        so = os.path.join(here, '.fastfill.so')
        if not os.path.exists(so) or os.path.getmtime(so) < os.path.getmtime(os.path.join(here, 'fastfill.c')):
            subprocess.run(['gcc', '-O2', '-shared', '-fPIC', '-o', so, os.path.join(here, 'fastfill.c')], check=True)
        _LIB = ctypes.CDLL(so)
    return _LIB

def flood(mask, seeds_mask):
    """4-connected region of `mask` reachable from pixels in seeds_mask."""
    h, w = mask.shape
    m = np.ascontiguousarray(mask, dtype=np.uint8)
    seeds = np.ascontiguousarray(np.flatnonzero(seeds_mask & mask).astype(np.int32))
    out = np.zeros((h, w), np.uint8)
    _lib().flood(m.ctypes.data_as(ctypes.c_void_p), w, h, seeds.ctypes.data_as(ctypes.c_void_p), len(seeds), out.ctypes.data_as(ctypes.c_void_p))
    return out.astype(bool)

def label(mask):
    h, w = mask.shape
    m = np.ascontiguousarray(mask, dtype=np.uint8)
    lab = np.zeros((h, w), np.int32)
    n = _lib().label(m.ctypes.data_as(ctypes.c_void_p), w, h, lab.ctypes.data_as(ctypes.c_void_p))
    return lab, n

def _shift_reduce(arr, r, fn, axis):
    out = arr.copy()
    for k in range(1, r + 1):
        a = np.roll(arr, k, axis=axis); b = np.roll(arr, -k, axis=axis)
        out = fn(out, fn(a, b))
    return out

def dilate(a, r):  # works for bool and uint8 (max filter of size 2r+1)
    return _shift_reduce(_shift_reduce(a, r, np.maximum, 0), r, np.maximum, 1)

def erode(a, r):   # min filter of size 2r+1
    return _shift_reduce(_shift_reduce(a, r, np.minimum, 0), r, np.minimum, 1)


def cutout(path, size=1000, tol=None):
    im = ImageOps.exif_transpose(Image.open(path)).convert('RGB')
    im.thumbnail((int(size * 1.3), int(size * 1.3)), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32)
    dist = 255 - a.min(axis=2)                      # 0 = pure white
    sat = a.max(axis=2) - a.min(axis=2)
    h, w = dist.shape
    if tol is None:
        # studio backgrounds are pure white: allow only a few levels above the border's own brightness,
        # so white handles and bright chrome are never mistaken for background
        border = np.concatenate([dist[0], dist[-1], dist[:, 0], dist[:, -1]])
        tol = int(min(12, max(5, np.percentile(border, 95) + 5)))
    edge_seed = np.zeros((h, w), bool); edge_seed[0] = edge_seed[-1] = True; edge_seed[:, 0] = edge_seed[:, -1] = True
    # 1) background = near-white region connected to the photo border
    bg = flood(dist < tol + 1, edge_seed)
    # 2) floor shadow: smooth, neutral grey connected to the background below where the product ends
    d8 = np.clip(dist, 0, 255).astype(np.uint8)
    edges = np.asarray(Image.fromarray(d8).filter(ImageFilter.FIND_EDGES)).astype(np.uint8)
    edges = dilate(edges, 2)
    neutral = (sat < 26) & (dist < 165) & (edges < 14)
    solid = (dist > 170) | (sat > 40)
    rows = np.nonzero(solid.sum(axis=1) > 3)[0]
    zone_start = min(int(h * 0.82), int(rows.max()) + 3 if len(rows) else int(h * 0.82))
    zone = np.zeros((h, w), bool); zone[zone_start:] = True
    bg |= flood((neutral & zone) | bg, bg & zone)
    # 3) edge band (3 px): anti-aliased pixels get partial alpha and have the white un-mixed from their colour
    band = dilate(bg, 3) & ~bg
    lo, hi = float(tol), float(tol + 45)
    alpha = np.ones((h, w), np.float32)
    alpha[band] = np.clip((dist[band] - lo) / (hi - lo), 0, 1)
    alpha[bg] = 0
    rgb = a.copy()
    mm = band & (alpha > 0.02)
    am = alpha[mm][:, None]
    rgb[mm] = np.clip((a[mm] - (1 - am) * 255) / am, 0, 255)
    An = (alpha * 255).astype(np.uint8)
    An[~erode(~bg, 1)] = 0                           # tighten edge by 1 px: no fringe line
    # 4) floor slivers left over: wide, flat, pale regions near the bottom
    pale = (sat < 26) & (dist < 150) & (An > 12)
    lab, n = label(pale)
    if n:
        ids = np.arange(1, n + 1)
        ys, xs = np.nonzero(lab)
        L = lab[ys, xs]
        minx = np.full(n + 1, w); maxx = np.zeros(n + 1, int); miny = np.full(n + 1, h); maxy = np.zeros(n + 1, int)
        np.minimum.at(minx, L, xs); np.maximum.at(maxx, L, xs); np.minimum.at(miny, L, ys); np.maximum.at(maxy, L, ys)
        bad = ids[((maxx[ids] - minx[ids]) > 0.45 * w) & ((maxy[ids] - miny[ids]) < 0.12 * h) & (maxy[ids] > 0.7 * h)]
        if len(bad): An[np.isin(lab, bad)] = 0
    # 5) see-through holes: large enclosed pure-white areas (vial windows, hanging holes)
    hole = (dist <= max(3, tol - 2)) & ~bg & (An > 12)
    big = dilate(erode(hole, 5), 7)
    An[big & hole] = 0
    # 6) shadow specks under the product, then 1-px specks anywhere
    An[zone_start:] = np.minimum(An[zone_start:], dilate(erode(An, 3), 3)[zone_start:])
    An = dilate(erode(An, 1), 1)
    A = Image.fromarray(An).filter(ImageFilter.GaussianBlur(0.6))
    out = Image.fromarray(rgb.astype(np.uint8)); out.putalpha(A)
    bb = Image.fromarray((np.asarray(A) > 12).astype(np.uint8) * 255).getbbox()
    out = out.crop(bb); out.thumbnail((size, size), Image.LANCZOS)
    return out


def main():
    catalog = {'categories': [{'slug': s, 'name': n, 'motion': m} for s, n, m in CATEGORIES], 'products': []}
    used = set()
    for i, p in enumerate(P, 1):
        pid = f'p{i:02d}'
        urls = []
        sizes = []
        for j, f in enumerate(p['photos'], 1):
            src = os.path.join(SRC, f)
            if not os.path.exists(src):
                sys.exit(f'missing photo: {f}')
            used.add(f)
            # content-hashed names: if a photo or the cut-out pipeline changes, the URL changes,
            # so browsers can never show a stale cached image
            import hashlib
            with open(src, 'rb') as fh: digest = hashlib.sha1(fh.read() + PIPELINE_VERSION.encode()).hexdigest()[:8]
            name = f'npi-{pid}-{j}-{digest}.webp'
            dst = os.path.join(OUT, name)
            hd = os.path.join(OUT, f'npi-{pid}-{j}-{digest}-hd.webp')
            for old in os.listdir(OUT):  # remove superseded versions of this photo
                if old.startswith(f'npi-{pid}-{j}') and old not in (name, os.path.basename(hd)): os.remove(os.path.join(OUT, old))
            if not os.path.exists(dst) or not os.path.exists(hd):
                big = cutout(src, size=1600)
                big.save(hd, 'WEBP', quality=84, method=4)          # sharp version for video close-ups
                small = big.copy(); small.thumbnail((900, 900), Image.LANCZOS)
                small.save(dst, 'WEBP', quality=86, method=4)       # light version for the shop grid
            urls.append(f'/uploads/{name}')
            with Image.open(dst) as _im: sizes.append(list(_im.size))
            print(f'{name}  <-  {f}')
        cat_motion = next(m for s, n, m in CATEGORIES if s == p['cat'])
        catalog['products'].append({
            'sku': p['sku'] or f'NPI-{pid.upper()}',
            'slug': slugify(p['name']),
            'name': p['name'], 'category': p['cat'],
            'price': p['price'] * 100,
            'specs': [{'label': a, 'value': b} for a, b in p['specs']],
            'description': p['desc'], 'uses': p['uses'],
            'demo': (lambda d: {**d, 'spots': auto_spots(d, [{'label': x, 'value': y} for x, y in p['specs']])})({**DEMO.get(p['name'], {}), **POINTS.get(p['name'], {})}),
            'tags': TAGS.get(p['name'], []),
            'images': urls, 'sizes': sizes, 'motion': p['motion'] or cat_motion,
            'featured': p['featured'], 'stock': 25
        })
    # brand logo (kept on white, shown inside a white badge)
    for src, dst in (('NPI name and logo.jpeg', 'npi-logo-full.webp'), ('NPI Global Trading.jpeg', 'npi-logo.webp')):
        im = Image.open(os.path.join(SRC, src)).convert('RGB')
        d = (255 - np.asarray(im).astype(np.int16)).max(axis=2)
        bb = Image.fromarray(((d > 30) * 255).astype(np.uint8)).getbbox()
        os.makedirs(os.path.join(ROOT, 'public', 'img'), exist_ok=True)
        im.crop(bb).save(os.path.join(ROOT, 'public', 'img', dst), 'WEBP', quality=90)
    unused = sorted(f for f in os.listdir(SRC) if f.lower().endswith(('.jpg', '.jpeg')) and f not in used
                    and not f.startswith('NPI '))
    with open(os.path.join(ROOT, 'data', 'catalog.json'), 'w') as fh:
        json.dump(catalog, fh, indent=1, ensure_ascii=False)
    print(f'\n{len(P)} products, {len(used)} photos used. Unused photos: {unused or "none"}')



# products sold in boxes/cases look better with a close-up zoom than a tool motion
ZOOM_ONLY = ['NPI Double-End Screwdriver Bits (10 pcs)', 'NPI Magnetic Ring Screw Bits PH2 (5 pcs)', 'Socket Set 1/2" (11 pcs)', 'Electric Planer Blades (Pair)', 'NPI HSS Cobalt Drill Bit Set (Orange Case)', 'NPI HSS Drill Bit Set (Blue Case)', 'NPI Masonry Drill Bit', 'NPI Long Drill Bit (Tube Pack)']
for _p in P:
    if _p['name'] in ZOOM_ONLY:
        _p['motion'] = 'zoom'


# ---------------- product videos + Tool Finder tags ----------------
# demo: which working demo to play (see public/js/demo.js); points are filled in POINTS below.
DEMO = {
  'NPI 2-Way Insulated Screwdriver': dict(type='screwdriver', img=0, flip=dict(handle=1, rod=2)),
  'NPI 2-Way Screwdriver (Full Rod)': dict(type='screwdriver', img=1, flip=dict(handle=0, rod=2)),
  'NPI Screwdriver (Black & White Grip)': dict(type='screwdriver', img=0),
  'Milestone Flat Screwdriver (Orange Grip)': dict(type='screwdriver', img=0),
  'Super Flat Screwdriver (Yellow Grip)': dict(type='screwdriver', img=0),
  'Milestone Phillips Screwdriver (Yellow Grip)': dict(type='screwdriver', img=0),
  'NPI Double-End Screwdriver Bits (10 pcs)': dict(type='bits', img=0),
  'NPI Magnetic Ring Screw Bits PH2 (5 pcs)': dict(type='bits', img=0),
  'NPI Double-End PH2 Bits (2 pcs)': dict(type='bits', img=0),
  'Milestone Combination Pliers (Orange Grip)': dict(type='pliers', hinge='cross'),
  'Milestone Combination Pliers (Yellow Grip)': dict(type='pliers', hinge='cross'),
  'Milestone Combination Pliers (Red/White Grip)': dict(type='pliers', hinge='cross'),
  'Long Nose Pliers (Red/White Grip)': dict(type='nose', hinge='cross'),
  'Milestone Long Nose Pliers (Yellow Grip)': dict(type='nose', hinge='cross'),
  'Milestone Long Nose Pliers (Orange Grip)': dict(type='nose', hinge='cross'),
  'Milestone Diagonal Cutting Pliers': dict(type='diagonal', hinge='cross'),
  'NPI Locking Grip Pliers (Chrome)': dict(type='locking', hinge='lever', lever='right'),
  'NPI Locking Grip Pliers (Black)': dict(type='locking', hinge='lever', lever='right'),
  'Locking Grip Pliers (Cushion Grip)': dict(type='locking', hinge='lever', lever='right'),
  'NPI Circlip Pliers (Internal)': dict(type='circlip-int', hinge='cross'),
  'NPI Circlip Pliers (External)': dict(type='circlip-ext', hinge='side'),
  'NPI End Cutting Pincers (Jamoor)': dict(type='pincers', hinge='cross'),
  'NPI Cable Cutter': dict(type='cable', hinge='cross'),
  'NPI PPR Pipe Cutter (Blue)': dict(type='ppr', hinge='lever', lever='right'),
  'PPR Pipe Cutter (Red)': dict(type='ppr', hinge='lever', lever='right'),
  'NPI Heavy-Duty Snap-Off Cutter': dict(type='knife'),
  'NPI Hacksaw Frame': dict(type='hacksaw'),
  'Electric Planer Blades (Pair)': dict(type='planer'),
  'NPI Turbo Diamond Cutting Disc 125 mm': dict(type='disc'),
  'NPI Adjustable Wrench (Black)': dict(type='wrench'),
  'Socket Set 1/2" (11 pcs)': dict(type='sockets'),
  'CR-V Allen Key Set (9 pcs)': dict(type='keys'),
  'NPI T-Handle Socket Wrench': dict(type='twrench'),
  'NPI Measuring Tape 5 m / 16 ft (NP1008)': dict(type='tape'),
  'NPI Great Wall Measuring Tape 3.5 m': dict(type='tape'),
  'NPI Colour Measuring Tape 5 m': dict(type='tape'),
  'NPI Colour Measuring Tape 3.5 m': dict(type='tape'),
  'Milestone Fibreglass Long Tape 15 m / 50 ft': dict(type='longtape'),
  'NPI Steel Long Measuring Tape 30 m / 100 ft': dict(type='longtape'),
  'Sola Aluminium Box Level': dict(type='level'),
  'NPI Aluminium Spirit Level (3 Vials)': dict(type='level'),
  'Aluminium Slim Level (Silver)': dict(type='level'),
  'Slim Spirit Level (Yellow)': dict(type='level'),
  'Torpedo Level (Red)': dict(type='level', len=520),
  'Torpedo Level (Blue)': dict(type='level', len=480),
  'Torpedo Level (Sky Blue)': dict(type='level', len=480),
  "Mason's Pointed Level": dict(type='mason'),
  'NPI Claw Hammer (Fibreglass Handle)': dict(type='hammer'),
  'KTC Claw Hammer (Green Grip)': dict(type='hammer'),
  'NPI HSS Cobalt Drill Bit Set (Orange Case)': dict(type='drill', material='stainless', finish='gold'),
  'NPI HSS Drill Bit Set (Blue Case)': dict(type='drill', material='steel', finish='steel'),
  'NPI HSS Twist Drill Bit (Fully Ground)': dict(type='drill', material='steel', finish='steel'),
  'NPI Masonry Drill Bit': dict(type='drill', material='concrete', finish='black'),
  'NPI Long Drill Bit (Tube Pack)': dict(type='drill', material='wood', finish='black', long=True),
  'NPI Hand Riveter (Blue)': dict(type='riveter', hinge='lever'),
  'Hand Riveter (Red)': dict(type='riveter', hinge='lever'),
  'Hand Riveter (Yellow)': dict(type='riveter', hinge='lever'),
}

TAGS = {
  'NPI 2-Way Insulated Screwdriver': ['screws-slotted', 'screws-phillips', 'electrical'],
  'NPI 2-Way Screwdriver (Full Rod)': ['screws-slotted', 'screws-phillips', 'woodwork'],
  'NPI Screwdriver (Black & White Grip)': ['screws-slotted', 'electrical'],
  'Milestone Flat Screwdriver (Orange Grip)': ['screws-slotted', 'automotive'],
  'Super Flat Screwdriver (Yellow Grip)': ['screws-slotted'],
  'Milestone Phillips Screwdriver (Yellow Grip)': ['screws-phillips'],
  'NPI Double-End Screwdriver Bits (10 pcs)': ['power-driver', 'screws-phillips', 'woodwork'],
  'NPI Magnetic Ring Screw Bits PH2 (5 pcs)': ['power-driver', 'screws-phillips', 'magnetic'],
  'NPI Double-End PH2 Bits (2 pcs)': ['power-driver', 'screws-phillips'],
  'Milestone Combination Pliers (Orange Grip)': ['grip', 'wire-cut', 'electrical'],
  'Milestone Combination Pliers (Yellow Grip)': ['grip', 'wire-cut', 'electrical'],
  'Milestone Combination Pliers (Red/White Grip)': ['grip', 'wire-cut', 'electrical'],
  'Long Nose Pliers (Red/White Grip)': ['tight-space', 'grip', 'electrical'],
  'Milestone Long Nose Pliers (Yellow Grip)': ['tight-space', 'grip', 'electrical'],
  'Milestone Long Nose Pliers (Orange Grip)': ['tight-space', 'grip', 'automotive'],
  'Milestone Diagonal Cutting Pliers': ['wire-cut', 'electrical'],
  'NPI Locking Grip Pliers (Chrome)': ['clamp', 'nuts', 'plumbing', 'automotive'],
  'NPI Locking Grip Pliers (Black)': ['clamp', 'nuts', 'automotive'],
  'Locking Grip Pliers (Cushion Grip)': ['clamp', 'nuts', 'plumbing'],
  'NPI Circlip Pliers (Internal)': ['circlip-int', 'automotive'],
  'NPI Circlip Pliers (External)': ['circlip-ext', 'automotive'],
  'NPI End Cutting Pincers (Jamoor)': ['nail-pull', 'woodwork', 'wire-cut'],
  'NPI Cable Cutter': ['cable-cut', 'electrical'],
  'NPI PPR Pipe Cutter (Blue)': ['pipe-plastic', 'plumbing'],
  'PPR Pipe Cutter (Red)': ['pipe-plastic', 'plumbing'],
  'NPI Heavy-Duty Snap-Off Cutter': ['board-cut'],
  'NPI Hacksaw Frame': ['metal-cut', 'plumbing'],
  'Electric Planer Blades (Pair)': ['wood-plane', 'woodwork'],
  'NPI Turbo Diamond Cutting Disc 125 mm': ['tile-cut', 'tiling', 'masonry'],
  'NPI Adjustable Wrench (Black)': ['nuts', 'plumbing', 'automotive'],
  'Socket Set 1/2" (11 pcs)': ['socket-drive', 'nuts', 'automotive'],
  'CR-V Allen Key Set (9 pcs)': ['hex-socket'],
  'NPI T-Handle Socket Wrench': ['recessed-nuts', 'nuts', 'automotive'],
  'NPI Measuring Tape 5 m / 16 ft (NP1008)': ['measure-mid', 'woodwork'],
  'NPI Great Wall Measuring Tape 3.5 m': ['measure-short'],
  'NPI Colour Measuring Tape 5 m': ['measure-mid'],
  'NPI Colour Measuring Tape 3.5 m': ['measure-short'],
  'Milestone Fibreglass Long Tape 15 m / 50 ft': ['measure-long'],
  'NPI Steel Long Measuring Tape 30 m / 100 ft': ['measure-xl'],
  'Sola Aluminium Box Level': ['level-long', 'tiling', 'masonry'],
  'NPI Aluminium Spirit Level (3 Vials)': ['level-long', 'tiling'],
  'Aluminium Slim Level (Silver)': ['level-long'],
  'Slim Spirit Level (Yellow)': ['level-long', 'masonry'],
  'Torpedo Level (Red)': ['level-short'],
  'Torpedo Level (Blue)': ['level-short'],
  'Torpedo Level (Sky Blue)': ['level-short'],
  "Mason's Pointed Level": ['masonry', 'tiling'],
  'NPI Claw Hammer (Fibreglass Handle)': ['nailing', 'woodwork', 'nail-pull'],
  'KTC Claw Hammer (Green Grip)': ['nailing', 'woodwork'],
  'NPI HSS Cobalt Drill Bit Set (Orange Case)': ['drill-stainless', 'drill-steel'],
  'NPI HSS Drill Bit Set (Blue Case)': ['drill-steel', 'drill-wood'],
  'NPI HSS Twist Drill Bit (Fully Ground)': ['drill-steel'],
  'NPI Masonry Drill Bit': ['drill-concrete'],
  'NPI Long Drill Bit (Tube Pack)': ['drill-deep', 'drill-wood'],
  'NPI Hand Riveter (Blue)': ['rivet'],
  'Hand Riveter (Red)': ['rivet'],
  'Hand Riveter (Yellow)': ['rivet'],
}

# photo coordinates (0..1 of the trimmed cut-out): pivot / tip / cut / vial and close-up spots per spec
POINTS = {
  'NPI 2-Way Insulated Screwdriver': dict(tip=[0.5, 0.0]),
  'NPI 2-Way Screwdriver (Full Rod)': dict(tip=[0.5, 0.0]),
  'NPI Screwdriver (Black & White Grip)': dict(tip=[0.5, 0.0]),
  'Milestone Flat Screwdriver (Orange Grip)': dict(tip=[0.5, 0.0]),
  'Super Flat Screwdriver (Yellow Grip)': dict(tip=[0.5, 0.0]),
  'Milestone Phillips Screwdriver (Yellow Grip)': dict(tip=[0.5, 0.0]),
  'Milestone Combination Pliers (Orange Grip)': dict(img=1, pivot=[0.52, 0.26], tip=[0.52, 0.05], cut=[0.52, 0.15]),
  'Milestone Combination Pliers (Yellow Grip)': dict(img=0, pivot=[0.52, 0.27], tip=[0.53, 0.05], cut=[0.52, 0.16]),
  'Milestone Combination Pliers (Red/White Grip)': dict(img=0, pivot=[0.5, 0.27], tip=[0.52, 0.04], cut=[0.52, 0.15]),
  'Long Nose Pliers (Red/White Grip)': dict(img=0, pivot=[0.47, 0.37], tip=[0.48, 0.03]),
  'Milestone Long Nose Pliers (Yellow Grip)': dict(img=1, pivot=[0.5, 0.36], tip=[0.52, 0.02]),
  'Milestone Long Nose Pliers (Orange Grip)': dict(img=0, pivot=[0.5, 0.37], tip=[0.5, 0.02]),
  'Milestone Diagonal Cutting Pliers': dict(img=0, pivot=[0.5, 0.25], tip=[0.5, 0.08]),
  'NPI Locking Grip Pliers (Chrome)': dict(img=1, hinge='side', pivot=[0.47, 0.33], tip=[0.35, 0.1]),
  'NPI Locking Grip Pliers (Black)': dict(img=0, hinge='side', pivot=[0.43, 0.32], tip=[0.33, 0.12]),
  'Locking Grip Pliers (Cushion Grip)': dict(img=0, hinge='side', pivot=[0.45, 0.37], tip=[0.33, 0.12]),
  'NPI Circlip Pliers (Internal)': dict(img=0, pivot=[0.5, 0.37], tip=[0.5, 0.03]),
  'NPI Circlip Pliers (External)': dict(img=0, pivot=[0.47, 0.35], tip=[0.47, 0.02]),
  'NPI End Cutting Pincers (Jamoor)': dict(img=2, pivot=[0.5, 0.2], tip=[0.5, 0.03]),
  'NPI Cable Cutter': dict(img=0, pivot=[0.5, 0.27], tip=[0.5, 0.1]),
  'NPI PPR Pipe Cutter (Blue)': dict(img=0, hinge='side', pivot=[0.38, 0.22], tip=[0.55, 0.17]),
  'PPR Pipe Cutter (Red)': dict(img=0, hinge='side', pivot=[0.68, 0.25], tip=[0.5, 0.15]),
  'NPI Heavy-Duty Snap-Off Cutter': dict(img=0, tip=[0.47, 0.0]),
  'NPI Hacksaw Frame': dict(tip=[0.1, 0.42]),
  'NPI Adjustable Wrench (Black)': dict(tip=[0.42, 0.14]),
  'NPI T-Handle Socket Wrench': dict(tip=[0.5, 0.99]),
  'NPI Measuring Tape 5 m / 16 ft (NP1008)': dict(tip=[0.1, 0.92]),
  'NPI Great Wall Measuring Tape 3.5 m': dict(img=0, tip=[0.08, 0.88]),
  'NPI Colour Measuring Tape 5 m': dict(tip=[0.15, 0.92]),
  'NPI Colour Measuring Tape 3.5 m': dict(tip=[0.66, 0.95]),
  'Sola Aluminium Box Level': dict(img=0, vial=[0.82, 0.5]),
  'NPI Aluminium Spirit Level (3 Vials)': dict(vial=[0.7, 0.5]),
  'Aluminium Slim Level (Silver)': dict(vial=[0.48, 0.48]),
  'Slim Spirit Level (Yellow)': dict(vial=[0.5, 0.5]),
  'Torpedo Level (Red)': dict(vial=[0.5, 0.5]),
  'Torpedo Level (Blue)': dict(vial=[0.5, 0.5]),
  'Torpedo Level (Sky Blue)': dict(vial=[0.5, 0.5]),
  "Mason's Pointed Level": dict(vial=[0.5, 0.5]),
  'NPI Claw Hammer (Fibreglass Handle)': dict(tip=[0.03, 0.07], pivot=[0.45, 0.97]),
  'KTC Claw Hammer (Green Grip)': dict(tip=[0.03, 0.07], pivot=[0.45, 0.97]),
  'NPI Hand Riveter (Blue)': dict(img=0, pivot=[0.4, 0.15], tip=[0.95, 0.05], lever='right', rot=90),
  'Hand Riveter (Red)': dict(img=0, pivot=[0.6, 0.12], tip=[0.95, 0.04], lever='right', rot=90),
  'Hand Riveter (Yellow)': dict(img=0, pivot=[0.35, 0.1], tip=[0.75, 0.05], lever='right', rot=90),
}

# where each kind of specification lives on the photo (by demo type), used for the close-up shots
def auto_spots(demo, specs):
    t = demo.get('type'); piv = demo.get('pivot') or [0.5, 0.3]; tip = demo.get('tip') or [0.5, 0.05]
    handle = [0.3, 0.7] if t in ('pliers', 'nose', 'diagonal', 'cable', 'circlip-int', 'circlip-ext', 'pincers') else [0.5, 0.72]
    rules = [
        (r'tip|point', tip), (r'jaw|edge|cut|blade', [tip[0], (tip[1] + piv[1]) / 2] if t not in ('knife', 'hacksaw', 'planer') else tip),
        (r'handle|grip', handle), (r'spring', [piv[0], piv[1] + 0.06]), (r'type|setting|adjust', [piv[0], piv[1]]),
        (r'shaft|rod|body|steel|material|finish|frame', [0.5, 0.35] if t not in ('wrench',) else [0.5, 0.45]),
        (r'head', [0.35, 0.07]), (r'face', tip), (r'vial', demo.get('vial') or [0.5, 0.5]),
        (r'length|blade width|case|model|claim|size|drive|pieces|piece|pack|sold|for|fits|cuts|rivets|nozzle|colour|scale|base|brand|include|holder|winding|tape|lock|release|spares|storage|feature', None),
    ]
    import re as _re
    out = []
    for sp in specs:
        lab = sp['label'].lower(); pos = None
        for rx, p in rules:
            if _re.search(rx, lab):
                pos = p; break
        if pos is None:  # spread the rest over the photo so each close-up shows a different area
            k = len(out); pos = [0.5, [0.2, 0.5, 0.8, 0.35][k % 4]]
        out.append([round(pos[0], 3), round(pos[1], 3)])
    return out


if __name__ == '__main__':
    main()
