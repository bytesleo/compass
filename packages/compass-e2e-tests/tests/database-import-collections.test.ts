import { promises as fs } from 'fs';
import path from 'path';
import { expect } from 'chai';
import { EJSON } from 'bson';
import { MongoClient } from 'mongodb';
import type { CompassBrowser } from '../helpers/compass-browser.ts';
import {
  deleteCommonVariedProperties,
  startTelemetryServer,
} from '../helpers/telemetry.ts';
import type { Telemetry } from '../helpers/telemetry.ts';
import {
  init,
  cleanup,
  screenshotIfFailed,
  outputFilename,
  skipForWeb,
  TEST_COMPASS_WEB,
  getDefaultConnectionNames,
} from '../helpers/compass.ts';
import type { Compass } from '../helpers/compass.ts';
import * as Selectors from '../helpers/selectors.ts';
import { createNumbersCollection } from '../helpers/mongo-clients.ts';
import { getDefaultConnectionStrings } from '../helpers/test-runner-context.ts';

/**
 * Dispatches the DOM event the import collections modal listens to instead of
 * opening the native folder picker, which webdriver can't drive.
 */
async function selectImportCollectionsDirectory(
  browser: CompassBrowser,
  directoryPath: string
) {
  await browser.execute(function (p) {
    // eslint-disable-next-line no-restricted-globals
    document.dispatchEvent(
      new CustomEvent('selectImportCollectionsDirectory', { detail: p })
    );
  }, directoryPath);
}

async function writeExportedCollection(
  directoryPath: string,
  collectionName: string,
  docs: unknown[],
  metadata?: Record<string, unknown>
) {
  await fs.writeFile(
    path.join(directoryPath, `${collectionName}.json`),
    EJSON.stringify(docs)
  );
  if (metadata) {
    await fs.writeFile(
      path.join(directoryPath, `${collectionName}.metadata.json`),
      EJSON.stringify({ collectionName, type: 'collection', ...metadata })
    );
  }
}

describe('Database import collections', function () {
  let compass: Compass;
  let browser: CompassBrowser;
  let telemetry: Telemetry;
  let directoryPath: string;

  before(async function () {
    skipForWeb(this, 'import not available in compass-web');

    telemetry = await startTelemetryServer();
    compass = await init(this.test?.fullTitle());
    browser = compass.browser;
    await browser.setupDefaultConnections();
    await browser.setFeature('enableMultipleCollectionsImportExport', true);
  });

  after(async function () {
    if (TEST_COMPASS_WEB) {
      return;
    }

    await cleanup(compass);
    await telemetry.stop();
  });

  afterEach(async function () {
    await screenshotIfFailed(compass, this.currentTest);
  });

  beforeEach(async function () {
    directoryPath = outputFilename(`import-collections-${Date.now()}`);
    await fs.mkdir(directoryPath, { recursive: true });

    await writeExportedCollection(
      directoryPath,
      'imported-orders',
      [
        { sku: 'A', qty: 1 },
        { sku: 'B', qty: 2 },
        { sku: 'C', qty: 3 },
      ],
      {
        options: {},
        indexes: [
          { v: 2, key: { _id: 1 }, name: '_id_' },
          { v: 2, key: { sku: 1 }, name: 'sku_1', unique: true },
        ],
      }
    );
    await writeExportedCollection(
      directoryPath,
      'imported-logs',
      [{ level: 'info' }, { level: 'warn' }],
      { options: { capped: true, size: 4096, max: 10 }, indexes: [] }
    );
    // Already exists in the database, and is skipped below.
    await writeExportedCollection(directoryPath, 'numbers', [{ i: -1 }]);

    await createNumbersCollection('numbers', 10);
    await browser.disconnectAll();
    await browser.connectToDefaults();
    await browser.navigateToDatabaseCollectionsTab(
      getDefaultConnectionNames(0),
      'test'
    );
  });

  it('imports a folder of exported collections into a database', async function () {
    const telemetryEntry = await browser.listenForTelemetryEvents(telemetry);

    await browser.clickVisible(Selectors.CollectionsDataActionsButton);
    await browser.clickVisible(Selectors.CollectionsDataActionsImport);
    await browser.waitForOpenModal(Selectors.ImportCollectionsModal);

    await selectImportCollectionsDirectory(browser, directoryPath);
    for (const fileName of [
      'imported-logs.json',
      'imported-orders.json',
      'numbers.json',
    ]) {
      await browser.$(Selectors.importCollectionsFile(fileName)).waitForExist();
    }

    // `numbers` already exists: skip it instead of adding the document.
    await browser.clickParent(Selectors.importCollectionsExistingMode('skip'));
    expect(
      await browser.$(Selectors.ImportCollectionsImportButton).getText()
    ).to.equal('Import 3 files');
    await browser.clickVisible(Selectors.ImportCollectionsImportButton);

    await browser.waitForOpenModal(Selectors.ImportCollectionsModal, {
      reverse: true,
    });
    const toast = browser.$(Selectors.ImportCollectionsToast);
    await toast.waitForDisplayed();
    await browser.waitUntil(async () => {
      return (
        (await toast.$(Selectors.LGToastTitle).getText()) ===
        'Import completed.'
      );
    });

    const mongoClient = new MongoClient(getDefaultConnectionStrings(0));
    try {
      const db = mongoClient.db('test');

      const orders = db.collection('imported-orders');
      expect(await orders.countDocuments()).to.equal(3);
      const skuIndex = (await orders.indexes()).find(
        (index) => index.name === 'sku_1'
      );
      expect(skuIndex?.unique).to.equal(true);

      const [logs] = await db
        .listCollections({ name: 'imported-logs' }, { nameOnly: false })
        .toArray();
      expect(logs.options).to.include({ capped: true, size: 4096, max: 10 });
      expect(await db.collection('imported-logs').countDocuments()).to.equal(2);

      // Skipped, so the document from the file was not added.
      expect(await db.collection('numbers').countDocuments()).to.equal(10);
    } finally {
      await mongoClient.close();
    }

    // The new collections show up without a manual refresh.
    await browser
      .$(Selectors.collectionRow('test', 'imported-orders'))
      .waitForDisplayed();

    const openedEvent = await telemetryEntry('Import Collections Opened');
    deleteCommonVariedProperties(openedEvent);
    expect(openedEvent).to.deep.equal({ origin: 'collections-list' });

    const completedEvent = await telemetryEntry('Import Collections Completed');
    delete completedEvent.duration; // Duration varies.
    deleteCommonVariedProperties(completedEvent);
    expect(completedEvent).to.deep.equal({
      json_file_count: 3,
      csv_file_count: 0,
      existing_collection_mode: 'skip',
      apply_metadata: true,
      failed_count: 0,
      skipped_count: 1,
      number_of_docs: 5,
      number_of_errors: 0,
      success: true,
      stopped: false,
    });
  });
});
