import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const replacements = [
  {
    relativePath: 'node_modules/@dimforge/rapier3d-compat/rapier.mjs',
    oldText:
      'void 0!==I&&(Object.getPrototypeOf(I)===Object.prototype?({module_or_path:I}=I):console.warn("using deprecated parameters for the initialization function; pass a single object instead")),void 0===I&&',
    newText:
      'void 0!==I&&(("object"==typeof I&&null!==I&&Object.getPrototypeOf(I)===Object.prototype)||(I={module_or_path:I}),({module_or_path:I}=I)),void 0===I&&',
  },
  {
    relativePath: 'node_modules/@dimforge/rapier3d-compat/rapier.cjs',
    oldText:
      'void 0!==I&&(Object.getPrototypeOf(I)===Object.prototype?({module_or_path:I}=I):console.warn("using deprecated parameters for the initialization function; pass a single object instead")),void 0===I&&',
    newText:
      'void 0!==I&&(("object"==typeof I&&null!==I&&Object.getPrototypeOf(I)===Object.prototype)||(I={module_or_path:I}),({module_or_path:I}=I)),void 0===I&&',
  },
];

for (const replacement of replacements) {
  const filePath = join(process.cwd(), replacement.relativePath);
  const source = readFileSync(filePath, 'utf8');

  if (source.includes(replacement.newText)) {
    continue;
  }

  if (!source.includes(replacement.oldText)) {
    throw new Error(`Could not find expected Rapier init snippet in ${replacement.relativePath}`);
  }

  writeFileSync(filePath, source.replace(replacement.oldText, replacement.newText));
}