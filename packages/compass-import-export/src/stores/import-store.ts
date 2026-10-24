import type AppRegistry from '@mongodb-js/compass-app-registry';
import type { Action, AnyAction } from 'redux';
import { createStore, applyMiddleware, combineReducers } from 'redux';
import type { ThunkAction } from 'redux-thunk';
import thunk from 'redux-thunk';
import {
  cancelImport,
  importReducer,
  openImport,
  connectionDisconnected,
} from '../modules/import';
import {
  cancelImportCollections,
  closeImportCollections,
  connectionDisconnected as importCollectionsConnectionDisconnected,
  importCollectionsReducer,
  openImportCollections,
} from '../modules/import-collections';
import type { ImportCollectionsOrigin } from '../modules/import-collections';
import type { WorkspacesService } from '@mongodb-js/compass-workspaces/provider';
import type { Logger } from '@mongodb-js/compass-logging/provider';
import type { ConnectionsService } from '@mongodb-js/compass-connections/provider';
import type { ActivateHelpers } from '@mongodb-js/compass-app-registry';
import type { TrackFunction } from '@mongodb-js/compass-telemetry';

export type ImportPluginServices = {
  globalAppRegistry: AppRegistry;
  workspaces: WorkspacesService;
  logger: Logger;
  track: TrackFunction;
  connections: ConnectionsService;
};

export function configureStore(services: ImportPluginServices) {
  return createStore(
    combineReducers({
      import: importReducer,
      importCollections: importCollectionsReducer,
    }),
    applyMiddleware(thunk.withExtraArgument(services))
  );
}

export type RootImportState = ReturnType<
  ReturnType<typeof configureStore>['getState']
>;

export type ImportThunkAction<R, A extends Action = AnyAction> = ThunkAction<
  R,
  RootImportState,
  ImportPluginServices,
  A
>;

type OpenImportEvent = {
  namespace: string;
  origin: 'menu' | 'crud-toolbar' | 'empty-state';
};

type ConnectionMeta = {
  connectionId?: string;
};

export function activatePlugin(
  _: unknown,
  {
    globalAppRegistry,
    connections,
    workspaces,
    logger,
    track,
  }: ImportPluginServices,
  { on, cleanup, addCleanup }: ActivateHelpers
) {
  const store = configureStore({
    globalAppRegistry,
    workspaces,
    logger,
    track,
    connections,
  });

  addCleanup(() => {
    store.dispatch(cancelImport());
    store.dispatch(cancelImportCollections());
    store.dispatch(closeImportCollections());
  });

  on(
    globalAppRegistry,
    'open-import',
    function onOpenImport(
      { namespace, origin }: OpenImportEvent,
      { connectionId }: ConnectionMeta = {}
    ) {
      if (!connectionId) {
        throw new Error('Cannot open Import modal without a connectionId');
      }

      store.dispatch(openImport({ namespace, origin, connectionId }));
    }
  );

  on(
    globalAppRegistry,
    'open-import-collections',
    function onOpenImportCollections(
      {
        databaseName,
        origin,
      }: { databaseName: string; origin: ImportCollectionsOrigin },
      { connectionId }: ConnectionMeta = {}
    ) {
      if (!connectionId) {
        throw new Error(
          'Cannot open Import collections modal without a connectionId'
        );
      }

      store.dispatch(
        openImportCollections({ connectionId, databaseName, origin })
      );
    }
  );

  on(connections, 'disconnected', function (connectionId: string) {
    store.dispatch(connectionDisconnected(connectionId));
    store.dispatch(importCollectionsConnectionDisconnected(connectionId));
  });

  return {
    store,
    deactivate: cleanup,
  };
}

export type ImportStore = ReturnType<typeof configureStore>;
