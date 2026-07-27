/**
 * Release gate ops (P-FORCE-UPDATE-MIN-VERSION / FORCE LATEST FOREVER).
 *
 * OWNER LOCK 2026-07-27 (absolute): the steady state is ARMED — floor = live
 * Play production versionCode, `blockUnreported: true`, forever. `sync` is the
 * ritual that enforces it and is what the publish script calls after every
 * Play upload. `disarm` still exists for a genuine incident (e.g. the gate
 * itself blocking the live build), but leaving production disarmed violates
 * the lock and the NeoXten force-update-gate suite will fail until re-armed.
 *
 * The gate lives in `masters.client-release-gate` and has no admin UI, so the
 * only alternative to this script is hand-editing production Mongo — on the
 * one switch whose failure mode is "every user is locked out of earning".
 * Guardrails:
 *
 *   - `status` prints the live config AND the blast radius, measured against
 *     real users, before anything is changed.
 *   - `sync` reads the LIVE Play production versionCode (Publisher API, never
 *     a guess) and arms floor=live + blockUnreported:true. It prints the blast
 *     radius first; it does not ask for --force because it IS the locked
 *     policy — the honesty is in the printed numbers, not a speed bump.
 *   - `arm` (manual floor) refuses a floor that would block anyone unless
 *     `--force` is passed; `--block-unreported` needs `--force` on top.
 *   - `disarm` is a single argument-free command, so restoring never depends
 *     on remembering what the previous values were — and it shouts the lock.
 *
 * Usage:
 *   node scripts/plastypesa/release-gate.mjs status
 *   node scripts/plastypesa/release-gate.mjs sync        # THE ritual: floor = live Play + blockUnreported
 *   node scripts/plastypesa/release-gate.mjs arm --min 58 --block-unreported --force
 *   node scripts/plastypesa/release-gate.mjs disarm      # incidents only — violates FORCE LATEST FOREVER
 */
import { MongoClient } from 'mongodb';
import { loadBackendMongoEnv } from './mongo-env.mjs';
import { readLivePlayVersion } from './play-live-version.mjs';

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
  sync                                      arm to LIVE Play versionCode + blockUnreported (the locked ritual)
  arm --min <code> [--block-unreported] [--force]
  disarm                                    incidents only — violates FORCE LATEST FOREVER
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

  // The backend writes the reported build to `lastAppVersionCode` /
  // `signupAppVersionCode` (client_app_metadata.service.js). An earlier version
  // of this script counted `appVersionCode`, which no writer ever sets — so it
  // reported "everyone unreported, nobody below floor" no matter what the real
  // fleet looked like, and made `--block-unreported` look free.
  const reported = {
    $ifNull: ['$lastAppVersionCode', '$signupAppVersionCode'],
  };
  const RECENT_DAYS = 7;
  const recentlySeen = new Date(Date.now() - RECENT_DAYS * 24 * 3600 * 1000);

  const [total, buckets] = await Promise.all([
    users.countDocuments(active),
    users
      .aggregate([
        { $match: active },
        { $addFields: { _build: reported } },
        {
          $group: {
            _id: {
              known: { $ne: ['$_build', null] },
              below: { $lt: ['$_build', minVersionCode] },
              recent: { $gte: [{ $ifNull: ['$lastAppSeenAt', new Date(0)] }, recentlySeen] },
            },
            n: { $sum: 1 },
          },
        },
      ])
      .toArray(),
  ]);

  const sum = (pred) =>
    buckets.filter((b) => pred(b._id)).reduce((acc, b) => acc + b.n, 0);

  const unreported = sum((k) => !k.known);
  const belowFloor = sum((k) => k.known && k.below);

  return {
    total,
    unreported,
    belowFloor,
    // Dormant rows are noise; someone who opened the app this week and reports
    // no build is a person who loses the app the moment this is armed.
    unreportedActive: sum((k) => !k.known && k.recent),
    belowFloorActive: sum((k) => k.known && k.below && k.recent),
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
    console.log('\n  *** OWNER LOCK: FORCE LATEST FOREVER — disarmed is NOT a valid steady state. ***');
    console.log('  *** NeoXten force-update-gate will FAIL until you re-arm. When the incident  ***');
    console.log('  *** is over: node scripts/plastypesa/release-gate.mjs sync                   ***');
    process.exit(0);
  }

  async function writeArmed(min, blockUnreported) {
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
  }

  if (command === 'sync') {
    // FORCE LATEST FOREVER: floor = live Play production, blockUnreported on.
    // No --force gate — this IS the locked policy; honesty is the printed
    // blast radius, not a prompt someone learns to bypass.
    const live = await readLivePlayVersion();
    console.log(`\nLive Play production: ${live.releaseName} · versionCode ${live.versionCode} · ${live.status}`);

    const radius = await blastRadius(db, {
      minVersionCode: live.versionCode,
      blockUnreported: true,
    });
    console.log(`\nBlast radius of floor ${live.versionCode} + blockUnreported:`);
    console.log(`  ACTIVE users          : ${radius.total}`);
    console.log(`  reporting below floor : ${radius.belowFloor}  <-- WILL BE BLOCKED until they update`);
    console.log(`  reporting no version  : ${radius.unreported}  <-- WILL BE BLOCKED until they update`);
    console.log(`  => refusing           : ${radius.blocked} user(s) until they install live Play`);

    await writeArmed(live.versionCode, true);
    console.log('\nFORCE LATEST FOREVER enforced: min = live Play, blockUnreported on.');
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

  await writeArmed(min, blockUnreported);
  console.log('Incident disarm (violates the lock; NeoXten will fail until re-armed):');
  console.log('  node scripts/plastypesa/release-gate.mjs disarm');
} finally {
  await client.close();
}
