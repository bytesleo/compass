import React from 'react';
import { expect } from 'chai';
import sinon from 'sinon';
import {
  cleanup,
  render,
  screen,
  userEvent,
} from '@mongodb-js/testing-library-compass';

import { UnconnectedImportCollectionsModal } from './import-collections-modal';

type ModalProps = React.ComponentProps<
  typeof UnconnectedImportCollectionsModal
>;

function renderModal(props: Partial<ModalProps> = {}) {
  const runImportCollections = sinon.spy();
  render(
    <UnconnectedImportCollectionsModal
      isOpen={true}
      databaseName="store"
      status="select-folder"
      directoryPath=""
      files={[]}
      existingCollectionNames={[]}
      errorLoadingFiles={undefined}
      closeImportCollections={sinon.spy()}
      selectImportDirectory={sinon.spy()}
      toggleImportFile={sinon.spy()}
      toggleAllImportFiles={sinon.spy()}
      setTargetCollectionName={sinon.spy()}
      runImportCollections={runImportCollections}
      {...props}
    />
  );
  return { runImportCollections };
}

const files = [
  {
    fileName: 'customers.json',
    filePath: '/tmp/export/customers.json',
    fileType: 'json' as const,
    collectionName: 'customers',
    metadataPath: '/tmp/export/customers.metadata.json',
    selected: true,
    targetCollectionName: 'customers',
  },
  {
    fileName: 'orders.csv',
    filePath: '/tmp/export/orders.csv',
    fileType: 'csv' as const,
    collectionName: 'orders',
    metadataPath: undefined,
    selected: true,
    targetCollectionName: 'orders',
  },
];

describe('ImportCollectionsModal', function () {
  afterEach(cleanup);

  it('asks for a folder before anything else', function () {
    renderModal();

    expect(screen.getByTestId('import-collections-select-folder')).to.have.text(
      'Select folder…'
    );
    expect(screen.queryByTestId('import-collections-folder-path')).to.not.exist;
    expect(
      screen.getByTestId('import-collections-import-button')
    ).to.have.attribute('aria-disabled', 'true');
  });

  it('shows the selected folder and its files', function () {
    renderModal({ status: 'ready', directoryPath: '/tmp/export', files });

    expect(screen.getByTestId('import-collections-select-folder')).to.have.text(
      'Change folder…'
    );
    expect(screen.getByTestId('import-collections-folder-path')).to.have.text(
      '/tmp/export'
    );
    expect(screen.getByText('customers.json')).to.exist;
    expect(screen.getByText('orders.csv')).to.exist;
    expect(screen.getByTestId('import-collections-import-button')).to.have.text(
      'Import 2 files'
    );
  });

  it('only asks about existing collections when there are some', function () {
    renderModal({ status: 'ready', directoryPath: '/tmp/export', files });
    expect(screen.queryByText('Drop it and import the file')).to.not.exist;

    cleanup();
    renderModal({
      status: 'ready',
      directoryPath: '/tmp/export',
      files,
      existingCollectionNames: ['orders'],
    });
    expect(screen.getByText('1 collection already exists:')).to.exist;
    expect(screen.getByText('Drop it and import the file')).to.exist;
  });

  it('blocks the import while a target name is invalid', function () {
    renderModal({
      status: 'ready',
      directoryPath: '/tmp/export',
      files: [{ ...files[0], targetCollectionName: 'bad$name' }],
    });

    expect(
      screen.getByTestId('import-collections-import-button')
    ).to.have.attribute('aria-disabled', 'true');
  });

  it('imports with the chosen options', function () {
    const { runImportCollections } = renderModal({
      status: 'ready',
      directoryPath: '/tmp/export',
      files,
    });

    userEvent.click(screen.getByTestId('import-collections-import-button'));

    expect(runImportCollections).to.have.been.calledOnceWith({
      existingCollectionMode: 'append',
      applyMetadata: true,
    });
  });
});
