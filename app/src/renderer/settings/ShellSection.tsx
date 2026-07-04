import { Terminal } from 'lucide-react';
import { api } from '../api.js';
import { useState, useEffect } from 'react';
import { Spinner, type ToastData } from '@sproutgit/ui';
import { SettingsToolRow, type ToolPreset } from './SettingsToolRow.js';

interface Props {
  onToast: (msg: string, variant?: ToastData['variant']) => void;
}

export function ShellSection({ onToast }: Props) {
  const [availableShells, setAvailableShells] = useState<{ name: string; path: string }[]>([]);
  const [currentShell, setCurrentShell] = useState('');
  const [customShell, setCustomShell] = useState('');
  const [shellsLoading, setShellsLoading] = useState(true);

  useEffect(() => {
    void Promise.all([
      api.listShells(),
      api.getSetting('default_shell'),
    ]).then(([shells, savedShell]) => {
      setAvailableShells(shells);
      const initial = savedShell ?? shells[0]?.path ?? '';
      setCurrentShell(initial);
      setCustomShell(initial);
    }).finally(() => setShellsLoading(false));
  }, []);

  async function selectShell(shellPath: string) {
    setCurrentShell(shellPath);
    setCustomShell(shellPath);
    try {
      await api.setSetting('default_shell', shellPath);
      const shellName = availableShells.find(s => s.path === shellPath)?.name ?? shellPath;
      onToast(`Default shell set to ${shellName}`, 'success');
    } catch (err) {
      onToast(String(err), 'error');
    }
  }

  const currentShellName = availableShells.find(s => s.path === currentShell)?.name ?? currentShell;

  const presets: ToolPreset[] = availableShells.map(s => ({
    id: s.path,
    name: s.name,
    active: currentShell === s.path,
  }));

  return (
    <section className="rounded-lg border border-(--sg-border) bg-(--sg-surface)">
      <div className="border-b border-(--sg-border) px-5 py-4">
        <h2 className="sg-heading text-sm font-semibold text-(--sg-primary) flex items-center gap-1.5">
          <Terminal size={15} /> Default Shell
        </h2>
        <p className="mt-1 text-xs text-(--sg-text-faint)">Used for new Terminal tab sessions.</p>
      </div>

      {shellsLoading ? (
        <div className="px-5 py-5 flex items-center gap-2 text-xs text-(--sg-text-dim)">
          <Spinner size="sm" /> Detecting shells...
        </div>
      ) : (
        <SettingsToolRow
          testId="shell-row"
          icon={<Terminal size={13} />}
          title="Shell"
          currentValueLabel={currentShell ? `${currentShellName} (${currentShell})` : '(not set)'}
          presets={presets}
          onSelectPreset={selectShell}
          customValue={customShell}
          onCustomValueChange={setCustomShell}
          customPlaceholder="Path to shell binary"
          onSaveCustom={() => selectShell(customShell.trim())}
          onTest={() => api.testShell(currentShell)}
          onToast={onToast}
        />
      )}
    </section>
  );
}
