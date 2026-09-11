#!/usr/bin/env node
/** Run a single ingest cycle and exit. Useful from cron or a deploy hook. */

import { Store, defaultStorePath } from '../src/store.js';
import { ingestAll } from '../src/ingest.js';

const store = await new Store(process.env.STORE_PATH || defaultStorePath()).load();
const r = await ingestAll(store, { enrich: process.env.ENRICH !== 'false' });
console.log(JSON.stringify({ added: r.added, pruned: r.pruned, retained: r.retained }, null, 2));
process.exit(0);
