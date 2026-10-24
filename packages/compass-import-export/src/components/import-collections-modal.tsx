import React, { useCallback, useEffect, useState } from 'react';
import { connect } from 'react-redux';
import {
  Badge,
  BadgeVariant,
  Banner,
  Body,
  Button,
  Checkbox,
  Description,
  Icon,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Radio,
  RadioGroup,
  SpinLoader,
  TextInput,
  createElectronFileInputBackend,
  css,
  spacing,
} from '@mongodb-js/compass-components';

import {
  closeImportCollections,
  getCollectionNameError,
  runImportCollections,
  selectImportDirectory,
  setTargetCollectionName,
  toggleAllImportFiles,
  toggleImportFile,
} from '../modules/import-collections';
import type {
  ImportCollectionsFile,
  ImportCollectionsStatus,
} from '../modules/import-collections';
import type { ExistingCollectionMode } from '../import/import-collections';
import type { RootImportState } from '../stores/import-store';

const fileListStyles = css({
  maxHeight: 280,
  overflowY: 'auto',
  margin: `${spacing[200]}px 0 ${spacing[400]}px`,
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[200],
});

const modalBodyStyles = css({
  paddingTop: spacing[400],
});

const fileRowStyles = css({
  display: 'grid',
  // A fixed badge column keeps the collection name inputs aligned whether the
  // badge says "New" or "Exists".
  gridTemplateColumns: `minmax(0, 1fr) minmax(0, 1fr) ${spacing[1600]}px`,
  alignItems: 'center',
  gap: spacing[200],
});

const folderPickerStyles = css({
  display: 'flex',
  alignItems: 'center',
  gap: spacing[200],
  marginTop: spacing[200],
  minWidth: 0,
});

const folderButtonStyles = css({
  flexShrink: 0,
  whiteSpace: 'nowrap',
});

