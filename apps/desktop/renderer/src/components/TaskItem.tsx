import { useId } from 'react';
import type { Task } from '../api/contract';
import { useI18n } from '../i18n/context';
import { formatDeadline, formatInstant, formatMinutes, isOverdue } from '../time';

interface Props {
  task: Task;
  busy: boolean;
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
}

export function TaskItem({ task, busy, onToggle, onEdit }: Props) {
  const { t, locale, timeZone } = useI18n();
  const id = useId();
  const done = task.status === 'completed';
  const overdue = !done && isOverdue(task.deadline, new Date(), timeZone);

  return (
    <li className={`task${done ? ' done' : ''}${busy ? ' busy' : ''}`} aria-busy={busy || undefined}>
      <input
        type="checkbox" className="task-check" checked={done} disabled={busy}
        aria-labelledby={`${id}-title`} aria-describedby={`${id}-state`}
        onChange={() => onToggle(task)}
      />
      <div className="task-body">
        <span className="task-title" id={`${id}-title`}>{task.title}</span>
        <span className="visually-hidden" id={`${id}-state`}>
          {done ? t('task.statusCompleted') : t('task.statusPending')}
        </span>
        <div className="task-meta">
          {task.priority !== 'normal' && (
            <span className={`badge priority-${task.priority}`}>{t('priority.label', { level: t(`priority.${task.priority}`) })}</span>
          )}
          {task.deadline && (
            <span className={overdue ? 'due overdue' : 'due'}>
              {t('task.due', { when: formatDeadline(task.deadline, locale, timeZone) })}
            </span>
          )}
          {overdue && <span className="badge overdue">{t('task.overdue')}</span>}
          {task.estimatedMinutes !== null && (
            <span>{t('task.estimate', { duration: formatMinutes(task.estimatedMinutes, locale) })}</span>
          )}
          {done && task.completedAt && (
            <span>{t('task.completedOn', { when: formatInstant(task.completedAt, locale, timeZone) })}</span>
          )}
        </div>
        {task.notes && <p className="task-notes">{task.notes}</p>}
      </div>
      <button type="button" className="ghost" onClick={() => onEdit(task)} disabled={busy}>{t('action.edit')}</button>
    </li>
  );
}
