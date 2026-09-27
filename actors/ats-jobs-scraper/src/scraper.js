// Greenhouse, Lever & Ashby Jobs Scraper: input mapping onto the shared jobs core. Pure, no I/O.
//  - `ats` picks the job-board platforms (empty = all five); `companies` narrows to named companies
//  - live mode (`companyUrls`): the listed boards are fetched as given, so the `ats` selection is not
//    applied to them (a prefilled "greenhouse" must not silently drop a Lever URL the user pasted)
import { normalizeInput } from './core/filters.js';

export function toScraperOptions(input = {}) {
  const opts = normalizeInput(input);
  if (opts.mode === 'live') opts.ats = [];
  return opts;
}
