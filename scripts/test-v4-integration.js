#!/usr/bin/env node

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const planPath = path.join(root, 'plan.js');
const indexPath = path.join(root, 'index.html');
const swPath = path.join(root, 'sw.js');
const snapshotPath = path.join(root, 'healthy-mcp', 'data', 'posture-recovery-2026-08-30.json');

function loadPlan(source) {
  const context = {};
  vm.createContext(context);
  return vm.runInContext(
    `${source};({ PLAN_DATA, WEEKS, VIDEO_MAP, EXERCISE_NAME_ALIASES, getVideoForExercise, ` +
      `v4Meta: typeof V4_PLAN_META === 'undefined' ? null : V4_PLAN_META })`,
    context,
    { timeout: 5000 }
  );
}

function allWeekExercises(weeks) {
  return weeks.flatMap(week => (week.days || []).flatMap(day =>
    (day.groups || []).flatMap(group => group.exercises || [])
  ));
}

function aliasesFor(name, groups) {
  const result = new Set([name]);
  for (const group of groups) {
    if (group.includes(name)) group.forEach(alias => result.add(alias));
  }
  return result;
}

function sha256Json(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

// Immutable compatibility baseline for the complete Week 3-18 objects in
// f1a5d12fbae9845b969451201eb7b3acafc8d1df. Keeping the digests here makes
// this regression check independent of HEAD and runnable without a .git tree.
const LEGACY_WEEK_SHA256 = Object.freeze({
  3: 'afd5c75e1da316d5b40c7555a43de6a87955ae71f7c1e4699537cd7163aafce2',
  4: 'b2909dfb6182fd3f3f33b328217eb0d7a760fda4138eca9c79c5587654128815',
  5: '2a851aab232ca80e3123b7490659fbc0a5d33cd653f5cdd17649e4bfc5620b9a',
  6: '3d7ced74fae7b8d6820a2046ba2e3e4f81bf0a6ac8d52d66db26d70efacebd7b',
  7: '7d8530572c221fbb02a1c077ecd95a364681645e96dfeacac0510c37f88d2b9b',
  8: '97d52653ed4ce344519ec6cb6c33e4b548676011aea10340d719841870d88406',
  9: '0f08fa96c4e49db97381e1efbe0e737fdcc6f062b49052fd5a3e0e7160b125f3',
  10: '6d4a9270fc424e7e0c307a5e54b470fc99726fc4ca64de37d81e141d84ac0e51',
  11: '5a2325df09a820f0e583e7b5e7f00743656aed7629a07182ae42619af61195ec',
  12: '1175e3178d4a722b22e8368f6926c30b6e157101b027d33244ce66a9d7b69ede',
  13: '738672bbb5e08cd5b77a0cfeed8655f6ce2ab2f083424ecb7e83c1726170f2c7',
  14: 'fbe889ddd5a31eb37413ee9d58636ecc4776dec5ca8c0d4f1d99057e495258f8',
  15: 'e841933c5d8373f0e4bc3ab5c98fac78d5ecb57fc59b16f60c8d042d3f818d7b',
  16: '236a40ccfe5b1aeec124658fbe44d9b43258c44343fdd703e21215b24a235cc0',
  17: 'a0f6eff076db21497bbacf17b7874426e0afa3109f28ffc0f8e8978f5c2ae25d',
  18: 'f13a17ba22db27930ddfee75f215a121bb52885dd0ea2a80883e22b2019ebbcb'
});

function extractFunctionDeclaration(source, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:async\\s+)?function\\s+${escapedName}\\s*\\(`).exec(source);
  assert(match, `production function ${name} not found in index.html`);
  const start = match.index;
  const openingParen = source.indexOf('(', start);
  let parameterDepth = 0;
  let parameterQuote = null;
  let parameterEscaped = false;
  let closingParen = -1;
  for (let i = openingParen; i < source.length; i++) {
    const char = source[i];
    if (parameterQuote) {
      if (parameterEscaped) parameterEscaped = false;
      else if (char === '\\') parameterEscaped = true;
      else if (char === parameterQuote) parameterQuote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      parameterQuote = char;
      continue;
    }
    if (char === '(') parameterDepth++;
    if (char === ')' && --parameterDepth === 0) {
      closingParen = i;
      break;
    }
  }
  assert(closingParen >= 0, `production function ${name} has unterminated parameters`);
  const openingBrace = source.indexOf('{', closingParen + 1);
  assert(openingBrace >= 0, `production function ${name} has no body`);

  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = openingBrace; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      i++;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      i++;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth++;
    if (char === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`production function ${name} body is unterminated`);
}

async function executeProductionWorkoutBackfill(indexSource, plan, workoutLogs) {
  const records = JSON.parse(JSON.stringify(workoutLogs));
  const writes = [];
  const batches = [];
  const context = {
    PLAN_DATA: plan.PLAN_DATA,
    WEEKS: plan.WEEKS,
    EXERCISE_NAME_ALIASES: plan.EXERCISE_NAME_ALIASES,
    dbGetAll: async storeName => {
      assert.strictEqual(storeName, 'workoutLogs');
      return records;
    },
    dbPutMany: async (storeName, batch) => {
      assert.strictEqual(storeName, 'workoutLogs');
      assert(Array.isArray(batch), 'backfill must pass an array to dbPutMany');
      const normalizedBatch = JSON.parse(JSON.stringify(batch));
      batches.push(normalizedBatch);
      for (const record of normalizedBatch) {
        const index = records.findIndex(item => item.id === record.id);
        assert(index >= 0, `backfill wrote unknown workout log id ${record.id}`);
        records[index] = record;
        writes.push(record);
      }
      return normalizedBatch.length;
    }
  };
  vm.createContext(context);
  const productionFunctions = [
    'getAllExercises',
    'getExerciseAliases',
    'resolveMovementId',
    'findExerciseById',
    'backfillWorkoutMovementIds'
  ].map(name => extractFunctionDeclaration(indexSource, name)).join('\n');
  vm.runInContext(productionFunctions, context, { timeout: 5000 });

  const originalExerciseIds = new Map(records.map(record => [record.id, record.exerciseId]));
  const firstFilled = await vm.runInContext('backfillWorkoutMovementIds()', context, { timeout: 5000 });
  const firstWrites = writes.length;
  assert.strictEqual(batches.length, 1, 'first backfill must use one batch write');
  assert.strictEqual(batches[0].length, firstFilled, 'batch size must equal backfill return count');
  assert.strictEqual(firstWrites, firstFilled, 'backfill return count must equal persisted writes');
  for (const record of records) {
    assert.strictEqual(record.exerciseId, originalExerciseIds.get(record.id), `workout log ${record.id} exerciseId changed`);
  }

  const afterFirstRun = JSON.stringify(records);
  const secondFilled = await vm.runInContext('backfillWorkoutMovementIds()', context, { timeout: 5000 });
  assert.strictEqual(secondFilled, 0, 'workout movementId backfill must be idempotent');
  assert.strictEqual(batches.length, 2, 'idempotent rerun must still exercise the batch persistence boundary');
  assert.strictEqual(batches[1].length, 0, 'idempotent rerun batch must be empty');
  assert.strictEqual(writes.length, firstWrites, 'idempotent rerun must not persist more records');
  assert.strictEqual(JSON.stringify(records), afterFirstRun, 'idempotent rerun changed workout logs');
  return { records, firstFilled };
}

function verifyProductionSyncReceiptChecks(indexSource) {
  const payload = {
    workoutLogs: [{ id: 1 }], exerciseNotes: [], dailyHabits: [],
    bodyMetrics: [], settings: [{ key: 'startDate', value: '2026-05-11' }], aiAnalysis: []
  };
  const requestSha256 = 'a'.repeat(64);
  const payloadSha256 = 'b'.repeat(64);
  const validReceipt = {
    ok: true,
    syncedAt: '2026-09-03T12:00:00.000Z',
    requestSha256,
    payloadSha256,
    strippedSettings: [],
    counts: {
      workoutLogs: 1, exerciseNotes: 0, dailyHabits: 0,
      bodyMetrics: 0, settings: 1, aiAnalysis: 0
    }
  };
  const context = {
    SYNC_COUNT_FIELDS: ['workoutLogs', 'exerciseNotes', 'dailyHabits', 'bodyMetrics', 'settings', 'aiAnalysis'],
    payload,
    requestSha256,
    responseEtag: `"${payloadSha256}"`,
    receipt: validReceipt
  };
  vm.createContext(context);
  const functions = ['syncCounts', 'syncProtocolError', 'canonicalSyncVersion', 'validateSyncReceipt']
    .map(name => extractFunctionDeclaration(indexSource, name)).join('\n');
  vm.runInContext(functions, context, { timeout: 5000 });
  for (const transformedEtag of [
    `"${payloadSha256}"`,
    `W/"${payloadSha256}"`,
    `"${payloadSha256}-zstd"`,
    ''
  ]) {
    context.responseEtag = transformedEtag;
    const canonical = vm.runInContext(
      'validateSyncReceipt(receipt, responseEtag, requestSha256, payload)',
      context,
      { timeout: 5000 }
    );
    assert.strictEqual(canonical, `"${payloadSha256}"`, `failed to canonicalize ETag: ${transformedEtag || '(missing)'}`);
  }

  const invalidReceipts = [
    { ...validReceipt, requestSha256: 'c'.repeat(64) },
    { ...validReceipt, strippedSettings: ['startDate'] },
    { ...validReceipt, counts: { ...validReceipt.counts, workoutLogs: 0 } },
    { ...validReceipt, payloadSha256: 'd'.repeat(64) },
    { ...validReceipt, payloadSha256: '' },
    { ...validReceipt, payloadSha256: 'b'.repeat(63) },
    { ...validReceipt, payloadSha256: 'g'.repeat(64) }
  ];
  for (const invalid of invalidReceipts) {
    context.receipt = invalid;
    context.responseEtag = `"${payloadSha256}"`;
    assert.throws(
      () => vm.runInContext('validateSyncReceipt(receipt, responseEtag, requestSha256, payload)', context, { timeout: 5000 }),
      /服务端/
    );
  }
  context.receipt = validReceipt;
  context.responseEtag = `W/"${'c'.repeat(64)}"`;
  assert.throws(
    () => vm.runInContext('validateSyncReceipt(receipt, responseEtag, requestSha256, payload)', context, { timeout: 5000 }),
    /不一致/
  );
}

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, String(value)]));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

function createProductionSyncTab(indexSource, localStorage, tabName, fetchImpl) {
  let uuidCounter = 0;
  const savedSettings = new Map();
  const capturedErrors = [];
  const context = {
    URL,
    localStorage,
    window: {
      location: { href: 'https://health.gaindar.com/' },
      crypto: { randomUUID: () => `${tabName}-uuid-${++uuidCounter}` },
      confirm: () => true
    },
    performance: { now: () => 1 },
    navigator: { onLine: true },
    AbortController,
    setTimeout: () => 1,
    clearTimeout: () => {},
    console: { error: (...args) => { capturedErrors.push(args); } },
    getSetting: async key => key === 'syncUrl'
      ? '/api/sync'
      : key === 'syncSecret'
        ? 'test-secret'
        : savedSettings.get(key) ?? null,
    setSetting: async (key, value) => { savedSettings.set(key, value); },
    normalizeSyncUrl: value => value || '/api/sync',
    assembleSyncPayload: async () => ({
      exportedAt: '2026-09-03T12:00:00.000Z', appVersion: '1.2.1',
      workoutLogs: [], exerciseNotes: [], dailyHabits: [], bodyMetrics: [], settings: [], aiAnalysis: []
    }),
    sha256Hex: async () => 'a'.repeat(64),
    fetch: fetchImpl,
    syncFailurePolicy: status => [412, 428].includes(status)
      ? { retryable: false, blocked: 'conflict' }
      : { retryable: false, blocked: 'request' },
    updateSyncStatus: () => {},
    showToast: () => {},
    retryCalls: 0
  };
  Object.assign(context, {
    SYNC_COUNT_FIELDS: ['workoutLogs', 'exerciseNotes', 'dailyHabits', 'bodyMetrics', 'settings', 'aiAnalysis'],
    SYNC_REVISION_KEY: 'healthySyncRevision',
    SYNC_ACK_REVISION_KEY: 'healthySyncAckRevision',
    SYNC_DIRTY_TOKEN_KEY: 'healthySyncDirtyToken',
    SYNC_ERROR_KEY: 'healthySyncLastError',
    SYNC_ETAG_KEY: 'healthySyncEtag',
    SYNC_CONFLICT_ETAG_KEY: 'healthySyncConflictEtag',
    SYNC_CONFLICT_INFO_KEY: 'healthySyncConflictInfo',
    SYNC_BLOCKED_KEY: 'healthySyncBlocked',
    SYNC_RETRY_COUNT_KEY: 'healthySyncRetryCount',
    SYNC_NEXT_RETRY_AT_KEY: 'healthySyncNextRetryAt',
    _syncTimer: null,
    _syncing: false,
    _syncRevision: Number(localStorage.getItem('healthySyncRevision') || 0),
    _syncAckRevision: Number(localStorage.getItem('healthySyncAckRevision') || 0),
    _syncDirtyToken: localStorage.getItem('healthySyncDirtyToken') || '',
    _syncBlocked: localStorage.getItem('healthySyncBlocked') || '',
    _syncRetryCount: Number(localStorage.getItem('healthySyncRetryCount') || 0),
    _syncTokenCounter: 0
  });
  context._syncDirty = Boolean(context._syncDirtyToken) || context._syncRevision > context._syncAckRevision;
  context.scheduleSyncRetry = () => { context.retryCalls += 1; };
  context._savedSettings = savedSettings;
  context._capturedErrors = capturedErrors;

  vm.createContext(context);
  const functions = [
    'syncCounts',
    'compactSyncCounts',
    'syncCountDifference',
    'syncProtocolError',
    'canonicalSyncVersion',
    'validateSyncReceipt',
    'canonicalSyncJson',
    'syncPayloadStateMatches',
    'snapshotUrlForSync',
    'fetchCloudSnapshot',
    'saveCloudConflictInfo',
    'captureCloudConflict',
    'persistSyncAcknowledgement',
    'refreshSyncStateFromStorage',
    'newSyncDirtyToken',
    'clearSyncRetryState',
    'markCloudSyncDirty',
    'syncToCloud'
  ].map(name => extractFunctionDeclaration(indexSource, name)).join('\n');
  vm.runInContext(functions, context, { timeout: 5000 });
  return context;
}

function successfulSyncResponse() {
  const payloadSha256 = 'b'.repeat(64);
  return {
    ok: true,
    headers: { get: name => name === 'ETag' ? `W/"${payloadSha256}"` : '' },
    text: async () => JSON.stringify({
      ok: true,
      syncedAt: '2026-09-03T12:00:00.000Z',
      serverRevision: 1,
      payloadSha256,
      requestSha256: 'a'.repeat(64),
      strippedSettings: [],
      counts: {
        workoutLogs: 0, exerciseNotes: 0, dailyHabits: 0,
        bodyMetrics: 0, settings: 0, aiAnalysis: 0
      }
    })
  };
}

async function verifyLostReceiptUpgradeRecovery(indexSource) {
  const payloadSha256 = 'b'.repeat(64);
  const remoteSnapshot = {
    exportedAt: '2026-09-04T00:50:00.000Z',
    appVersion: '1.2.0',
    workoutLogs: [], exerciseNotes: [], dailyHabits: [],
    bodyMetrics: [], settings: [], aiAnalysis: []
  };
  const storage = createMemoryStorage({
    healthySyncRevision: '1',
    healthySyncAckRevision: '0',
    healthySyncDirtyToken: 'v120-lost-receipt'
  });
  const calls = [];
  let postCount = 0;
  const tab = createProductionSyncTab(indexSource, storage, 'lost-receipt', async (url, options) => {
    calls.push({ url, method: options.method, headers: { ...options.headers } });
    if (options.method === 'POST' && postCount++ === 0) {
      return {
        ok: false,
        status: 428,
        headers: { get: name => name === 'ETag' ? `W/"${payloadSha256}"` : '' },
        text: async () => JSON.stringify({
          ok: false,
          error: 'precondition_required',
          currentPayloadSha256: payloadSha256
        })
      };
    }
    if (options.method === 'GET') {
      return {
        ok: true,
        status: 200,
        headers: { get: () => '' },
        text: async () => JSON.stringify({
          ok: true,
          snapshot: remoteSnapshot,
          payloadSha256,
          updatedAt: '2026-09-04T00:50:01.000Z',
          exportedAt: remoteSnapshot.exportedAt,
          appVersion: remoteSnapshot.appVersion,
          serverRevision: 1,
          counts: {
            workoutLogs: 0, exerciseNotes: 0, dailyHabits: 0,
            bodyMetrics: 0, settings: 0, aiAnalysis: 0
          }
        })
      };
    }
    return successfulSyncResponse();
  });

  const recovered = await vm.runInContext('syncToCloud({ silent: true })', tab, { timeout: 5000 });
  assert.strictEqual(recovered.recovered, true, 'lost v1.2.0 receipt must recover when every durable data array matches');
  assert.deepStrictEqual(calls.slice(0, 2).map(call => call.method), ['POST', 'GET'], 'lost receipt recovery must inspect cloud after 428');
  assert.strictEqual(storage.getItem('healthySyncEtag'), `"${payloadSha256}"`, 'recovery must persist a canonical strong If-Match token');
  assert.strictEqual(storage.getItem('healthySyncDirtyToken'), null, 'matching cloud snapshot must acknowledge the pending token');
  assert.strictEqual(storage.getItem('healthySyncBlocked'), null, 'matching cloud snapshot must not remain conflict-blocked');
  assert.strictEqual(tab._savedSettings.get('lastSyncReceipt').etag, `"${payloadSha256}"`, 'recovered receipt must record canonical version');

  vm.runInContext('markCloudSyncDirty()', tab, { timeout: 5000 });
  await vm.runInContext('syncToCloud({ silent: true })', tab, { timeout: 5000 });
  const followUpPost = calls.find((call, index) => index >= 2 && call.method === 'POST');
  assert.strictEqual(followUpPost.headers['If-Match'], `"${payloadSha256}"`, 'next mutation must send the recovered canonical If-Match');

  const differentStorage = createMemoryStorage({
    healthySyncRevision: '1',
    healthySyncAckRevision: '0',
    healthySyncDirtyToken: 'different-remote'
  });
  let differentCall = 0;
  let differentPostCount = 0;
  let confirmedIfMatch = null;
  const differentTab = createProductionSyncTab(indexSource, differentStorage, 'different-remote', async (url, options) => {
    differentCall += 1;
    if (options.method === 'POST') {
      if (differentPostCount++ > 0) {
        confirmedIfMatch = options.headers['If-Match'];
        return successfulSyncResponse();
      }
      return {
        ok: false,
        status: 428,
        headers: { get: () => '' },
        text: async () => JSON.stringify({ ok: false, error: 'precondition_required', currentPayloadSha256: payloadSha256 })
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: name => name === 'ETag' ? `W/"${payloadSha256}"` : '' },
      text: async () => JSON.stringify({
        ok: true,
        snapshot: { ...remoteSnapshot, workoutLogs: [{ id: 99 }] },
        payloadSha256,
        updatedAt: '2026-09-04T00:50:01.000Z',
        serverRevision: 1,
        counts: {
          workoutLogs: 1, exerciseNotes: 0, dailyHabits: 0,
          bodyMetrics: 0, settings: 0, aiAnalysis: 0
        }
      })
    };
  });
  const conflict = await vm.runInContext('syncToCloud({ silent: true })', differentTab, { timeout: 5000 });
  assert.strictEqual(conflict.ok, false, 'different cloud data must not be auto-acknowledged');
  assert.strictEqual(differentStorage.getItem('healthySyncBlocked'), 'conflict', 'different cloud data must remain conflict-blocked');
  assert(differentStorage.getItem('healthySyncDirtyToken'), 'different cloud data must preserve the pending local token');
  assert(differentStorage.getItem('healthySyncConflictInfo'), 'different cloud data must retain a conflict summary');
  assert.strictEqual(differentCall, 2, 'different cloud data should use one POST and one read-only GET');
  await vm.runInContext('syncToCloud({ silent: false })', differentTab, { timeout: 5000 });
  assert.strictEqual(confirmedIfMatch, `"${payloadSha256}"`, 'confirmed overwrite must use canonical ETag, never the weak 428 header');
}

async function verifyProductionSyncDirtyTokenConcurrency(indexSource) {
  const storage = createMemoryStorage();
  let releaseFirstRequest;
  let markFirstRequestStarted;
  const firstRequestStarted = new Promise(resolve => { markFirstRequestStarted = resolve; });
  const tabA = createProductionSyncTab(indexSource, storage, 'tab-a', async () => {
    markFirstRequestStarted();
    return new Promise(resolve => { releaseFirstRequest = resolve; });
  });
  const tabB = createProductionSyncTab(indexSource, storage, 'tab-b', async () => successfulSyncResponse());

  vm.runInContext('markCloudSyncDirty()', tabA, { timeout: 5000 });
  const tokenA = storage.getItem('healthySyncDirtyToken');
  const requestA = vm.runInContext('syncToCloud({ silent: true })', tabA, { timeout: 5000 });
  await firstRequestStarted;

  vm.runInContext('markCloudSyncDirty()', tabB, { timeout: 5000 });
  const tokenB = storage.getItem('healthySyncDirtyToken');
  assert(tokenA && tokenB && tokenA !== tokenB, 'two tabs must write distinct dirty tokens');

  releaseFirstRequest(successfulSyncResponse());
  await requestA;
  assert.strictEqual(storage.getItem('healthySyncDirtyToken'), tokenB, 'tab A acknowledgement cleared tab B dirty token');
  assert.strictEqual(vm.runInContext('_syncDirty', tabA), true, 'tab A must remain dirty after observing tab B token');
  assert.strictEqual(tabA.retryCalls, 1, 'tab A must schedule a follow-up after a concurrent edit');

  const restartedTab = createProductionSyncTab(indexSource, storage, 'restarted', async () => successfulSyncResponse());
  assert.strictEqual(vm.runInContext('_syncDirty', restartedTab), true, 'restart must recover unsynced state from tab B token');
  await vm.runInContext('syncToCloud({ silent: true })', restartedTab, { timeout: 5000 });
  assert.strictEqual(
    storage.getItem('healthySyncDirtyToken'),
    null,
    `non-concurrent acknowledgement must clear its captured token; errors=${restartedTab._capturedErrors.map(parts => parts.map(String).join(' ')).join(' | ')}`
  );
  assert.strictEqual(vm.runInContext('_syncDirty', restartedTab), false, 'tab must become clean after acknowledging the latest token');
  assert.strictEqual(storage.getItem('healthySyncEtag'), `"${'b'.repeat(64)}"`, 'weak success ETag must persist as a canonical strong token');
  assert.strictEqual(
    storage.getItem('healthySyncRevision'),
    storage.getItem('healthySyncAckRevision'),
    'latest revision must be acknowledged after the follow-up sync'
  );
}

function createLegacyMigrationContext(indexSource, legacySettings) {
  const localStorage = createMemoryStorage();
  const idbStores = new Map([
    ['settings', JSON.parse(JSON.stringify(legacySettings))]
  ]);
  let uuidCounter = 0;
  const context = {
    localStorage,
    URL,
    LS_PREFIX: 'pwa_',
    LS_STORES: ['workoutLogs', 'exerciseNotes', 'dailyHabits', 'bodyMetrics', 'settings', 'aiAnalysis'],
    DEFAULT_SYNC_URL: '/api/sync',
    SYNC_REVISION_KEY: 'healthySyncRevision',
    SYNC_ACK_REVISION_KEY: 'healthySyncAckRevision',
    SYNC_DIRTY_TOKEN_KEY: 'healthySyncDirtyToken',
    SYNC_ERROR_KEY: 'healthySyncLastError',
    SYNC_ETAG_KEY: 'healthySyncEtag',
    SYNC_CONFLICT_ETAG_KEY: 'healthySyncConflictEtag',
    SYNC_CONFLICT_INFO_KEY: 'healthySyncConflictInfo',
    SYNC_BLOCKED_KEY: 'healthySyncBlocked',
    SYNC_RETRY_COUNT_KEY: 'healthySyncRetryCount',
    SYNC_NEXT_RETRY_AT_KEY: 'healthySyncNextRetryAt',
    _syncRevision: 0,
    _syncAckRevision: 0,
    _syncDirtyToken: '',
    _syncDirty: false,
    _syncBlocked: '',
    _syncRetryCount: 0,
    _syncTokenCounter: 0,
    window: {
      location: { href: 'https://health.gaindar.com/' },
      crypto: { randomUUID: () => `migration-uuid-${++uuidCounter}` }
    },
    performance: { now: () => 1 },
    alert: () => {},
    console: { error: () => {} },
    _idbGetAll: async storeName => JSON.parse(JSON.stringify(idbStores.get(storeName) || [])),
    _idbPut: async (storeName, record) => {
      const records = idbStores.get(storeName) || [];
      const keyField = storeName === 'settings' ? 'key' : 'id';
      const index = records.findIndex(item => item[keyField] === record[keyField]);
      if (index >= 0) records[index] = JSON.parse(JSON.stringify(record));
      else records.push(JSON.parse(JSON.stringify(record)));
      idbStores.set(storeName, records);
    },
    dbGet: async (storeName, key) => {
      const records = JSON.parse(localStorage.getItem(`pwa_${storeName}`) || '[]');
      const keyField = storeName === 'settings' ? 'key' : 'id';
      return records.find(item => item[keyField] === key);
    },
    dbPut: async (storeName, record) => {
      const records = JSON.parse(localStorage.getItem(`pwa_${storeName}`) || '[]');
      const keyField = storeName === 'settings' ? 'key' : 'id';
      const index = records.findIndex(item => item[keyField] === record[keyField]);
      if (index >= 0) records[index] = JSON.parse(JSON.stringify(record));
      else records.push(JSON.parse(JSON.stringify(record)));
      localStorage.setItem(`pwa_${storeName}`, JSON.stringify(records));
      await context._idbPut(storeName, record);
      return record[keyField];
    }
  };
  vm.createContext(context);
  const functions = [
    'lsRead',
    'lsWrite',
    'migrateFromIDB',
    'getSetting',
    'setSetting',
    'normalizeSyncUrl',
    'refreshSyncStateFromStorage',
    'newSyncDirtyToken',
    'clearSyncRetryState',
    'markCloudSyncDirty',
    'ensureAwsSyncConfig'
  ].map(name => extractFunctionDeclaration(indexSource, name)).join('\n');
  vm.runInContext(functions, context, { timeout: 5000 });
  return context;
}

async function verifyLegacySettingsMigrationOrder(indexSource) {
  const migrationCall = indexSource.lastIndexOf('const idbMigration = await migrateFromIDB();');
  const awsConfigCall = indexSource.lastIndexOf('await ensureAwsSyncConfig();');
  assert(migrationCall >= 0 && awsConfigCall > migrationCall, 'startup must migrate IndexedDB before writing the default AWS sync URL');

  const oldSupabaseUrl = 'https://legacy-project.supabase.co/functions/v1/sync';
  const legacySettings = [
    { key: 'syncUrl', value: oldSupabaseUrl },
    { key: 'syncSecret', value: 'legacy-local-secret' },
    { key: 'startDate', value: '2026-05-11' },
    { key: 'aiProvider', value: 'claude' },
    { key: 'aiApiKey', value: 'legacy-local-ai-key' }
  ];
  const context = createLegacyMigrationContext(indexSource, legacySettings);
  const migration = await vm.runInContext('migrateFromIDB()', context, { timeout: 5000 });
  assert.strictEqual(migration.migrated, legacySettings.length, 'empty localStorage must restore every legacy IndexedDB setting');
  assert.strictEqual(await vm.runInContext("getSetting('syncSecret')", context), 'legacy-local-secret');
  assert.strictEqual(await vm.runInContext("getSetting('startDate')", context), '2026-05-11');
  assert.strictEqual(await vm.runInContext("getSetting('aiApiKey')", context), 'legacy-local-ai-key');

  await vm.runInContext('ensureAwsSyncConfig()', context, { timeout: 5000 });
  assert.strictEqual(await vm.runInContext("getSetting('syncUrl')", context), '/api/sync', 'legacy Supabase URL must normalize after settings recovery');
  assert.strictEqual(await vm.runInContext("getSetting('syncSecret')", context), 'legacy-local-secret', 'AWS URL migration must not hide the recovered sync secret');
  assert.strictEqual(JSON.parse(context.localStorage.getItem('pwa_settings')).length, legacySettings.length, 'default URL migration must not replace the recovered settings store');
  assert(context.localStorage.getItem('healthySyncDirtyToken'), 'migrating a configured legacy endpoint must leave a durable dirty token');

  const recoveryContext = createLegacyMigrationContext(indexSource, []);
  recoveryContext.localStorage.setItem('healthySyncBlocked', 'request');
  recoveryContext.localStorage.setItem('healthySyncLastError', '服务端未返回可校验的数据版本');
  recoveryContext.localStorage.setItem('healthySyncDirtyToken', 'v120-pending');
  vm.runInContext("_syncBlocked = 'request'", recoveryContext, { timeout: 5000 });
  await vm.runInContext('ensureAwsSyncConfig()', recoveryContext, { timeout: 5000 });
  assert.strictEqual(recoveryContext.localStorage.getItem('healthySyncBlocked'), null, 'v1.2.0 ETag false positive must be unblocked after upgrade');
  assert.strictEqual(recoveryContext.localStorage.getItem('healthySyncLastError'), null, 'obsolete v1.2.0 ETag error must be cleared after upgrade');
  assert.strictEqual(recoveryContext.localStorage.getItem('healthySyncDirtyToken'), 'v120-pending', 'upgrade recovery must preserve the pending snapshot token');
  recoveryContext.localStorage.setItem('healthySyncBlocked', 'request');
  recoveryContext.localStorage.setItem('healthySyncLastError', '服务端未返回有效的数据版本摘要');
  vm.runInContext("_syncBlocked = 'request'", recoveryContext, { timeout: 5000 });
  await vm.runInContext('ensureAwsSyncConfig()', recoveryContext, { timeout: 5000 });
  assert.strictEqual(recoveryContext.localStorage.getItem('healthySyncBlocked'), 'request', 'a later protocol error must remain fail-closed');
  assert.strictEqual(recoveryContext.localStorage.getItem('healthySyncLastError'), '服务端未返回有效的数据版本摘要', 'a later protocol error must not be cleared');
}

function verifyServiceWorkerPrivacyRouting(swSource) {
  const listeners = {};
  const context = {
    URL,
    Response,
    location: { origin: 'https://health.gaindar.com' },
    fetch: async () => new Response('ok', { status: 200 }),
    caches: {
      open: async () => ({ addAll: async () => {}, put: async () => {} }),
      keys: async () => [],
      delete: async () => true,
      match: async () => undefined
    },
    self: {
      addEventListener: (name, listener) => { listeners[name] = listener; },
      skipWaiting: async () => {},
      clients: { claim: async () => {} }
    }
  };
  vm.createContext(context);
  vm.runInContext(swSource, context, { timeout: 5000 });
  assert.strictEqual(typeof listeners.fetch, 'function', 'service worker fetch handler missing');

  function isIntercepted(pathname, { authorization = false, mode = 'cors' } = {}) {
    let response = null;
    listeners.fetch({
      request: {
        method: 'GET',
        url: `https://health.gaindar.com${pathname}`,
        mode,
        headers: { has: name => authorization && name.toLowerCase() === 'authorization' }
      },
      respondWith: value => { response = value; }
    });
    return response !== null;
  }

  assert.strictEqual(isIntercepted('/api/snapshot'), false, 'private snapshot API must bypass Service Worker');
  assert.strictEqual(isIntercepted('/api/health'), false, 'all API routes must bypass Service Worker');
  assert.strictEqual(isIntercepted('/plan.js?v=1.2.1'), true, 'versioned plan asset should be cached');
  assert.strictEqual(isIntercepted('/private-export.json'), false, 'arbitrary same-origin GET must not be cached');
  assert.strictEqual(isIntercepted('/index.html', { authorization: true }), false, 'authorized GET must never be cached');
  assert.strictEqual(isIntercepted('/week/20', { mode: 'navigate' }), true, 'navigation should retain offline fallback');
}

