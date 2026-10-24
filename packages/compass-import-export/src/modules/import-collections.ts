import type { Action, AnyAction, Reducer } from 'redux';
import _ from 'lodash';

import {
  importCollectionsFromDirectory,
  listImportableFiles,
} from '../import/import-collections';
import type {
  ExistingCollectionMode,
  ImportableFile,
  ImportCollectionsResult,
} from '../import/import-collections';
import {
  showImportCollectionsFailedToast,
  showImportCollectionsFinishedToast,
  showImportCollectionsInProgressToast,
} from '../components/import-collections-toast';
import type { ImportThunkAction } from '../stores/import-store';

export type ImportCollectionsFile = ImportableFile & {
  selected: boolean;
  targetCollectionName: string;
};

export type ImportCollectionsStatus =
  undefined | 'select-folder' | 'loading-files' | 'ready' | 'in-progress';

export type ImportCollectionsState = {
  isOpen: boolean;
  connectionId: string;
  databaseName: string;
  status: ImportCollectionsStatus;
  directoryPath: string;
  files: ImportCollectionsFile[];
  existingCollectionNames: string[];
  errorLoadingFiles: string | undefined;
  importAbortController: AbortController | undefined;
};

export const initialState: ImportCollectionsState = {
  isOpen: false,
  connectionId: '',
  databaseName: '',
  status: undefined,
  directoryPath: '',
  files: [],
  existingCollectionNames: [],
  errorLoadingFiles: undefined,
  importAbortController: undefined,
};

export const ImportCollectionsActionTypes = {
  Open: 'compass-import-export/import-collections/Open',
  Close: 'compass-import-export/import-collections/Close',
  LoadFiles: 'compass-import-export/import-collections/LoadFiles',
  LoadFilesSuccess: 'compass-import-export/import-collections/LoadFilesSuccess',
  LoadFilesError: 'compass-import-export/import-collections/LoadFilesError',
  ToggleFile: 'compass-import-export/import-collections/ToggleFile',
  ToggleAllFiles: 'compass-import-export/import-collections/ToggleAllFiles',
  SetTargetCollectionName:
    'compass-import-export/import-collections/SetTargetCollectionName',
  RunImport: 'compass-import-export/import-collections/RunImport',
  ImportFinished: 'compass-import-export/import-collections/ImportFinished',
} as const;

function isAction<A extends AnyAction>(
  action: AnyAction,
  type: A['type']
): action is A {
  return action.type === type;
}

type OpenAction = {
  type: typeof ImportCollectionsActionTypes.Open;
  connectionId: string;
  databaseName: string;
};

type CloseAction = {
  type: typeof ImportCollectionsActionTypes.Close;
};

type LoadFilesAction = {
  type: typeof ImportCollectionsActionTypes.LoadFiles;
  directoryPath: string;
};

type LoadFilesSuccessAction = {
  type: typeof ImportCollectionsActionTypes.LoadFilesSuccess;
  directoryPath: string;
  files: ImportableFile[];
  existingCollectionNames: string[];
};

type LoadFilesErrorAction = {
  type: typeof ImportCollectionsActionTypes.LoadFilesError;
  directoryPath: string;
  errorMessage: string;
};

type ToggleFileAction = {
  type: typeof ImportCollectionsActionTypes.ToggleFile;
  fileName: string;
};

type ToggleAllFilesAction = {
  type: typeof ImportCollectionsActionTypes.ToggleAllFiles;
};

type SetTargetCollectionNameAction = {
  type: typeof ImportCollectionsActionTypes.SetTargetCollectionName;
  fileName: string;
  collectionName: string;
};

type RunImportAction = {
  type: typeof ImportCollectionsActionTypes.RunImport;
  importAbortController: AbortController;
};

type ImportFinishedAction = {
  type: typeof ImportCollectionsActionTypes.ImportFinished;
};

/**
 * Returns why a target collection name can't be used, if it can't. Mirrors
 * the server rules that are easy to check up front.
 */
export function getCollectionNameError(
  collectionName: string,
  selectedNames: string[]
): string | undefined {
  if (!collectionName) {
    return 'Enter a collection name.';
  }
  if (collectionName.includes('$') || collectionName.includes('\0')) {
    return 'Collection names cannot contain "$" or null characters.';
  }
  if (collectionName.startsWith('system.')) {
    return 'Collection names cannot start with "system.".';
  }
  if (selectedNames.filter((name) => name === collectionName).length > 1) {
    return 'Another file is imported into this collection.';
  }
  return undefined;
}

export type ImportCollectionsOrigin = 'sidebar' | 'collections-list';

export const openImportCollections = ({
  connectionId,
  databaseName,
  origin,
}: {
  connectionId: string;
  databaseName: string;
  origin: ImportCollectionsOrigin;
}): ImportThunkAction<void> => {
  return (dispatch, getState, { connections, track }) => {
    if (getState().importCollections.status === 'in-progress') {
      return;
    }
    track(
      'Import Collections Opened',
      { origin },
      connections.getConnectionById(connectionId)?.info
    );
    dispatch({
      type: ImportCollectionsActionTypes.Open,
      connectionId,
      databaseName,
    });
  };
};

