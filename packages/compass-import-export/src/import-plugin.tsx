import React from 'react';
import ImportModal from './components/import-modal';
import ImportInProgressModal from './components/import-in-progress-modal';
import { ImportCollectionsModal } from './components/import-collections-modal';

function ImportPlugin() {
  return (
    <>
      <ImportModal />
      <ImportInProgressModal />
      <ImportCollectionsModal />
    </>
  );
}

export default ImportPlugin;