function appWeekFor(dateText) {
  const [y, m, d] = dateText.split('-').map(Number);
  const start = Date.UTC(2026, 4, 11);
  const target = Date.UTC(y, m - 1, d);
  return 3 + Math.floor((target - start) / (7 * 86400000));
}

const currentSource = fs.readFileSync(planPath, 'utf8');
const current = loadPlan(currentSource);

// 1) 旧计划完整周对象与固定发布基线逐字节兼容（包括所有元数据和动作字段）。
assert.strictEqual(Object.keys(LEGACY_WEEK_SHA256).length, 16);
const legacyWeeks = current.WEEKS.filter(week => week.weekNum >= 3 && week.weekNum <= 18);
assert.strictEqual(legacyWeeks.length, 16, 'historical Week 3-18 count drift');
assert.strictEqual(new Set(legacyWeeks.map(week => week.weekNum)).size, 16, 'duplicate historical week number');
for (let weekNum = 3; weekNum <= 18; weekNum++) {
  const after = current.WEEKS.find(week => week.weekNum === weekNum);
  assert(after, `missing historical Week ${weekNum}`);
  assert.strictEqual(
    sha256Json(after),
    LEGACY_WEEK_SHA256[weekNum],
    `Week ${weekNum} complete object drift from f1a5d12 baseline`
  );
}

