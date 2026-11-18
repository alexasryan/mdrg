import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';

// Only these generated files may be replaced; keep all source files intact.
for (const name of ['assets', 'index.html', '404.html', 'favicon.svg', '.nojekyll']) {
  await rm(name, { recursive: true, force: true });
}
for (const name of await readdir('dist')) await cp('dist/' + name, name, { recursive: true });
await writeFile('.nojekyll', '');
await mkdir('dist', { recursive: true });
