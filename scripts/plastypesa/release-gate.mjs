/**
 * Release gate ops (P-FORCE-UPDATE-MIN-VERSION).
 *
 * The gate that refuses traffic from unsupported app builds lives in
 * `masters.client-release-gate` and has no admin UI, so the only alternative to
 * this script is hand-editing production Mongo — on the one switch whose
 * failure mode is "every user is locked out of earning". Hence the guardrails:
 *
 *   - `status` prints the live config AND the blast radius, measured against
 *     real users, before anything is changed.
 *   - `arm` refuses a floor that would block anyone who is not the tester
 *     unless `--force` is passed, and always prints the disarm command.
 *   - `blockUnreported` is the blunt lever (it catches every build that
 *     predates version reporting) and needs `--force` on top.
 *   - `disarm` is a single argument-free command, so restoring never depends
 *     on remembering what the previous values were.
 *
 * Usage:
 *   node scripts/plastypesa/release-gate.mjs status
 *   node scripts/plastypesa/release-gate.mjs arm --min 58
 *   node scripts/plastypesa/release-gate.mjs arm --min 57 --block-unreported --force
 *   node scripts/plastypesa/release-gate.mjs disarm
 */
import { MongoClient } from 'mongodb';
import { loadBackendMongoEnv } from './mongo-env.mjs';

const GATE_NAME = 'client-release-gate';
const PLAY_PACKAGE = 'com.app.plasty_pesa';
const STORE_URL = `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE}`;
const CACHE_TTL_SECONDS = 30;

const argv = process.argv.slice(2);
const command = argv[0];
const has = (flag) => argv.includes(flag);
const value = (flag) => {
  const i = argv.indexOf(flag);
  return i === -1 ? null : argv[i + 1];
};

function usage(message) {
  if (message) console.error(`\n${message}`);
  console.error(`
  status                                    show live gate + blast radius
  arm --min <code> [--block-unreported] [--force]
  disarm
`);
  process.exit(message ? 1 : 0);
}

/**
 * Who would actually be refused. Users who report no version are only caught
 * by `blockUnreported`, which is exactly the distinction that decides whether
 * a floor is a safe test or an outage.
 */
async function blastRadius(db, { minVersionCode, blockUnreported }) {
  const users = db.collection('users');
  const active = { role: { $nin: ['admin'] }, status: 'ACTIVE' };

  const [total, unreported, belowFloor] = await Promise.all([
    users.countDocuments(active),
    users.countDocuments({
      ...active,
      $or: [{ appVersionCode: null }, { appVersionCode: { $exists: false } }],
    }),
    users.countDocuments({ ...active, appVersionCode: { $lt: minVersionCode, $ne: null } }),
  ]);

  return {
    total,
    unreported,
    belowFloor,
    blocked: belowFloor + (blockUnreported ? unreported : 0),
  };
}

function printConfig(label, metadata) {
  const m = metadata || {};
  console.log(`\n${label}`);
  console.log(`  enabled          : ${m.enabled === true}`);
  console.log(`  android floor    : ${m.android?.minVersionCode ?? 0}`);
  console.log(`  blockUnreported  : ${m.android?.blockUnreported === true}`);
  console.log(`  storeUrl         : ${m.storeUrl?.android ?? '(service default)'}`);
}

const client = new MongoClient(loadBackendMongoEnv());
await client.connect();
const db = client.db();
const masters = db.collection('masters');

try {
  const current = await masters.findOne({ name: GATE_NAME });

  if (!command || command === 'status') {
    printConfig(
      current ? 'LIVE gate config' : 'LIVE gate config — no master row (service defaults: OFF)',
      current?.metadata
    );
    const floor = current?.metadata?.android?.minVersionCode ?? 0;
    const radius = await blastRadius(db, {
      minVersionCode: floor || Number.MAX_SAFE_INTEGER,
      blockUnreported: current?.metadata?.android?.blockUnreported === true,
    });
    console.log(`\nACTIVE non-admin users: ${radius.total}`);
    console.log(`  reporting no version : ${radius.unreported}  (only reachable via --block-unreported)`);
    console.log(`  below current floor  : ${floor ? radius.belowFloor : 'n/a (no floor set)'}`);
    if (current?.metadata?.enabled === true) {
      console.log(`\n  GATE IS ARMED — currently refusing ~${radius.blocked} user(s).`);
      console.log('  Disarm: node scripts/plastypesa/release-gate.mjs disarm');
    }
    process.exit(0);
  }

  if (command === 'disarm') {
    await masters.updateOne(
      { name: GATE_NAME },
      {
        $set: {
          name: GATE_NAME,
          'metadata.enabled': false,
          'metadata.android.minVersionCode': 0,
          'metadata.android.blockUnreported': false,
          'metadata.storeUrl.android': STORE_URL,
          'metadata.updatedAt': new Date(),
        },
      },
      { upsert: true }
    );
    console.log('Gate DISARMED (enabled:false, floor 0, blockUnreported off).');
    console.log(`Server caches config for ${CACHE_TTL_SECONDS}s — allow that before retesting the app.`);
    process.exit(0);
  }

  if (command !== 'arm') usage(`Unknown command: ${command}`);

  const min = Number.parseInt(value('--min') ?? '', 10);
  if (!Number.isFinite(min) || min < 1) usage('arm requires --min <versionCode>');
  const blockUnreported = has('--block-unreported');
  const force = has('--force');

  const radius = await blastRadius(db, { minVersionCode: min, blockUnreported });
  console.log(`\nBlast radius of floor ${min}${blockUnreported ? ' + blockUnreported' : ''}:`);
  console.log(`  ACTIVE users          : ${radius.total}`);
  console.log(`  reporting below floor : ${radius.belowFloor}`);
  console.log(`  reporting no version  : ${radius.unreported}${blockUnreported ? '  <-- WILL BE BLOCKED' : '  (not blocked)'}`);
  console.log(`  => would refuse       : ${radius.blocked} user(s)`);

  if (blockUnreported && !force) {
    usage(
      'Refusing: --block-unreported is indiscriminate — it blocks every build that predates\n' +
      'version reporting, and those builds have no update screen to show. Re-run with --force\n' +
      'if that is genuinely the intent.'
    );
  }

  if (radius.blocked > 0 && !force) {
    usage(
      `Refusing: this would refuse ${radius.blocked} real user(s). If this is a deliberate\n` +
      'pull of a bad build, re-run with --force.'
    );
  }

  await masters.updateOne(
    { name: GATE_NAME },
    {
      $set: {
        name: GATE_NAME,
        'metadata.enabled': true,
        'metadata.android.minVersionCode': min,
        'metadata.android.blockUnreported': blockUnreported,
        'metadata.storeUrl.android': STORE_URL,
        'metadata.updatedAt': new Date(),
      },
    },
    { upsert: true }
  );

  printConfig('Gate ARMED', (await masters.findOne({ name: GATE_NAME }))?.metadata);
  console.log(`\nTakes effect within ${CACHE_TTL_SECONDS}s (server config cache).`);
  console.log('DISARM WHEN DONE: node scripts/plastypesa/release-gate.mjs disarm');
} finally {
  await client.close();
}
