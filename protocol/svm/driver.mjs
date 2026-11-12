// Local SVM test bridge. Accepts public fixture data only; never signs or sends.
import { readFileSync } from 'node:fs';
import { buildInstruction } from '../src/instructions.mjs';
import { readPortfolio } from '../src/accounts.mjs';

const input = JSON.parse(readFileSync(0, 'utf8'));
let result;
if (input.operation === 'readPortfolio') {
  result = readPortfolio({ ...input.account, data: Buffer.from(input.account.data) }, input.expected);
} else if (input.operation === 'buildInstruction') {
  const ix = buildInstruction(input.program, input.name, input.args, input.accounts);
  result = {
    programId: ix.programId.toBase58(),
    keys: ix.keys.map(k => ({ ...k, pubkey: k.pubkey.toBase58() })),
    data: [...ix.data],
  };
} else {
  throw new Error('Unsupported SVM bridge operation');
}
process.stdout.write(JSON.stringify(result, (_, value) => typeof value === 'bigint' ? value.toString() : value));
