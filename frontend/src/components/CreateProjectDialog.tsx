import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog } from '../ui/Dialog';
import { Spinner } from '../ui/Spinner';
import { projectsApi } from '../api/endpoints';
import { useToast } from '../ui/Toast';
import { apiError } from '../lib/apiError';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

export function CreateProjectDialog({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { data } = await projectsApi.create(name.trim(), description.trim() || undefined);
      toast.push(`Project ${data.key} created`, 'success');
      setName('');
      setDescription('');
      onCreated?.();
      onClose();
      navigate(`/projects/${data.id}`);
    } catch (err) {
      toast.push(apiError(err, 'Could not create project'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New project"
      description="Group related tasks under a shared key."
    >
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-subtle">
            Name
          </label>
          <input
            autoFocus
            className="input"
            placeholder="e.g. Customer Portal"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={2}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-subtle">
            Description
          </label>
          <textarea
            className="input min-h-[68px] resize-y"
            placeholder="What does this project track?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy && <Spinner className="border-paper border-t-paper/40" />}
            Create project
          </button>
        </div>
      </form>
    </Dialog>
  );
}
