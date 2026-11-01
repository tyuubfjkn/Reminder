import { createInterface } from 'node:readline';
import { openStore } from './store.mjs';
import { createDispatcher } from './dispatch.mjs';
import { object } from './validation.mjs';
import { invalid } from './errors.mjs';

if (process.argv.length !== 4 || process.argv[2] !== '--db' || !process.argv[3]) {
  process.stderr.write('Usage: node packages/backend/src/cli.mjs --db <database-path>\n');
  process.exitCode=2;
} else {
  let store;
  try {
    store=openStore(process.argv[3]);
    const dispatch=createDispatcher(store);
    const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
    for await (const line of lines) {
      let response;
      try {
        const request=JSON.parse(line);
        object(request,['method','params']);
        if (typeof request.method !== 'string') invalid('request');
        response=dispatch(request.method,request.params);
      } catch { response={ok:false,error:{code:'VALIDATION_ERROR',field:'request'}}; }
      process.stdout.write(JSON.stringify(response)+'\n');
    }
  } catch {
    process.stderr.write('STORAGE_ERROR\n');
    process.exitCode=1;
  } finally { store?.close(); }
}
