import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { AppError } from './errors.mjs';
import { taskFieldsInput, taskUpdate, settingsUpdate, timeZone } from './validation.mjs';

function safely(operation) {
  try { return operation(); }
  catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('STORAGE_ERROR');
  }
}
function rowTask(row) {
  const { deadlineJson, ...task } = row;
  return {...task, deadline: deadlineJson === null ? null : JSON.parse(deadlineJson)};
}
export function openStore(path, options = {}) {
  let db;
  try {
    db = new DatabaseSync(path);
    db.exec('PRAGMA busy_timeout=5000');
    // Migration is serialized across connections and never downgrades a database.
    db.exec('BEGIN IMMEDIATE');
    try {
      const version = db.prepare('PRAGMA user_version').get().user_version;
      if (version > 1) throw new AppError('STORAGE_ERROR');
      if (version === 0) {
        let zone = options.timeZone;
        if (zone === undefined) {
          try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
          catch { zone = 'UTC'; }
        }
        timeZone(zone);
        db.exec(`
          CREATE TABLE tasks (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, notes TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('pending','completed')),
            completedAt TEXT, priority TEXT NOT NULL CHECK(priority IN ('low','normal','high')),
            estimatedMinutes INTEGER, deadlineJson TEXT,
            createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
            revision INTEGER NOT NULL CHECK(revision >= 1)
          ) STRICT;
          CREATE TABLE settings (
            id INTEGER PRIMARY KEY CHECK(id=1),
            locale TEXT NOT NULL CHECK(locale IN ('en-US','zh-CN')),
            timeZone TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision >= 1)
          ) STRICT;
          PRAGMA user_version=1;
        `);
        db.prepare('INSERT INTO settings VALUES (1, ?, ?, 1)').run('en-US',zone);
      }
      db.exec('COMMIT');
    } catch(error) { db.exec('ROLLBACK'); throw error; }
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');
    const find = db.prepare('SELECT * FROM tasks WHERE id=?');
    const all = db.prepare('SELECT * FROM tasks ORDER BY createdAt ASC, id ASC');
    const insert = db.prepare('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    const update = db.prepare(`UPDATE tasks SET title=?,notes=?,status=?,completedAt=?,
      priority=?,estimatedMinutes=?,deadlineJson=?,updatedAt=?,revision=revision+1
      WHERE id=? AND revision=?`);
    const prefs = db.prepare('SELECT locale,timeZone,revision FROM settings WHERE id=1');
    if (!prefs.get()) throw new AppError('STORAGE_ERROR');
    const updatePrefs = db.prepare('UPDATE settings SET locale=?,timeZone=?,revision=revision+1 WHERE id=1 AND revision=?');
    let closed = false;
    const transaction = operation => safely(() => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result=operation();
        db.exec('COMMIT');
        return result;
      } catch(error) { db.exec('ROLLBACK'); throw error; }
    });
    return {
      createTask(input) {
        const fields=taskFieldsInput(input);
        return safely(() => {
          const now=new Date().toISOString();
          const task={id:randomUUID(),notes:'',priority:'normal',estimatedMinutes:null,deadline:null,
            ...fields,status:'pending',completedAt:null,createdAt:now,updatedAt:now,revision:1};
          insert.run(task.id,task.title,task.notes,task.status,task.completedAt,task.priority,
            task.estimatedMinutes,task.deadline===null?null:JSON.stringify(task.deadline),now,now,1);
          return rowTask(find.get(task.id));
        });
      },
      listTasks() { return safely(() => all.all().map(rowTask)); },
      updateTask(input) {
        const {id,expectedRevision,patch}=taskUpdate(input);
        return transaction(() => {
          const row=find.get(id);
          if (!row) throw new AppError('NOT_FOUND');
          const old=rowTask(row);
          if (old.revision!==expectedRevision) throw new AppError('CONFLICT');
          const task={...old,...patch}, now=new Date().toISOString();
          if (task.status!==old.status) task.completedAt=task.status==='completed'?now:null;
          const result=update.run(task.title,task.notes,task.status,task.completedAt,task.priority,
            task.estimatedMinutes,task.deadline===null?null:JSON.stringify(task.deadline),now,id,expectedRevision);
          if (result.changes!==1) throw new AppError('CONFLICT');
          return rowTask(find.get(id));
        });
      },
      getSettings() { return safely(() => ({...prefs.get()})); },
      updateSettings(input) {
        const {expectedRevision,patch}=settingsUpdate(input);
        return transaction(() => {
          const old=prefs.get();
          if(old.revision!==expectedRevision) throw new AppError('CONFLICT');
          const next={...old,...patch};
          if(updatePrefs.run(next.locale,next.timeZone,expectedRevision).changes!==1) throw new AppError('CONFLICT');
          return {...prefs.get()};
        });
      },
      close() { if (!closed) { safely(()=>db.close()); closed=true; } }
    };
  } catch(error) {
    try { db?.close(); } catch {}
    throw new AppError('STORAGE_ERROR');
  }
}
