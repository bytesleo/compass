import React from 'react';
import { openToast, ToastBody } from '@mongodb-js/compass-components';

import type { CollectionImportResult } from '../import/import-collections';

const importCollectionsToastId = 'import-collections-toast';

const docsWrittenText = (docsWritten: number) => {
  return `${docsWritten} document${docsWritten !== 1 ? 's' : ''} imported`;
};

export function showImportCollectionsInProgressToast({
  databaseName,
  collectionName,
  collectionIndex,
  collectionCount,
  docsWritten,
  cancelImport,
}: {
  databaseName: string;
  collectionName: string;
  collectionIndex: number;
  collectionCount: number;
  docsWritten: number;
  cancelImport: () => void;
}) {
  openToast(importCollectionsToastId, {
    title: `Importing ${collectionCount} collection${
      collectionCount !== 1 ? 's' : ''
    } into "${databaseName}"…`,
    description: (
      <ToastBody
        statusMessage={`${
          collectionIndex + 1
        } of ${collectionCount}: "${collectionName}", ${docsWrittenText(
          docsWritten
        )}.`}
        actionHandler={cancelImport}
        actionText="stop"
      />
    ),
    progress: collectionIndex / collectionCount,
    variant: 'progress',
    dismissible: false,
  });
}

export function showImportCollectionsFinishedToast({
  collections,
  aborted,
}: {
  collections: CollectionImportResult[];
  aborted: boolean;
}) {
  const imported = collections.filter((c) => c.status === 'imported');
  const skipped = collections.filter((c) => c.status === 'skipped');
  const failed = collections.filter((c) => c.status === 'failed');
  // Includes imported collections whose indexes couldn't be created.
  const withErrors = collections.filter((c) => c.error);
  const docsWritten = imported.reduce((total, c) => total + c.docsWritten, 0);
  const docsErrored = imported.reduce((total, c) => total + c.docsErrored, 0);

  const statusMessage = [
    `${imported.length} collection${
      imported.length !== 1 ? 's' : ''
    } imported, ${docsWrittenText(docsWritten)}.`,
    skipped.length > 0
      ? `${skipped.length} skipped because the collection already exists.`
      : '',
    docsErrored > 0
      ? `${docsErrored} document${docsErrored !== 1 ? 's' : ''} failed.`
      : '',
    ...withErrors.map(({ fileName, status, error }) =>
      status === 'failed'
        ? `Failed to import "${fileName}": ${error?.message ?? ''}`
        : `"${fileName}": ${error?.message ?? ''}`
    ),
  ]
    .filter(Boolean)
    .join(' ');

  const hasErrors = withErrors.length > 0 || docsErrored > 0;
  openToast(importCollectionsToastId, {
    title: aborted
      ? 'Import aborted.'
      : hasErrors
        ? 'Import completed with errors.'
        : failed.length === 0
          ? 'Import completed.'
          : 'Import failed.',
    description: statusMessage,
    variant: aborted || hasErrors ? 'warning' : 'success',
  });
}

export function showImportCollectionsFailedToast(err: Error | undefined) {
  openToast(importCollectionsToastId, {
    title: 'Failed to import with the following error:',
    description: err?.message,
    variant: 'warning',
  });
}
