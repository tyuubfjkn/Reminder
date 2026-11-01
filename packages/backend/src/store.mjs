import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { AppError, invalid } from './errors.mjs';
import { taskFieldsInput, taskUpdate, settingsUpdate, timeZone, object, revision } from './validation.mjs';

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
      if (version > 2) throw new AppError('STORAGE_ERROR');
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
      if (version < 2) db.exec(`CREATE TABLE assistant_runs (
        requestId TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, replyJson TEXT NOT NULL, inverseJson TEXT NOT NULL
      ) STRICT; PRAGMA user_version=2;`);
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
    const create = fields => {
      const now=new Date().toISOString();
      const task={id:randomUUID(),notes:'',priority:'normal',estimatedMinutes:null,deadline:null,
        ...fields,status:'pending',completedAt:null,createdAt:now,updatedAt:now,revision:1};
      insert.run(task.id,task.title,task.notes,task.status,task.completedAt,task.priority,
        task.estimatedMinutes,task.deadline===null?null:JSON.stringify(task.deadline),now,now,1);
      return rowTask(find.get(task.id));
    };
    const write = (task, expectedRevision) => {
      if (update.run(task.title,task.notes,task.status,task.completedAt,task.priority,
        task.estimatedMinutes,task.deadline===null?null:JSON.stringify(task.deadline),new Date().toISOString(),task.id,expectedRevision).changes!==1)
        throw new AppError('CONFLICT');
      return rowTask(find.get(task.id));
    };
    const read = id => { const row=find.get(id); if(!row) throw new AppError('NOT_FOUND'); return rowTask(row); };
    const change = ({id,expectedRevision,patch}) => {
      const old=read(id);
      if(old.revision!==expectedRevision) throw new AppError('CONFLICT');
      const task={...old,...patch};
      if(task.status!==old.status) task.completedAt=task.status==='completed'?new Date().toISOString():null;
      return write(task,expectedRevision);
    };
    const receiptQuery=db.prepare('SELECT * FROM assistant_runs WHERE requestId=?');
    const receiptInsert=db.prepare('INSERT INTO assistant_runs VALUES (?,?,?,?)');
    const receiptUpdate=db.prepare('UPDATE assistant_runs SET replyJson=? WHERE requestId=?');
    const remove=db.prepare('DELETE FROM tasks WHERE id=? AND revision=?');
    const requestId = id => {
      if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) invalid('requestId');
    };
    const receipt = (id, fingerprint) => {
      requestId(id);
      if(typeof fingerprint!=='string'||! /^[0-9a-f]{64}$/.test(fingerprint)) invalid('requestId');
      const row=receiptQuery.get(id);
      if(row && row.fingerprint!==fingerprint) throw new AppError('CONFLICT');
      return row?JSON.parse(row.replyJson):null;
    };
    return {
      createTask(input) { const fields=taskFieldsInput(input); return safely(()=>create(fields)); },
      listTasks() { return safely(() => all.all().map(rowTask)); },
      updateTask(input) { const validated=taskUpdate(input); return transaction(()=>change(validated)); },
      getAssistantRun(id,fingerprint) { return safely(()=>receipt(id,fingerprint)); },
      applyAssistantRun(input) {
        object(input,['requestId','fingerprint','settingsRevision','taskSnapshot','reply','operations']);
        return transaction(()=>{
          const existing=receipt(input.requestId,input.fingerprint);
          if(existing) return existing;
          revision(input.settingsRevision);
          if(prefs.get().revision!==input.settingsRevision) throw new AppError('CONFLICT');
          if(input.taskSnapshot!==undefined) {
            const current=all.all();
            if(!Array.isArray(input.taskSnapshot)||current.length!==input.taskSnapshot.length||
              current.some((row,index)=>row.id!==input.taskSnapshot[index]?.id||row.revision!==input.taskSnapshot[index]?.revision))
              throw new AppError('CONFLICT');
          }
          if(!Array.isArray(input.operations)||input.operations.length>20) invalid('operations');
          const ids=new Set();
          const operations=input.operations.map(op=>{
            if(op?.kind==='create') {object(op,['kind','input']);return {kind:'create',input:taskFieldsInput(op.input)};}
            object(op,['kind','id','expectedRevision','patch']);
            if(op.kind!=='update'||ids.has(op.id)) invalid('operations');
            ids.add(op.id);
            return {kind:'update',...taskUpdate({id:op.id,expectedRevision:op.expectedRevision,patch:op.patch})};
          });
          const inverse=[],changes=[];
          for(const op of operations) {
            const before=op.kind==='update'?read(op.id):null;
            const after=op.kind==='create'?create(op.input):change(op);
            inverse.push({before,after:{id:after.id,revision:after.revision}});
            changes.push({kind:before?'updated':'created',taskId:after.id,title:after.title});
          }
          const reply={...input.reply,requestId:input.requestId,changes,undoAvailable:changes.length>0};
          if(changes.length) {
            reply.outcome='applied';
            reply.message=reply.language==='zh-CN'?`已保存 ${changes.length} 项任务更改。`:`Saved ${changes.length} task change(s).`;
            delete reply.choices;
          }
          receiptInsert.run(input.requestId,input.fingerprint,JSON.stringify(reply),JSON.stringify(inverse));
          return reply;
        });
      },
      undoAssistantRun(id) {
        requestId(id);
        return transaction(()=>{
          const row=receiptQuery.get(id);
          if(!row) throw new AppError('NOT_FOUND');
          const reply=JSON.parse(row.replyJson),inverse=JSON.parse(row.inverseJson);
          if(reply.outcome==='undone') return reply;
          if(!reply.undoAvailable) throw new AppError('CONFLICT');
          // Check the complete batch before restoring anything.
          for(const item of inverse) if(find.get(item.after.id)?.revision!==item.after.revision) throw new AppError('CONFLICT');
          const changes=[];
          for(const {before,after} of inverse) {
            if(before) write(before,after.revision);
            else if(remove.run(after.id,after.revision).changes!==1) throw new AppError('CONFLICT');
            changes.push({kind:before?'restored':'removed',taskId:after.id,title:before?.title??reply.changes.find(c=>c.taskId===after.id).title});
          }
          const undone={...reply,outcome:'undone',undoAvailable:false,changes,
            message:reply.language==='zh-CN'?'已撤销这组任务更改。':'Undid this batch of task changes.'};
          receiptUpdate.run(JSON.stringify(undone),id);
          return undone;
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
