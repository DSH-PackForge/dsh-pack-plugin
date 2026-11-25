import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { NodeHost } from '../src/host-node.js';
import { buildTarball } from '../src/core/tar.js';
import { applyPluginSources } from '../src/core/registry.js';

async function registry(packages) {
  const requests = [];
  const tarballs = new Map();
  for (const [name, versions] of Object.entries(packages)) {
    for (const [version, dependencies] of Object.entries(versions)) {
      const file = name + '/-/' + name.split('/').pop() + '-' + version + '.tgz';
      const pkg = {name, version, dependencies};
      const bytes = buildTarball({ 'package/package.json': new TextEncoder().encode(JSON.stringify(pkg)) });
      tarballs.set(file, {bytes, integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64')});
    }
  }
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).slice(1);
    requests.push(path);
    if (tarballs.has(path)) {
      res.end(tarballs.get(path).bytes);
      return;
    }
    for (const [name, versions] of Object.entries(packages)) {
      const meta = {};
      for (const [version, deps] of Object.entries(versions)) {
        const pkg = { name, version, dependencies: deps };
        const key = name + '/-/' + name.split('/').pop() + '-' + version + '.tgz';
        const tarball = 'http://127.0.0.1:' + server.address().port + '/' + key;
        meta[version] = { ...pkg, dist: { tarball, integrity: tarballs.get(key).integrity } };
        if (path === name + '/' + version) {
          res.setHeader('Content-Type','application/json');
          res.end(JSON.stringify(meta[version]));
          return;
        }
      }
      if (path === name) {
        res.setHeader('Content-Type','application/json');
        res.end(JSON.stringify({name, versions:meta, 'dist-tags':{latest:Object.keys(meta)[0]}, time:Object.fromEntries(Object.keys(meta).map(v=>[v,'2020-01-01T00:00:00.000Z']))}));
        return;
      }
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {requests, url:'http://127.0.0.1:' + server.address().port + '/', close:()=>new Promise((resolve)=>server.close(resolve))};
}

test('使用真实 pnpm 隔离同 scope 的不同插件与同名传递版本', async (t) => {
  const id = '@example/foo';
  const special = await registry({ [id]: {'1.2.3':{'@example/bar':'1.0.0'}, '1.2.4':{'@example/bar':'1.0.0'}} });
  const fallback = await registry({ [id]:{'2.0.0':{}}, '@example/bar':{'1.0.0':{[id]:'2.0.0'}}, '@example/baz':{'1.0.0':{}} });
  const host = new NodeHost();
  const root = await host.mkdtemp('dspack-source-integration-');
  t.after(async () => {
    await Promise.all([special.close(),fallback.close()]);
    await host.rm(root,{recursive:true,force:true});
  });
  const dir = host.joinPath(root,'profile');
  const yaml = 'registry: ' + fallback.url + '\nminimumReleaseAge: 0\nstoreDir: ../store\n';
  await host.writeTextFile(host.joinPath(dir,'pnpm-workspace.yaml'),yaml);
  await host.writeTextFile(host.joinPath(dir,'package.json'),JSON.stringify({name:'example',private:true,dependencies:{[id]:'1.2.3','@example/baz':'1.0.0'}}));
  for (const version of ['1.2.3','1.2.4']) {
    await applyPluginSources(host,dir,{dependencies:{[id]:version},plugins:{[id]:{source:{type:'npm',registry:special.url}}}});
    let output = '';
    const run = await host.pnpm(['install','--ignore-scripts','--no-frozen-lockfile'],{cwd:dir,timeoutMs:30000,onOutput:s=>{output+=s;}});
    assert.equal(run.status,0,output);
    const installed = JSON.parse(await host.readTextFile(host.joinPath(dir,'node_modules',id,'package.json')));
    assert.equal(installed.version,version);
  }
  assert.ok(special.requests.every(p=>p.startsWith(id+'/')));
  assert.ok(fallback.requests.includes('@example/foo/-/foo-2.0.0.tgz'));
  assert.ok(fallback.requests.includes('@example/bar/-/bar-1.0.0.tgz'));
  assert.ok(fallback.requests.includes('@example/baz/-/baz-1.0.0.tgz'));
  assert.ok(fallback.requests.every(p=>!p.includes('foo-1.2.')));
  assert.equal(await host.readTextFile(host.joinPath(dir,'pnpm-workspace.yaml')),yaml);
});
