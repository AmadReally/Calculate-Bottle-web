// Manage contributor accounts from the server machine. There is no sign-up page on purpose.
//   node scripts/user.js add <nama> [--role admin|contributor]
//   node scripts/user.js passwd <nama>
//   node scripts/user.js disable <nama> | enable <nama>
//   node scripts/user.js list
// The password is read from a hidden prompt, or from KBT_PASSWORD for scripted setup.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import * as auth from '../lib/auth.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const db = new DatabaseSync(process.env.DB_PATH || join(ROOT, 'data', 'botol.db'));
auth.migrateAuth(db);

const [cmd, name, ...rest] = process.argv.slice(2);
const role = rest.includes('--role') ? rest[rest.indexOf('--role') + 1] : 'contributor';

function askHidden(q) {
  if (process.env.KBT_PASSWORD) return Promise.resolve(process.env.KBT_PASSWORD);
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.startsWith(q)) process.stdout.write(q); };
    rl.question(q, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}

async function newPassword() {
  const a = await askHidden('Kata laluan (min 10 aksara): ');
  if (!process.env.KBT_PASSWORD && a !== await askHidden('Ulang kata laluan: ')) throw new Error('Kata laluan tidak sama.');
  return a;
}

try {
  const username = String(name ?? '').trim().toLowerCase();
  if (cmd === 'add') {
    auth.createUser(db, username, await newPassword(), role);
    console.log(`Akaun ${username} (${role}) dicipta.`);
  } else if (cmd === 'passwd') {
    auth.setPassword(db, username, await newPassword());
    console.log(`Kata laluan ${username} ditukar; semua sesi lama dilog keluar.`);
  } else if (cmd === 'disable' || cmd === 'enable') {
    auth.setDisabled(db, username, cmd === 'disable');
    console.log(`Akaun ${username} ${cmd === 'disable' ? 'dinyahaktif' : 'diaktifkan'}.`);
  } else if (cmd === 'list') {
    console.table(db.prepare('SELECT username, role, disabled, created_at FROM users ORDER BY username').all());
  } else {
    console.log('Guna: node scripts/user.js add|passwd|disable|enable|list <nama> [--role admin|contributor]');
    process.exitCode = 1;
  }
} catch (e) {
  console.error('Ralat: ' + (String(e.message).includes('UNIQUE') ? 'nama pengguna sudah wujud.' : e.message));
  process.exitCode = 1;
} finally {
  db.close();
}