// 2) 日期映射和正式周期边界。
assert.strictEqual(appWeekFor('2026-08-26'), 18);
assert.strictEqual(appWeekFor('2026-09-03'), 19);
assert.strictEqual(appWeekFor('2026-09-07'), 20);
assert.strictEqual(appWeekFor('2026-11-29'), 31);
assert.strictEqual(current.v4Meta.version, '4.0');
assert.strictEqual(current.v4Meta.appStartWeek, 20);
assert.strictEqual(current.v4Meta.appEndWeek, 31);
assert.strictEqual(current.PLAN_DATA.startDate, '2026-05-11');

// 3) V4 同一动作跨周使用稳定 movementId，正式完成率固定为 4/4/2/4/4。
const v4Weeks = current.WEEKS.filter(week => week.weekNum >= 20 && week.weekNum <= 31);
assert.strictEqual(v4Weeks.length, 12);
const movementNameById = new Map();
for (const week of v4Weeks) {
  assert.strictEqual(week.cycleWeek, week.weekNum - 19);
  const dailySlots = week.days.slice(0, 5).map(day => (day.groups || [])
    .flatMap(group => group.exercises || [])
    .filter(ex => ex.countsTowardProgress !== false).length);
  assert.strictEqual(JSON.stringify(dailySlots), JSON.stringify([4, 4, 2, 4, 4]), `Week ${week.weekNum} progress slots`);
  for (const ex of allWeekExercises([week])) {
    assert(ex.movementId, `Week ${week.weekNum} ${ex.name} missing movementId`);
    if (movementNameById.has(ex.movementId)) {
      assert.strictEqual(movementNameById.get(ex.movementId), ex.name, `${ex.movementId} maps to multiple names`);
    } else {
      movementNameById.set(ex.movementId, ex.name);
    }
  }
}

