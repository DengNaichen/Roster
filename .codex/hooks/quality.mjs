import { handle } from './quality-core.mjs';

try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 1024 * 1024) throw new Error('Hook input exceeds 1 MiB');
  }
  const result = await handle(JSON.parse(input));
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stdout.write(
    `${
      JSON.stringify({
        systemMessage: `Roster quality checks incomplete: ${
          String(error.message).slice(0, 2000)
        }. Run node scripts/toolchain.mjs check manually; no automatic continuation was requested.`,
      })
    }\n`,
  );
}
