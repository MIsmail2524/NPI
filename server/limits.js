'use strict';
/* Rate limits — slows down brute-force, spam and scraping. */
const { rateLimit } = require('express-rate-limit');

const json429 = (message) => (req, res) => res.status(429).json({ error: message });
// Only for automated tests: NPI_RATE_MULT raises every limit. Never set it in production.
const M = Math.max(1, Number(process.env.NPI_RATE_MULT) || 1);

module.exports = {
  api: rateLimit({ windowMs: 60_000, limit: 300 * M, standardHeaders: 'draft-7', legacyHeaders: false,
    handler: json429('Too many requests. Please slow down a little.') }),
  login: rateLimit({ windowMs: 15 * 60_000, limit: 10 * M, standardHeaders: 'draft-7', legacyHeaders: false,
    skipSuccessfulRequests: true, handler: json429('Too many login attempts. Please wait 15 minutes and try again.') }),
  register: rateLimit({ windowMs: 60 * 60_000, limit: 5 * M, standardHeaders: 'draft-7', legacyHeaders: false,
    handler: json429('Too many accounts created from this network. Please try later.') }),
  order: rateLimit({ windowMs: 10 * 60_000, limit: 10 * M, standardHeaders: 'draft-7', legacyHeaders: false,
    handler: json429('Too many orders in a short time. Please wait a few minutes.') }),
  contact: rateLimit({ windowMs: 60 * 60_000, limit: 5 * M, standardHeaders: 'draft-7', legacyHeaders: false,
    handler: json429('You have sent several messages already. We will get back to you soon.') }),
  upload: rateLimit({ windowMs: 10 * 60_000, limit: 60 * M, standardHeaders: 'draft-7', legacyHeaders: false,
    handler: json429('Too many uploads. Please wait a few minutes.') })
};