// 4) 每个 V4 动作均有明确 Bilibili 搜索映射，而不只依赖未知动作兜底。
const v4Names = [...new Set(allWeekExercises(v4Weeks).map(ex => ex.name))];
for (const name of v4Names) {
  assert(current.VIDEO_MAP[name], `${name} missing explicit VIDEO_MAP entry`);
  const video = current.getVideoForExercise(name);
  assert(video && (video.q || video.bv), `${name} has no video target`);
}

// 5) 验证历史索引和 index.html 中实际发布的 workout movementId 回填函数。
async function runHistoryAndStaticChecks() {
const exerciseNameByPositionId = new Map();
for (const ex of allWeekExercises(current.WEEKS)) exerciseNameByPositionId.set(ex.id, ex.name);
for (const ex of current.PLAN_DATA.warmupTemplate.exercises) exerciseNameByPositionId.set(ex.id, ex.name);
for (const ex of current.PLAN_DATA.morningTemplate.exercises) exerciseNameByPositionId.set(ex.id, ex.name);

const historicalCanonicalNames = [
  '引体向上', '坐姿绳索划船', '哑铃侧平举', '杠铃深蹲',
  '保加利亚分腿蹲', '罗马尼亚硬拉', '杠铃臀推'
];
let snapshot;
let historyFixtureLabel;
const usePrivateSnapshot = process.env.HEALTHY_TEST_NO_PRIVATE_SNAPSHOT !== '1' && fs.existsSync(snapshotPath);
if (usePrivateSnapshot) {
  snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  historyFixtureLabel = 'private sanitized snapshot';
} else {
  const baselineExercises = allWeekExercises(legacyWeeks);
  const representatives = historicalCanonicalNames.map(name => {
    const aliases = aliasesFor(name, current.EXERCISE_NAME_ALIASES);
    const match = baselineExercises.find(ex => aliases.has(ex.name));
    assert(match, `baseline fixture missing ${name}`);
    return match;
  });
  snapshot = {
    exerciseNotes: representatives.map((ex, i) => ({ id: i + 1, exerciseId: ex.id, exerciseKey: ex.name })),
    workoutLogs: [
      ...representatives.map((ex, i) => ({ id: i + 1, exerciseId: ex.id, completed: true })),
      { id: 1001, exerciseId: 'legacy-unmappable-id', completed: true },
      { id: 1002, exerciseId: representatives[0].id, movementId: 'preexisting-movement-id', completed: true }
    ]
  };
  historyFixtureLabel = 'synthetic clean-checkout fixture';
}

function noteCount(name) {
  const aliases = aliasesFor(name, current.EXERCISE_NAME_ALIASES);
  return snapshot.exerciseNotes.filter(note => {
    if (note.exerciseKey && aliases.has(note.exerciseKey)) return true;
    return note.exerciseId && aliases.has(exerciseNameByPositionId.get(note.exerciseId));
  }).length;
}

if (usePrivateSnapshot) {
  const expectedHistory = {
    '引体向上': 6,
    '坐姿绳索划船': 11,
    '哑铃侧平举': 9,
    '杠铃深蹲': 8,
    '保加利亚分腿蹲': 13,
    '罗马尼亚硬拉': 14,
    '杠铃臀推': 7,
    '杠铃卧推': 0,
    '坐姿腿弯举': 0,
    '站姿提踵': 0,
    '器械推胸（平推）': 9,
    '器械上斜推胸': 11
  };
  for (const [name, count] of Object.entries(expectedHistory)) {
    assert.strictEqual(noteCount(name), count, `${name} history count`);
  }
}
assert(!aliasesFor('器械推胸（平推）', current.EXERCISE_NAME_ALIASES).has('器械上斜推胸'), 'flat/incline press histories must stay separate');

const v4ExerciseByName = new Map(allWeekExercises(v4Weeks).map(ex => [ex.name, ex]));
const mappableHistoricalLogs = snapshot.workoutLogs.map(log => {
  if (log.movementId) return null;
  const historicalName = exerciseNameByPositionId.get(log.exerciseId);
  if (!historicalName) return null;
  const aliases = aliasesFor(historicalName, current.EXERCISE_NAME_ALIASES);
  return [...v4ExerciseByName.values()].find(ex => aliases.has(ex.name))?.movementId || null;
}).filter(Boolean);
assert(mappableHistoricalLogs.length > 0, 'no historical workout logs map to stable V4 movement IDs');
assert(mappableHistoricalLogs.every(id => movementNameById.has(id)), 'historical workout log maps to unknown movementId');

const index = fs.readFileSync(indexPath, 'utf8');
const migration = await executeProductionWorkoutBackfill(index, current, snapshot.workoutLogs);
const expectedBackfillCount = usePrivateSnapshot ? 99 : historicalCanonicalNames.length;
assert.strictEqual(mappableHistoricalLogs.length, expectedBackfillCount, `${historyFixtureLabel} expected mappable count`);
assert.strictEqual(migration.firstFilled, expectedBackfillCount, `${historyFixtureLabel} production backfill count`);
const migratedCount = migration.records.filter(record => record.movementId && record.movementId !== 'preexisting-movement-id').length;
assert.strictEqual(migratedCount, expectedBackfillCount, `${historyFixtureLabel} persisted movementId count`);
if (!usePrivateSnapshot) {
  const untouched = migration.records.find(record => record.id === 1001);
  const preexisting = migration.records.find(record => record.id === 1002);
  assert(untouched && !untouched.movementId, 'unmappable synthetic log must remain untouched');
  assert.strictEqual(preexisting?.movementId, 'preexisting-movement-id', 'existing movementId must not be overwritten');
}

// 6) 版本、缓存与同步安全配置静态门禁。
const sw = fs.readFileSync(swPath, 'utf8');
assert(index.includes("const APP_VERSION = '1.2.1'"));
assert(index.includes('plan.js?v=1.2.1'));
assert(!index.includes("appVersion: '1.1.0'"));
assert(index.includes("const DEFAULT_SYNC_URL = '/api/sync'"));
assert(index.includes("new Set(['startDate', 'aiProvider', 'aiModel'])"));
assert(!/SYNC_SAFE_SETTING_KEYS[^\n]*(?:apiKey|syncSecret|syncUrl)/i.test(index));
assert(index.includes("receipt.ok !== true"));
assert(index.includes('AbortController'));
assert(index.includes("headers['If-Match'] = etag"));
assert(index.includes('fetchCloudSnapshot'));
assert(index.includes('canonicalSyncVersion'));
assert(index.includes("[412, 428].includes(status)"));
assert(index.includes('scheduleSyncRetry'));
assert(index.includes('downloadCloudConflictSnapshot'));
assert(index.indexOf('preparedRevision = _syncRevision') < index.indexOf('preparedPayload = await assembleSyncPayload()'));
assert(index.includes('validateSyncReceipt(receipt, responseEtag, requestSha256, requestPayload)'));
assert(index.includes('receipt.requestSha256.toLowerCase() !== requestSha256'));
assert(index.includes('receipt.strippedSettings.length !== 0'));
assert(index.includes('receipt.counts[field] !== expectedCounts[field]'));
assert(index.includes("localStorage.removeItem('noteBackup')"));
assert(index.includes("result = await syncToCloud({ silent: false })"));
assert(index.includes("window.addEventListener('storage'"));
assert(sw.includes("const CACHE_NAME = 'healthy-v7'"));
assert(sw.includes("'./plan.js?v=1.2.1'"));
assert(sw.includes("url.pathname.startsWith('/api/')"));
assert(sw.includes("e.request.headers.has('Authorization')"));
assert(sw.indexOf("url.pathname.startsWith('/api/')") < sw.indexOf('e.respondWith('));
verifyProductionSyncReceiptChecks(index);
verifyServiceWorkerPrivacyRouting(sw);
await verifyProductionSyncDirtyTokenConcurrency(index);
await verifyLostReceiptUpgradeRecovery(index);
await verifyLegacySettingsMigrationOrder(index);

console.log(`PASS: V4 ${v4Weeks.length} weeks, ${v4Names.length} unique exercise names, ${migration.firstFilled} historical logs backfilled by production code (${historyFixtureLabel}), full legacy objects/history/video/version/sync guards verified.`);
}

runHistoryAndStaticChecks().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
