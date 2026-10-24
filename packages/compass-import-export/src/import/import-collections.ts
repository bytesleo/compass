import fs from 'fs';
import path from 'path';
import { EJSON } from 'bson';
import type { Document } from 'bson';
import type { DataService } from 'mongodb-data-service';

import { importJSON } from './import-json';
import { importCSV } from './import-csv';
import { guessFileType } from './guess-filetype';
import { analyzeCSVFields } from './analyze-csv-fields';
import type { ImportProgress, ImportResult } from './import-types';
import { createDebug } from '../utils/logger';

const debug = createDebug('import-collections');

export type ImportFileType = 'json' | 'csv';

export type ImportableFile = {
  fileName: string;
  filePath: string;
  fileType: ImportFileType;
  // Suggested target, taken from the file name.
  collectionName: string;
  metadataPath: string | undefined;
};

export type ExistingCollectionMode = 'append' | 'skip' | 'replace';

export type CollectionImportStatus = 'imported' | 'skipped' | 'failed';

export type CollectionImportResult = {
  fileName: string;
  collectionName: string;
  status: CollectionImportStatus;
  created: boolean;
  docsWritten: number;
  docsErrored: number;
  aborted: boolean;
  error?: Error;
};

export type ImportCollectionsResult = {
  collections: CollectionImportResult[];
  aborted: boolean;
};

type ImportCollectionsDataService = Pick<
  DataService,
  | 'bulkWrite'
  | 'insertOne'
  | 'listCollections'
  | 'createCollection'
  | 'dropCollection'
  | 'createIndex'
>;

type ImportCollectionsOptions = {
  databaseName: string;
  files: Pick<
    ImportableFile,
    'fileName' | 'filePath' | 'fileType' | 'collectionName' | 'metadataPath'
  >[];
  dataService: ImportCollectionsDataService;
  existingCollectionMode: ExistingCollectionMode;
  applyMetadata: boolean;
  stopOnErrors?: boolean;
  abortSignal?: AbortSignal;
  onCollectionStart?: (collectionName: string, index: number) => void;
  progressCallback?: (collectionName: string, progress: ImportProgress) => void;
};

const METADATA_SUFFIX = '.metadata.json';

/**
 * Reverses `collectionNameToFileName()` from the multi-collection export.
 */
export function fileNameToCollectionName(fileName: string): string {
  return fileName.replace(/%([0-9A-F]{2})/g, (_match, hex: string) =>
    String.fromCharCode(parseInt(hex, 16))
  );
}

function getFileType(fileName: string): ImportFileType | undefined {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === '.json' || extension === '.jsonl') {
    return 'json';
  }
  if (extension === '.csv') {
    return 'csv';
  }
  return undefined;
}

/**
 * Lists the files in a folder that can be imported, for example the output of
 * the multi-collection export: `<collection>.json` or `<collection>.csv`, each
 * optionally next to a `<collection>.metadata.json`.
 */
export async function listImportableFiles(
  directoryPath: string
): Promise<ImportableFile[]> {
  const entries = await fs.promises.readdir(directoryPath, {
    withFileTypes: true,
  });
  const fileNames = new Set(
    entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  );

  const files: ImportableFile[] = [];
  for (const fileName of [...fileNames].sort()) {
    if (fileName.endsWith(METADATA_SUFFIX)) {
      continue;
    }
    const fileType = getFileType(fileName);
    if (!fileType) {
      continue;
    }
    const baseName = fileName.slice(0, -path.extname(fileName).length);
    const metadataFileName = `${baseName}${METADATA_SUFFIX}`;
    files.push({
      fileName,
      filePath: path.join(directoryPath, fileName),
      fileType,
      collectionName: fileNameToCollectionName(baseName),
      metadataPath: fileNames.has(metadataFileName)
        ? path.join(directoryPath, metadataFileName)
        : undefined,
    });
  }
  return files;
}

async function readMetadata(metadataPath: string): Promise<Document> {
  return EJSON.parse(await fs.promises.readFile(metadataPath, 'utf8'), {
    relaxed: false,
  }) as Document;
}

// Index fields that describe the index rather than being createIndex options.
const INDEX_SPEC_FIELDS = new Set(['v', 'key', 'ns']);

async function createIndexesFromMetadata(
  ns: string,
  metadata: Document,
  dataService: Pick<DataService, 'createIndex'>
) {
  for (const index of (metadata.indexes ?? []) as Document[]) {
    if (index.name === '_id_') {
      continue;
    }
    const options = Object.fromEntries(
      Object.entries(index).filter(([key]) => !INDEX_SPEC_FIELDS.has(key))
    );
    await dataService.createIndex(ns, index.key as Document, options);
  }
}

