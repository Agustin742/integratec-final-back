import { writeFile } from 'node:fs/promises';
import { OPENAPI_FILE_PATH, renderOpenApiJson } from './export';

renderOpenApiJson()
  .then((json) => writeFile(OPENAPI_FILE_PATH, json, 'utf8'))
  .then(() => {
    console.log(`Wrote ${OPENAPI_FILE_PATH}`);
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error('openapi:export failed:', err);
    process.exit(1);
  });
