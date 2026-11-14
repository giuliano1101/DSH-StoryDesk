import {access, readFile} from 'node:fs/promises';
import {dirname, isAbsolute, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export async function checkDocuments(root, documents) {
  const base = resolve(root);
  const problems = [];
  for (const document of documents) {
    const content = (await readFile(resolve(base, document), 'utf8')).replace(/```[^\n]*\n[\s\S]*?```/g, '');
    for (const match of content.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const href = match[1];
      if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(href)) continue;
      const target = resolve(dirname(resolve(base, document)), decodeURIComponent(href.split(/[?#]/)[0]));
      const rel = relative(base, target);
      if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) {
        problems.push({document, href, reason: 'outside repository'});
        continue;
      }
      try { await access(target); }
      catch { problems.push({document, href, reason: 'missing file'}); }
    }
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const documents = ['README.md', 'README.en.md', 'README.ja.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md', 'SUPPORT.md', 'THIRD_PARTY_NOTICES.md', 'docs/installation.md', 'docs/architecture.md', 'docs/roadmap.md', 'docs/open-source-checklist.md'];
  const problems = await checkDocuments(process.cwd(), documents);
  for (const problem of problems) console.error(`${problem.document}: ${problem.href} (${problem.reason})`);
  console.log(`Checked local file links in ${documents.length} maintained documents. External URLs and fragments require separate review.`);
  if (problems.length) process.exitCode = 1;
}