export const closeImportCollections = (): CloseAction => ({
  type: ImportCollectionsActionTypes.Close,
});

export const selectImportDirectory = (
  directoryPath: string
): ImportThunkAction<Promise<void>> => {
  return async (dispatch, getState, { connections }) => {
    const { connectionId, databaseName } = getState().importCollections;
    dispatch({ type: ImportCollectionsActionTypes.LoadFiles, directoryPath });

    try {
      const dataService = connections.getDataServiceForConnection(connectionId);
      const [files, collections] = await Promise.all([
        listImportableFiles(directoryPath),
        dataService.listCollections(databaseName),
      ]);
      dispatch({
        type: ImportCollectionsActionTypes.LoadFilesSuccess,
        directoryPath,
        files,
        existingCollectionNames: collections.map(
          (collection) => collection.name
        ),
      });
    } catch (err) {
      dispatch({
        type: ImportCollectionsActionTypes.LoadFilesError,
        directoryPath,
        errorMessage:
          (err as Error | undefined)?.message ?? 'Failed to read the folder.',
      });
    }
  };
};

export const toggleImportFile = (fileName: string): ToggleFileAction => ({
  type: ImportCollectionsActionTypes.ToggleFile,
  fileName,
});

export const toggleAllImportFiles = (): ToggleAllFilesAction => ({
  type: ImportCollectionsActionTypes.ToggleAllFiles,
});

export const setTargetCollectionName = (
  fileName: string,
  collectionName: string
): SetTargetCollectionNameAction => ({
  type: ImportCollectionsActionTypes.SetTargetCollectionName,
  fileName,
  collectionName,
});

export const cancelImportCollections = (): ImportThunkAction<void> => {
  return (_dispatch, getState) => {
    getState().importCollections.importAbortController?.abort();
  };
};

export const connectionDisconnected = (
  connectionId: string
): ImportThunkAction<void> => {
  return (dispatch, getState) => {
    if (getState().importCollections.connectionId === connectionId) {
      dispatch(cancelImportCollections());
      dispatch(closeImportCollections());
    }
  };
};

export const runImportCollections = ({
  existingCollectionMode,
  applyMetadata,
}: {
  existingCollectionMode: ExistingCollectionMode;
  applyMetadata: boolean;
}): ImportThunkAction<Promise<void>> => {
  return async (
    dispatch,
    getState,
    { connections, globalAppRegistry, track, logger: { log, mongoLogId } }
  ) => {
    const startTime = Date.now();
    let result: ImportCollectionsResult | undefined;
    const { connectionId, databaseName, directoryPath, files } =
      getState().importCollections;
    const selectedFiles = files
      .filter((file) => file.selected)
      .map((file) => ({ ...file, collectionName: file.targetCollectionName }));

    const importAbortController = new AbortController();
    dispatch({
      type: ImportCollectionsActionTypes.RunImport,
      importAbortController,
    });

    log.info(
      mongoLogId(1_001_000_448),
      'Import',
      'Start importing collections',
      {
        databaseName,
        directoryPath,
        fileCount: selectedFiles.length,
        existingCollectionMode,
        applyMetadata,
      }
    );

    let collectionIndex = 0;
    const cancelImport = () => dispatch(cancelImportCollections());
    const progressCallback = _.throttle(
      (collectionName: string, docsWritten: number) => {
        showImportCollectionsInProgressToast({
          databaseName,
          collectionName,
          collectionIndex,
          collectionCount: selectedFiles.length,
          docsWritten,
          cancelImport,
        });
      },
      1000
    );

    try {
      const dataService = connections.getDataServiceForConnection(connectionId);
      result = await importCollectionsFromDirectory({
        databaseName,
        files: selectedFiles,
        dataService,
        existingCollectionMode,
        applyMetadata,
        abortSignal: importAbortController.signal,
        onCollectionStart: (collectionName, index) => {
          collectionIndex = index;
          progressCallback(collectionName, 0);
          progressCallback.flush();
        },
        progressCallback: (collectionName, { docsWritten }) =>
          progressCallback(collectionName, docsWritten),
      });
      progressCallback.cancel();

      log.info(
        mongoLogId(1_001_000_449),
        'Import',
        'Finished importing collections',
        {
          databaseName,
          aborted: result.aborted,
          collections: result.collections.map(
            ({ collectionName, status, docsWritten, error }) => ({
              collectionName,
              status,
              docsWritten,
              error: error?.message,
            })
          ),
        }
      );

      // Let the sidebar and any open tabs pick up the new data.
      if (dataService.isConnected()) {
        for (const { collectionName, status, created } of result.collections) {
          if (status === 'skipped') {
            continue;
          }
          const ns = `${databaseName}.${collectionName}`;
          if (created) {
            globalAppRegistry.emit('collection-created', ns, { connectionId });
          } else {
            globalAppRegistry.emit('import-finished', { ns }, { connectionId });
          }
        }
      }

      showImportCollectionsFinishedToast({
        collections: result.collections,
        aborted: result.aborted,
      });
    } catch (err) {
      progressCallback.cancel();
      log.error(
        mongoLogId(1_001_000_450),
        'Import',
        'Importing collections failed',
        { databaseName, error: (err as Error | undefined)?.message }
      );
      showImportCollectionsFailedToast(err as Error | undefined);
    } finally {
      dispatch({ type: ImportCollectionsActionTypes.ImportFinished });
    }

    const collections = result?.collections ?? [];
    const failedCount = result
      ? collections.filter((collection) => collection.status === 'failed')
          .length
      : selectedFiles.length;
    // Also set when the documents were imported but the indexes weren't.
    const hasErrors = collections.some((collection) => collection.error);
    const numberOfErrors = collections.reduce(
      (total, collection) => total + collection.docsErrored,
      0
    );
    const stopped = !!(importAbortController.signal.aborted || result?.aborted);
    track(
      'Import Collections Completed',
      {
        json_file_count: selectedFiles.filter((f) => f.fileType === 'json')
          .length,
        csv_file_count: selectedFiles.filter((f) => f.fileType === 'csv')
          .length,
        existing_collection_mode: existingCollectionMode,
        apply_metadata: applyMetadata,
        failed_count: failedCount,
        skipped_count: collections.filter((c) => c.status === 'skipped').length,
        number_of_docs: collections.reduce(
          (total, collection) => total + collection.docsWritten,
          0
        ),
        number_of_errors: numberOfErrors,
        success: !!result && !hasErrors && numberOfErrors === 0 && !stopped,
        stopped,
        duration: Date.now() - startTime,
      },
      connections.getConnectionById(connectionId)?.info
    );
  };
};

