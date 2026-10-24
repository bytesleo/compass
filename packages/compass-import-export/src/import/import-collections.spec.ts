import os from 'os';
import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { Decimal128, Long } from 'bson';
import { connect } from 'mongodb-data-service';
import type { DataService } from 'mongodb-data-service';
import { mochaTestServer } from '@mongodb-js/compass-test-server';

import { exportCollectionsToDirectory } from '../export/export-collections';
import {
  fileNameToCollectionName,
  importCollectionsFromDirectory,
  listImportableFiles,
} from './import-collections';

const sourceDB = 'import-collections-source';
const targetDB = 'import-collections-target';

describe('importCollectionsFromDirectory', function () {
  const cluster = mochaTestServer();
  let dataService: DataService;
  let tmpdir: string;

  async function exportSource(fileType: 'json' | 'csv') {
    await exportCollectionsToDirectory({
      databaseName: sourceDB,
      collectionNames: ['customers', 'products'],
      directoryPath: tmpdir,
      dataService,
      fileType,
      variant: 'canonical',
      includeMetadata: true,
    });
  }

  async function importAll(
    options: Partial<Parameters<typeof importCollectionsFromDirectory>[0]> = {}
  ) {
    return await importCollectionsFromDirectory({
      databaseName: targetDB,
      files: await listImportableFiles(tmpdir),
      dataService,
      existingCollectionMode: 'append',
      applyMetadata: true,
      ...options,
    });
  }

  beforeEach(async function () {
    tmpdir = path.join(
      os.tmpdir(),
      'compass-import-collections-test',
      `test-${Date.now()}`
    );
    await fs.promises.mkdir(tmpdir, { recursive: true });

    dataService = await connect({
      connectionOptions: {
        connectionString: cluster().connectionString,
      },
    });

    for (const db of [sourceDB, targetDB]) {
      try {
        await dataService.dropDatabase(db);
      } catch {
        // ignore
      }
    }

    await dataService.createCollection(`${sourceDB}.customers`, {
      validator: { $jsonSchema: { required: ['email'] } },
    });
    await dataService.insertMany(`${sourceDB}.customers`, [
      { email: 'a@example.com' },
      { email: 'b@example.com' },
    ]);
    await dataService.createIndex(
      `${sourceDB}.customers`,
      { email: 1 },
      { unique: true }
    );
    await dataService.insertMany(`${sourceDB}.products`, [
      {
        sku: 'A',
        price: Decimal128.fromString('9.99'),
        stock: Long.fromInt(3),
      },
    ]);
  });

  afterEach(async function () {
    await fs.promises.rm(tmpdir, { recursive: true, force: true });
    await dataService.disconnect();
  });

  it('lists data files with their metadata files', async function () {
    await exportSource('json');
    await fs.promises.writeFile(path.join(tmpdir, 'notes.txt'), 'ignored');

    const files = await listImportableFiles(tmpdir);
    expect(
      files.map(({ fileName, fileType, collectionName, metadataPath }) => ({
        fileName,
        fileType,
        collectionName,
        hasMetadata: !!metadataPath,
      }))
    ).to.deep.equal([
      {
        fileName: 'customers.json',
        fileType: 'json',
        collectionName: 'customers',
        hasMetadata: true,
      },
      {
        fileName: 'products.json',
        fileType: 'json',
        collectionName: 'products',
        hasMetadata: true,
      },
    ]);
  });

  it('round-trips an exported JSON folder with options and indexes', async function () {
    await exportSource('json');

    const result = await importAll();

    expect(result.aborted).to.equal(false);
    expect(
      result.collections.map(({ collectionName, status, docsWritten }) => ({
        collectionName,
        status,
        docsWritten,
      }))
    ).to.deep.equal([
      { collectionName: 'customers', status: 'imported', docsWritten: 2 },
      { collectionName: 'products', status: 'imported', docsWritten: 1 },
    ]);

    const [product] = await dataService.find(`${targetDB}.products`, {});
    expect(product.price).to.be.instanceOf(Decimal128);
    expect(product.stock.toString()).to.equal('3');

    const info = await dataService.collectionInfo(targetDB, 'customers');
    expect(info?.validation?.validator).to.deep.equal({
      $jsonSchema: { required: ['email'] },
    });
    const indexes = await dataService.indexes(`${targetDB}.customers`);
    const emailIndex = indexes.find((index) => index.name === 'email_1');
    expect(emailIndex?.extra.unique).to.equal(true);
  });

  it('imports an exported CSV folder using the detected types', async function () {
    await exportSource('csv');

    const result = await importAll();

    expect(result.collections.map((c) => c.docsWritten)).to.deep.equal([2, 1]);
    const customers = await dataService.find(`${targetDB}.customers`, {});
    expect(customers.map((doc) => doc.email).sort()).to.deep.equal([
      'a@example.com',
      'b@example.com',
    ]);
  });

  it('skips, appends to or replaces existing collections', async function () {
    await exportSource('json');
    await dataService.insertMany(`${targetDB}.products`, [{ sku: 'existing' }]);

    let result = await importAll({ existingCollectionMode: 'skip' });
    expect(result.collections.map((c) => c.status)).to.deep.equal([
      'imported',
      'skipped',
    ]);
    expect(await dataService.count(`${targetDB}.products`, {})).to.equal(1);

    await dataService.dropCollection(`${targetDB}.customers`);
    result = await importAll({ existingCollectionMode: 'append' });
    expect(await dataService.count(`${targetDB}.products`, {})).to.equal(2);

    await dataService.dropCollection(`${targetDB}.customers`);
    result = await importAll({ existingCollectionMode: 'replace' });
    expect(result.collections[1].created).to.equal(true);
    expect(await dataService.count(`${targetDB}.products`, {})).to.equal(1);
  });

  it('reports a failing file and continues with the rest', async function () {
    await exportSource('json');
    await fs.promises.writeFile(
      path.join(tmpdir, 'customers.json'),
      'not json at all'
    );

    const result = await importAll();

    expect(result.collections[0].status).to.equal('failed');
    expect(result.collections[0].error).to.be.instanceOf(Error);
    expect(result.collections[1].status).to.equal('imported');
  });

  it('stops before the next file when aborted', async function () {
    await exportSource('json');
    const abortController = new AbortController();

    const result = await importAll({
      abortSignal: abortController.signal,
      onCollectionStart: () => abortController.abort(),
    });

    expect(result.aborted).to.equal(true);
    expect(result.collections).to.have.lengthOf(1);
  });

  for (const fileType of ['json', 'csv'] as const) {
    it(`round-trips an empty collection exported as ${fileType}`, async function () {
      await dataService.createCollection(`${sourceDB}.empty`, {});
      await exportCollectionsToDirectory({
        databaseName: sourceDB,
        collectionNames: ['empty'],
        directoryPath: tmpdir,
        dataService,
        fileType,
        variant: 'default',
        includeMetadata: false,
      });

      const result = await importAll();

      expect(result.collections[0]).to.include({
        status: 'imported',
        created: true,
        docsWritten: 0,
      });
      expect(result.collections[0].error).to.equal(undefined);
    });
  }

  for (const fileType of ['json', 'csv'] as const) {
    it(`keeps multi-byte characters intact across read chunks (${fileType})`, async function () {
      // Longer than one 64 KiB read chunk, so some characters are split
      // between two chunks.
      const text = 'añ€😀'.repeat(20000);
      await dataService.insertOne(`${sourceDB}.unicode`, { text });
      await exportCollectionsToDirectory({
        databaseName: sourceDB,
        collectionNames: ['unicode'],
        directoryPath: tmpdir,
        dataService,
        fileType,
        variant: 'default',
        includeMetadata: false,
      });

      const result = await importAll();

      expect(result.collections[0].status).to.equal('imported');
      const [doc] = await dataService.find(`${targetDB}.unicode`, {});
      expect(doc.text).to.equal(text);
    });
  }

  it('recreates capped and time series collections', async function () {
    await dataService.createCollection(`${sourceDB}.logs`, {
      capped: true,
      size: 4096,
      max: 10,
    });
    await dataService.insertOne(`${sourceDB}.logs`, { level: 'info' });
    await dataService.createCollection(`${sourceDB}.metrics`, {
      timeseries: { timeField: 'at', metaField: 'sensor' },
    });
    await dataService.insertOne(`${sourceDB}.metrics`, {
      at: new Date('2026-01-01'),
      sensor: 'a',
      value: 1,
    });
    await exportCollectionsToDirectory({
      databaseName: sourceDB,
      collectionNames: ['logs', 'metrics'],
      directoryPath: tmpdir,
      dataService,
      fileType: 'json',
      variant: 'canonical',
      includeMetadata: true,
    });

    const result = await importAll();

    expect(result.collections.map((c) => c.status)).to.deep.equal([
      'imported',
      'imported',
    ]);
    expect(await dataService.collectionOptions(targetDB, 'logs')).to.include({
      capped: true,
      size: 4096,
      max: 10,
    });
    const metricsOptions = await dataService.collectionOptions(
      targetDB,
      'metrics'
    );
    expect(metricsOptions.timeseries).to.include({
      timeField: 'at',
      metaField: 'sensor',
    });
    expect(await dataService.count(`${targetDB}.metrics`, {})).to.equal(1);
  });

  it('round-trips collections whose names only differ by case', async function () {
    await dataService.insertOne(`${sourceDB}.Products`, { upper: true });
    await exportCollectionsToDirectory({
      databaseName: sourceDB,
      collectionNames: ['Products', 'products'],
      directoryPath: tmpdir,
      dataService,
      fileType: 'json',
      variant: 'default',
      includeMetadata: false,
    });

    const result = await importAll();

    expect(
      result.collections.map((c) => c.collectionName).sort()
    ).to.deep.equal(['Products', 'products']);
    const [upper] = await dataService.find(`${targetDB}.Products`, {});
    expect(upper.upper).to.equal(true);
  });

  it('keeps the document count when creating an index fails', async function () {
    await exportSource('json');
    const metadataPath = path.join(tmpdir, 'customers.metadata.json');
    const metadata = JSON.parse(
      await fs.promises.readFile(metadataPath, 'utf8')
    );
    metadata.indexes.push({ v: 2, key: { email: 'not-a-type' }, name: 'bad' });
    await fs.promises.writeFile(metadataPath, JSON.stringify(metadata));

    const result = await importAll();

    expect(result.collections[0]).to.include({
      status: 'imported',
      docsWritten: 2,
    });
    expect(result.collections[0].error?.message).to.include(
      'creating the indexes failed'
    );
  });

  it('keeps an existing collection when its metadata file is broken', async function () {
    await exportSource('json');
    await dataService.insertOne(`${targetDB}.customers`, { keep: true });
    await fs.promises.writeFile(
      path.join(tmpdir, 'customers.metadata.json'),
      '{ broken'
    );

    const result = await importAll({ existingCollectionMode: 'replace' });

    expect(result.collections[0].status).to.equal('failed');
    const docs = await dataService.find(`${targetDB}.customers`, {});
    expect(docs.map((doc) => doc.keep)).to.deep.equal([true]);
  });
});

describe('fileNameToCollectionName', function () {
  it('decodes percent-encoded characters', function () {
    expect(fileNameToCollectionName('a%3Ab%2Fc%3Fd%25e')).to.equal('a:b/c?d%e');
  });

  it('decodes the names the export uses to avoid clashes', function () {
    expect(fileNameToCollectionName('%63on')).to.equal('con');
    expect(fileNameToCollectionName('%6F%72%64%65%72%73')).to.equal('orders');
    expect(fileNameToCollectionName('orders%2Emetadata')).to.equal(
      'orders.metadata'
    );
  });
});
