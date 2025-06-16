import { genIndex } from '../../src/functions/gen-index.mjs';
import '../../src/node-global.mjs';
import { projectRootPath } from '../project-root-path.mjs';

await genIndex({
  targetDirectory: path.resolve(projectRootPath, './src/functions'),
});