function updateFile(
  state: ImportCollectionsState,
  fileName: string,
  update: (file: ImportCollectionsFile) => ImportCollectionsFile
): ImportCollectionsState {
  return {
    ...state,
    files: state.files.map((file) =>
      file.fileName === fileName ? update(file) : file
    ),
  };
}

export const importCollectionsReducer: Reducer<
  ImportCollectionsState,
  Action
> = (state = initialState, action) => {
  if (isAction<OpenAction>(action, ImportCollectionsActionTypes.Open)) {
    return {
      ...initialState,
      isOpen: true,
      connectionId: action.connectionId,
      databaseName: action.databaseName,
      status: 'select-folder',
    };
  }

  if (isAction<CloseAction>(action, ImportCollectionsActionTypes.Close)) {
    return state.status === 'in-progress'
      ? { ...state, isOpen: false }
      : initialState;
  }

  if (
    isAction<LoadFilesAction>(action, ImportCollectionsActionTypes.LoadFiles)
  ) {
    return {
      ...state,
      status: 'loading-files',
      directoryPath: action.directoryPath,
      files: [],
      errorLoadingFiles: undefined,
    };
  }

  if (
    isAction<LoadFilesSuccessAction>(
      action,
      ImportCollectionsActionTypes.LoadFilesSuccess
    )
  ) {
    // Ignore results for a folder that is no longer the selected one.
    if (
      state.status !== 'loading-files' ||
      state.directoryPath !== action.directoryPath
    ) {
      return state;
    }
    return {
      ...state,
      status: 'ready',
      existingCollectionNames: action.existingCollectionNames,
      files: action.files.map((file) => ({
        ...file,
        selected: true,
        targetCollectionName: file.collectionName,
      })),
    };
  }

  if (
    isAction<LoadFilesErrorAction>(
      action,
      ImportCollectionsActionTypes.LoadFilesError
    )
  ) {
    if (
      state.status !== 'loading-files' ||
      state.directoryPath !== action.directoryPath
    ) {
      return state;
    }
    return {
      ...state,
      status: 'select-folder',
      errorLoadingFiles: action.errorMessage,
    };
  }

  if (
    isAction<ToggleFileAction>(action, ImportCollectionsActionTypes.ToggleFile)
  ) {
    return updateFile(state, action.fileName, (file) => ({
      ...file,
      selected: !file.selected,
    }));
  }

  if (
    isAction<ToggleAllFilesAction>(
      action,
      ImportCollectionsActionTypes.ToggleAllFiles
    )
  ) {
    const allSelected = state.files.every((file) => file.selected);
    return {
      ...state,
      files: state.files.map((file) => ({ ...file, selected: !allSelected })),
    };
  }

  if (
    isAction<SetTargetCollectionNameAction>(
      action,
      ImportCollectionsActionTypes.SetTargetCollectionName
    )
  ) {
    return updateFile(state, action.fileName, (file) => ({
      ...file,
      targetCollectionName: action.collectionName,
    }));
  }

  if (
    isAction<RunImportAction>(action, ImportCollectionsActionTypes.RunImport)
  ) {
    return {
      ...state,
      isOpen: false,
      status: 'in-progress',
      importAbortController: action.importAbortController,
    };
  }

  if (
    isAction<ImportFinishedAction>(
      action,
      ImportCollectionsActionTypes.ImportFinished
    )
  ) {
    return initialState;
  }

  return state;
};
