import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { applyAction, clone, createInitialState } from './domain.mjs';

const queues = new Map();
const packageDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
function serialize(directory, work) {
  const next = (queues.get(directory) ?? Promise.resolve()).catch(() => {}).then(work);
  const tail = next.catch(() => {});
  queues.set(directory, tail);
  tail.finally(() => { if (queues.get(directory) === tail) queues.delete(directory); });
  return next;
}
async function atomicWrite(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let file;
  try {
    file = await open(temporary, 'wx', 0o600);
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await file.sync();
    await file.close();
    file = undefined;
    await rename(temporary, path);
  } finally {
    await file?.close();
    await rm(temporary, { force: true });
  }
}
async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return clone(fallback); throw error; }
}
function validateState(state) {
  if (!state || state.schemaVersion !== 1 || !Number.isSafeInteger(state.revision) || !Array.isArray(state.projects) || !Array.isArray(state.sharedMaterials) || !state.workspace) throw new Error('剧本数据格式不正确。请保留数据文件并从备份恢复。');
  return state;
}
export async function createStore({ directory = process.env.SCREENWRITER_DATA_DIR || join(packageDirectory, '.data'), seed = true } = {}) {
  directory = resolve(directory);
  const statePath = join(directory, 'state.json');
  const settingsPath = join(directory, 'settings.json');
  await serialize(directory, async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try { validateState(await readJson(statePath)); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await atomicWrite(statePath, validateState(createInitialState(seed)));
    }
  });
  return {
    directory,
    async read() { return serialize(directory, async () => clone(validateState(await readJson(statePath)))); },
    async transaction(mutator) {
      return serialize(directory, async () => {
        const state = validateState(await readJson(statePath));
        const result = await mutator(state);
        state.revision += 1;
        await atomicWrite(statePath, state);
        return { state: clone(state), ...(result === undefined ? {} : { result: clone(result) }) };
      });
    },
    async dispatch(action) { return this.transaction(state => applyAction(state, action)); },
    async readSettings() { return serialize(directory, () => readJson(settingsPath, {})); },
    async updateSettings(mutator) {
      return serialize(directory, async () => {
        const settings = await readJson(settingsPath, {});
        const next = await mutator(settings);
        await atomicWrite(settingsPath, next);
        return clone(next);
      });
    },
  };
}
