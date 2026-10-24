import type AppRegistry from '@mongodb-js/compass-app-registry';
import { expect } from 'chai';
import {
  createPluginTestHelpers,
  cleanup,
} from '@mongodb-js/testing-library-compass';
import type { ImportStore } from './import-store';
import { ImportPlugin } from '..';

const { activatePluginWithConnections } = createPluginTestHelpers(ImportPlugin);

describe('ImportStore [Store]', function () {
  let store: ImportStore;
  let globalAppRegistry: AppRegistry;

  beforeEach(function () {
    const result = activatePluginWithConnections();
    globalAppRegistry = result.globalAppRegistry;
    store = result.plugin.store;
  });

  afterEach(function () {
    cleanup();
  });

  it(`throws when 'open-import' is emitted without connection metadata`, function () {
    expect(() => {
      globalAppRegistry.emit('open-import', {
        namespace: 'test.coll',
        origin: 'menu',
      });
    }).to.throw();
  });

  it('opens the import modal with properly set state', function () {
    globalAppRegistry.emit(
      'open-import',
      { namespace: 'test.coll', origin: 'menu' },
      { connectionId: 'TEST' }
    );
    expect(store.getState().import.connectionId).to.equal('TEST');
    expect(store.getState().import.namespace).to.equal('test.coll');
  });

  it(`throws when 'open-import-collections' is emitted without connection metadata`, function () {
    expect(() => {
      globalAppRegistry.emit('open-import-collections', {
        databaseName: 'store',
        origin: 'sidebar',
      });
    }).to.throw();
  });

  it('opens the import collections modal for the database', function () {
    globalAppRegistry.emit(
      'open-import-collections',
      { databaseName: 'store', origin: 'collections-list' },
      { connectionId: 'TEST' }
    );
    const state = store.getState().importCollections;
    expect(state.isOpen).to.equal(true);
    expect(state.connectionId).to.equal('TEST');
    expect(state.databaseName).to.equal('store');
    expect(state.status).to.equal('select-folder');
  });
});