async function importFile({
  ns,
  filePath,
  fileType,
  dataService,
  stopOnErrors,
  abortSignal,
  progressCallback,
}: {
  ns: string;
  filePath: string;
  fileType: ImportFileType;
  dataService: Pick<DataService, 'bulkWrite' | 'insertOne'>;
  stopOnErrors: boolean;
  abortSignal?: AbortSignal;
  progressCallback?: (progress: ImportProgress) => void;
}): Promise<Pick<ImportResult, 'docsWritten' | 'docsErrored' | 'aborted'>> {
  // An empty collection is exported as an empty CSV file (just a line
  // break), which can't be told apart from other formats: nothing to import.
  const { size } = await fs.promises.stat(filePath);
  if (
    size <= 2 &&
    (await fs.promises.readFile(filePath, 'utf8')).trim() === ''
  ) {
    return { docsWritten: 0, docsErrored: 0, aborted: false };
  }

  // Open the files the same way as the single-file import: the detection
  // and the import itself read decoded text, the CSV analysis raw bytes.
  const detected = await guessFileType({
    input: fs.createReadStream(filePath, 'utf8'),
  });

  if (fileType === 'csv') {
    if (detected.type !== 'csv') {
      throw new Error('The file is not a valid CSV file.');
    }
    // Use the detected type of every column, like the single-file import
    // does before the user changes any of them.
    const analyzed = await analyzeCSVFields({
      input: fs.createReadStream(filePath),
      delimiter: detected.csvDelimiter,
      newline: detected.newline,
      abortSignal,
    });
    const fields = Object.fromEntries(
      Object.entries(analyzed.fields).map(([name, field]) => [
        name,
        field.detected,
      ])
    );
    return await importCSV({
      dataService,
      ns,
      input: fs.createReadStream(filePath, 'utf8'),
      delimiter: detected.csvDelimiter,
      newline: detected.newline,
      fields,
      stopOnErrors,
      abortSignal,
      progressCallback,
    });
  }

  if (detected.type !== 'json' && detected.type !== 'jsonl') {
    throw new Error('The file is not a valid JSON file.');
  }
  return await importJSON({
    dataService,
    ns,
    input: fs.createReadStream(filePath, 'utf8'),
    jsonVariant: detected.type,
    stopOnErrors,
    abortSignal,
    progressCallback,
  });
}

async function importCollection({
  databaseName,
  file,
  existingCollectionNames,
  dataService,
  existingCollectionMode,
  applyMetadata,
  stopOnErrors,
  abortSignal,
  progressCallback,
}: Omit<
  ImportCollectionsOptions,
  'files' | 'onCollectionStart' | 'stopOnErrors'
> & {
  file: ImportCollectionsOptions['files'][number];
  existingCollectionNames: Set<string>;
  stopOnErrors: boolean;
}): Promise<CollectionImportResult> {
  const { fileName, collectionName } = file;
  const ns = `${databaseName}.${collectionName}`;
  const exists = existingCollectionNames.has(collectionName);
  const result: CollectionImportResult = {
    fileName,
    collectionName,
    status: 'imported',
    created: false,
    docsWritten: 0,
    docsErrored: 0,
    aborted: false,
  };

  if (exists && existingCollectionMode === 'skip') {
    return { ...result, status: 'skipped' };
  }

  // Options and indexes only apply to collections created by the import, an
  // existing collection keeps its own.
  const willCreate = !exists || existingCollectionMode === 'replace';
  // Read the metadata before anything is dropped, so a broken metadata file
  // doesn't cost the existing collection.
  const metadata =
    willCreate && applyMetadata && file.metadataPath
      ? await readMetadata(file.metadataPath)
      : undefined;

  if (exists && existingCollectionMode === 'replace') {
    await dataService.dropCollection(ns);
  }

  let importResult;
  try {
    if (willCreate) {
      await dataService.createCollection(
        ns,
        (metadata?.options as Document | undefined) ?? {}
      );
      result.created = true;
    }

    importResult = await importFile({
      ns,
      filePath: file.filePath,
      fileType: file.fileType,
      dataService,
      stopOnErrors,
      abortSignal,
      progressCallback: (progress) =>
        progressCallback?.(collectionName, progress),
    });
  } catch (err) {
    // Keep `created` so the caller still refreshes a collection that exists
    // now, even if nothing could be imported into it.
    return { ...result, status: 'failed', error: err as Error };
  }

  // Indexes are built after the documents are in, which is faster than
  // maintaining them during the inserts.
  if (metadata && !importResult.aborted) {
    try {
      await createIndexesFromMetadata(ns, metadata, dataService);
    } catch (err) {
      result.error = new Error(
        `The documents were imported, but creating the indexes failed: ${
          (err as Error).message
        }`
      );
    }
  }

  return {
    ...result,
    docsWritten: importResult.docsWritten,
    docsErrored: importResult.docsErrored,
    aborted: !!importResult.aborted,
  };
}

/**
 * Imports each file into its target collection, one after the other. A
 * failure in one file is recorded in its result and the import moves on to
 * the next one; aborting stops the whole import.
 */
export async function importCollectionsFromDirectory({
  files,
  onCollectionStart,
  stopOnErrors = false,
  ...options
}: ImportCollectionsOptions): Promise<ImportCollectionsResult> {
  debug('importCollectionsFromDirectory()', {
    databaseName: options.databaseName,
    files: files.map(({ fileName, collectionName }) => ({
      fileName,
      collectionName,
    })),
    existingCollectionMode: options.existingCollectionMode,
  });

  const existingCollectionNames = new Set(
    (await options.dataService.listCollections(options.databaseName)).map(
      (collection) => collection.name
    )
  );

  const collections: CollectionImportResult[] = [];
  for (const [index, file] of files.entries()) {
    if (options.abortSignal?.aborted) {
      break;
    }
    onCollectionStart?.(file.collectionName, index);
    try {
      collections.push(
        await importCollection({
          ...options,
          file,
          existingCollectionNames,
          stopOnErrors,
        })
      );
    } catch (err) {
      debug('failed to import collection', {
        collectionName: file.collectionName,
        err,
      });
      collections.push({
        fileName: file.fileName,
        collectionName: file.collectionName,
        status: 'failed',
        created: false,
        docsWritten: 0,
        docsErrored: 0,
        aborted: false,
        error: err as Error,
      });
    }
  }

  return {
    collections,
    aborted: !!options.abortSignal?.aborted,
  };
}
