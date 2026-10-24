import { expect } from 'chai';
import type { AnyAction } from 'redux';

import {
  ImportCollectionsActionTypes,
  closeImportCollections,
  getCollectionNameError,
  importCollectionsReducer,
  initialState,
  setTargetCollectionName,
  toggleAllImportFiles,
  toggleImportFile,
} from './import-collections';
import type { ImportCollectionsState } from './import-collections';

const files = [
  {
    fileName: 'customers.json',
    filePath: '/tmp/export/customers.json',
    fileType: 'json' as const,
    collectionName: 'customers',
    metadataPath: '/tmp/export/customers.metadata.json',
  },
  {
    fileName: 'orders.csv',
    filePath: '/tmp/export/orders.csv',
    fileType: 'csv' as const,
    collectionName: 'orders',
    metadataPath: undefined,
  },
];

function openState(): ImportCollectionsState {
  return importCollectionsReducer(initialState, {
    type: ImportCollectionsActionTypes.Open,
    connectionId: 'connection-1',
    databaseName: 'store',
  } as AnyAction);
}

function loadedState(): ImportCollectionsState {
  const loading = importCollectionsReducer(openState(), {
    type: ImportCollectionsActionTypes.LoadFiles,
    directoryPath: '/tmp/export',
  } as AnyAction);
  return importCollectionsReducer(loading, {
    type: ImportCollectionsActionTypes.LoadFilesSuccess,
    directoryPath: '/tmp/export',
    files,
    existingCollectionNames: ['orders'],
  } as AnyAction);
}

describe('importCollectionsReducer', function () {
  it('opens asking for a folder', function () {
    const state = openState();
    expect(state.isOpen).to.equal(true);
    expect(state.databaseName).to.equal('store');
    expect(state.status).to.equal('select-folder');
  });

  it('selects every file with its suggested collection once loaded', function () {
    const state = loadedState();
    expect(state.status).to.equal('ready');
    expect(state.existingCollectionNames).to.deep.equal(['orders']);
    expect(
      state.files.map(({ selected, targetCollectionName }) => ({
        selected,
        targetCollectionName,
      }))
    ).to.deep.equal([
      { selected: true, targetCollectionName: 'customers' },
      { selected: true, targetCollectionName: 'orders' },
    ]);
  });

  it('ignores files loaded for a folder that is no longer selected', function () {
    let state = importCollectionsReducer(openState(), {
      type: ImportCollectionsActionTypes.LoadFiles,
      directoryPath: '/tmp/second',
    } as AnyAction);
    state = importCollectionsReducer(state, {
      type: ImportCollectionsActionTypes.LoadFilesSuccess,
      directoryPath: '/tmp/first',
      files,
      existingCollectionNames: [],
    } as AnyAction);
    expect(state.status).to.equal('loading-files');
    expect(state.files).to.deep.equal([]);
  });

  it('toggles one file and all files', function () {
    let state = importCollectionsReducer(
      loadedState(),
      toggleImportFile('orders.csv')
    );
    expect(state.files.map((f) => f.selected)).to.deep.equal([true, false]);
    state = importCollectionsReducer(state, toggleAllImportFiles());
    expect(state.files.map((f) => f.selected)).to.deep.equal([true, true]);
    state = importCollectionsReducer(state, toggleAllImportFiles());
    expect(state.files.map((f) => f.selected)).to.deep.equal([false, false]);
  });

  it('renames the target collection of a file', function () {
    const state = importCollectionsReducer(
      loadedState(),
      setTargetCollectionName('orders.csv', 'orders_2026')
    );
    expect(state.files[1].targetCollectionName).to.equal('orders_2026');
    expect(state.files[1].collectionName).to.equal('orders');
  });

  it('hides the modal but keeps the state while an import runs', function () {
    const abortController = new AbortController();
    let state = importCollectionsReducer(loadedState(), {
      type: ImportCollectionsActionTypes.RunImport,
      importAbortController: abortController,
    } as AnyAction);
    expect(state.isOpen).to.equal(false);
    expect(state.status).to.equal('in-progress');

    state = importCollectionsReducer(state, closeImportCollections());
    expect(state.importAbortController).to.equal(abortController);

    state = importCollectionsReducer(state, {
      type: ImportCollectionsActionTypes.ImportFinished,
    } as AnyAction);
    expect(state).to.deep.equal(initialState);
  });
});

describe('getCollectionNameError', function () {
  it('accepts a valid name', function () {
    expect(getCollectionNameError('orders 2026', ['orders 2026'])).to.equal(
      undefined
    );
  });

  it('rejects empty, invalid and system names', function () {
    expect(getCollectionNameError('', [])).to.be.a('string');
    expect(getCollectionNameError('a$b', [])).to.be.a('string');
    expect(getCollectionNameError('system.views', [])).to.be.a('string');
  });

  it('rejects two files imported into the same collection', function () {
    expect(getCollectionNameError('orders', ['orders', 'orders'])).to.be.a(
      'string'
    );
  });
});
