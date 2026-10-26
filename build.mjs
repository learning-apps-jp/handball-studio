import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const files=['index.html','styles.css','arena.css','icon.svg','icon-180.png','icon-192.png','icon-512.png','manifest.webmanifest','sw.js','js/app.mjs','js/core.mjs','js/storage.mjs','js/tactics.mjs','js/video.mjs','js/export.mjs','js/sync.mjs','js/advanced-analysis.mjs','js/dashboard.mjs','js/readiness.mjs','js/personal-report.mjs','js/record-flow.mjs','js/event-details.mjs','js/record-feedback.mjs','docs/official-feature-audit.md','docs/implementation-status.md','docs/ipad-guide.md','docs/soq-comparison.md'];
for(const file of files){const to=path.join(root,'dist',file);await fs.mkdir(path.dirname(to),{recursive:true});await fs.copyFile(path.join(root,file),to);}
console.log(`配信用の${files.length}ファイルをdistへコピーしました。端末内データ・共有サーバーデータ・Dashboard・テストは含めていません。`);