const folderPathStyles = css({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

const loaderStyles = css({
  display: 'flex',
  alignItems: 'center',
  gap: spacing[200],
  marginTop: spacing[400],
});

const sectionStyles = css({
  marginTop: spacing[400],
});

const footerStyles = css({
  display: 'flex',
  gap: spacing[200],
});

type ImportCollectionsModalProps = {
  isOpen: boolean;
  databaseName: string;
  status: ImportCollectionsStatus;
  directoryPath: string;
  files: ImportCollectionsFile[];
  existingCollectionNames: string[];
  errorLoadingFiles: string | undefined;
  closeImportCollections: () => void;
  selectImportDirectory: (directoryPath: string) => void;
  toggleImportFile: (fileName: string) => void;
  toggleAllImportFiles: () => void;
  setTargetCollectionName: (fileName: string, collectionName: string) => void;
  runImportCollections: (options: {
    existingCollectionMode: ExistingCollectionMode;
    applyMetadata: boolean;
  }) => void;
};

function ImportCollectionsModal({
  isOpen,
  databaseName,
  status,
  directoryPath,
  files,
  existingCollectionNames,
  errorLoadingFiles,
  closeImportCollections,
  selectImportDirectory,
  toggleImportFile,
  toggleAllImportFiles,
  setTargetCollectionName,
  runImportCollections,
}: ImportCollectionsModalProps) {
  // Kept between openings so the last chosen options are remembered.
  const [existingCollectionMode, setExistingCollectionMode] =
    useState<ExistingCollectionMode>('append');
  const [applyMetadata, setApplyMetadata] = useState(true);

  const selectedFiles = files.filter((file) => file.selected);
  const selectedNames = selectedFiles.map((file) => file.targetCollectionName);
  const nameErrors: Record<string, string | undefined> = Object.fromEntries(
    files.map((file) => [
      file.fileName,
      file.selected
        ? getCollectionNameError(file.targetCollectionName, selectedNames)
        : undefined,
    ])
  );
  const hasNameErrors = Object.values(nameErrors).some(Boolean);
  const existingSelectedCount = selectedFiles.filter((file) =>
    existingCollectionNames.includes(file.targetCollectionName)
  ).length;
  const hasMetadataFiles = selectedFiles.some((file) => file.metadataPath);

  const onClickSelectFolder = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports, @typescript-eslint/no-require-imports
    const electron: typeof import('@electron/remote') = require('@electron/remote');
    const fileBackend = createElectronFileInputBackend(electron, null)();

    fileBackend.onFilesChosen((paths: string[]) => {
      if (paths.length > 0) {
        selectImportDirectory(paths[0]);
      }
    });

    fileBackend.openFileChooser({
      multi: false,
      mode: 'open',
      title: 'Select a folder to import',
      buttonLabel: 'Select',
      defaultPath: directoryPath || undefined,
      properties: ['openDirectory'],
    });
  }, [directoryPath, selectImportDirectory]);

  const onSelectDirectoryEvent = useCallback(
    ({ detail: path }: CustomEventInit<string>) => {
      selectImportDirectory(path!);
    },
    [selectImportDirectory]
  );

  useEffect(() => {
    if (isOpen) {
      // For e2e testing we can't drive the native folder picker, so we listen
      // to a dom event that sets the folder instead.
      document.addEventListener(
        'selectImportCollectionsDirectory',
        onSelectDirectoryEvent
      );
      return () => {
        document.removeEventListener(
          'selectImportCollectionsDirectory',
          onSelectDirectoryEvent
        );
      };
    }
  }, [isOpen, onSelectDirectoryEvent]);

  return (
    <Modal
      open={isOpen}
      setOpen={closeImportCollections}
      data-testid="import-collections-modal"
    >
      <ModalHeader
        title="Import collections"
        subtitle={`Database ${databaseName}`}
      />
      <ModalBody className={modalBodyStyles}>
        <Label htmlFor="import-collections-select-folder">Folder</Label>
        <Description>
          For example a folder created with Export collections: one JSON or CSV
          file per collection, optionally with .metadata.json files.
        </Description>
        <div className={folderPickerStyles}>
          <Button
            id="import-collections-select-folder"
            data-testid="import-collections-select-folder"
            className={folderButtonStyles}
            size="small"
            leftGlyph={<Icon glyph="Folder" />}
            onClick={onClickSelectFolder}
          >
            {directoryPath ? 'Change folder…' : 'Select folder…'}
          </Button>
          {directoryPath && (
            <Body
              className={folderPathStyles}
              data-testid="import-collections-folder-path"
            >
              {/* The full path on hover, as long paths are truncated. */}
              <span title={directoryPath}>{directoryPath}</span>
            </Body>
          )}
        </div>
        {status === 'loading-files' && (
          <div className={loaderStyles}>
            <SpinLoader />
            <Body>Reading folder…</Body>
          </div>
        )}
        {errorLoadingFiles && (
          <Banner variant="danger" className={sectionStyles}>
            Unable to read the folder: {errorLoadingFiles}
          </Banner>
        )}
        {status === 'ready' && files.length === 0 && (
          <Body className={sectionStyles}>
            This folder has no JSON or CSV files.
          </Body>
        )}
        {status === 'ready' && files.length > 0 && (
          <>
            <div className={sectionStyles}>
              <Checkbox
                data-testid="import-collections-select-all"
                label="Select all"
                checked={selectedFiles.length === files.length}
                indeterminate={
                  selectedFiles.length > 0 &&
                  selectedFiles.length < files.length
                }
                onChange={toggleAllImportFiles}
              />
            </div>
            <div className={fileListStyles}>
              {files.map((file) => {
                const exists = existingCollectionNames.includes(
                  file.targetCollectionName
                );
                return (
                  <div
                    key={file.fileName}
                    className={fileRowStyles}
                    data-testid={`import-collections-file-${file.fileName}`}
                  >
                    <Checkbox
                      label={file.fileName}
                      description={
                        file.metadataPath ? 'With metadata' : undefined
                      }
                      checked={file.selected}
                      onChange={() => toggleImportFile(file.fileName)}
                    />
                    <TextInput
                      aria-label={`Target collection for ${file.fileName}`}
                      sizeVariant="small"
                      disabled={!file.selected}
                      value={file.targetCollectionName}
                      state={nameErrors[file.fileName] ? 'error' : 'none'}
                      errorMessage={nameErrors[file.fileName]}
                      onChange={(event) =>
                        setTargetCollectionName(
                          file.fileName,
                          event.target.value
                        )
                      }
                    />
                    <Badge
                      variant={exists ? BadgeVariant.Yellow : BadgeVariant.Blue}
                    >
                      {exists ? 'Exists' : 'New'}
                    </Badge>
                  </div>
                );
              })}
            </div>
            {existingSelectedCount > 0 && (
              <div className={sectionStyles}>
                <Label htmlFor="import-collections-existing-mode">
                  {`${existingSelectedCount} collection${
                    existingSelectedCount !== 1 ? 's' : ''
                  } already exist${existingSelectedCount === 1 ? 's' : ''}:`}
                </Label>
                <RadioGroup
                  id="import-collections-existing-mode"
                  size="small"
                  value={existingCollectionMode}
                  onChange={(event) =>
                    setExistingCollectionMode(
                      event.target.value as ExistingCollectionMode
                    )
                  }
                >
                  <Radio value="append">Add the documents to it</Radio>
                  <Radio value="skip">Skip the file</Radio>
                  <Radio value="replace">Drop it and import the file</Radio>
                </RadioGroup>
                {existingCollectionMode === 'replace' && (
                  <Banner variant="warning" className={sectionStyles}>
                    The existing collections and their documents will be dropped
                    before importing. This cannot be undone.
                  </Banner>
                )}
              </div>
            )}
            {hasMetadataFiles && (
              <div className={sectionStyles}>
                <Checkbox
                  data-testid="import-collections-apply-metadata"
                  label="Create indexes and collection options"
                  description="Uses the .metadata.json files for collections that the import creates."
                  checked={applyMetadata}
                  onChange={(event) => setApplyMetadata(event.target.checked)}
                />
              </div>
            )}
          </>
        )}
      </ModalBody>
      <ModalFooter className={footerStyles}>
        <Button
          data-testid="import-collections-cancel-button"
          onClick={closeImportCollections}
        >
          Cancel
        </Button>
        <Button
          data-testid="import-collections-import-button"
          variant="primary"
          disabled={
            status !== 'ready' || selectedFiles.length === 0 || hasNameErrors
          }
          onClick={() =>
            runImportCollections({ existingCollectionMode, applyMetadata })
          }
        >
          {selectedFiles.length > 0
            ? `Import ${selectedFiles.length} file${
                selectedFiles.length !== 1 ? 's' : ''
              }`
            : 'Import'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

const ConnectedImportCollectionsModal = connect(
  (state: RootImportState) => ({
    isOpen: state.importCollections.isOpen,
    databaseName: state.importCollections.databaseName,
    status: state.importCollections.status,
    directoryPath: state.importCollections.directoryPath,
    files: state.importCollections.files,
    existingCollectionNames: state.importCollections.existingCollectionNames,
    errorLoadingFiles: state.importCollections.errorLoadingFiles,
  }),
  {
    closeImportCollections,
    selectImportDirectory,
    toggleImportFile,
    toggleAllImportFiles,
    setTargetCollectionName,
    runImportCollections,
  }
)(ImportCollectionsModal);

export {
  ConnectedImportCollectionsModal as ImportCollectionsModal,
  ImportCollectionsModal as UnconnectedImportCollectionsModal,
};
