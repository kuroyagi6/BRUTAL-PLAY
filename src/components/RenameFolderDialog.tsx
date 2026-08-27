import React from 'react';
import { FolderPen, RotateCcw } from 'lucide-react';
import { folderLabel, hasAlias, realFolderName, renameFolder } from '../library/folderAliases';

// Rename a desktop folder icon. Deliberately says so on the tin: this sets a
// nickname inside the app and never touches the folder on disk, which is the
// one thing a user needs to be sure of before typing. The real path is shown
// underneath so there is no doubt which folder is being labelled.
//
// Rendered once in App next to MenuHost; `path` being non-null is what opens it.

interface RenameFolderDialogProps {
  /** The folder being renamed, or null when the dialog is closed. */
  path: string | null;
  onClose: () => void;
}

export const RenameFolderDialog: React.FC<RenameFolderDialogProps> = ({ path, onClose }) => {
  const [name, setName] = React.useState('');

  // Seed the field from the current label each time a new folder is opened.
  React.useEffect(() => {
    if (path) setName(folderLabel(path));
  }, [path]);

  if (!path) return null;

  const real = realFolderName(path);

  const commit = () => {
    renameFolder(path, name);
    onClose();
  };

  // Clearing the nickname puts the real folder name back.
  const reset = () => {
    renameFolder(path, '');
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[10001] flex items-center justify-center bg-brutal-black/70"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-[380px] max-w-[90vw] bg-brutal-black border-4 border-brutal-white shadow-[8px_8px_0px_0px_var(--brutal-shadow-color)] text-brutal-white"
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') onClose();
        }}
      >
        <div className="px-3 py-2 border-b-4 border-brutal-white font-display text-lg tracking-tighter uppercase leading-none flex items-center gap-2">
          <FolderPen size={18} /> RENAME_FOLDER
        </div>

        <div className="p-4 flex flex-col gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            onFocus={(e) => e.target.select()}
            placeholder={real}
            className="w-full px-2 py-2 bg-brutal-black border-2 border-brutal-white/30 focus:border-brutal-neon outline-none font-mono text-xs text-brutal-white uppercase"
          />

          <p className="font-mono text-[9px] leading-relaxed text-brutal-white/50 uppercase break-all">
            DISPLAY_NAME_ONLY // THE FOLDER ON DISK IS NOT RENAMED
            <br />
            <span className="text-brutal-white/70">{path}</span>
          </p>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 py-2 border-2 border-brutal-white/30 hover:border-brutal-neon font-mono text-[10px] uppercase transition-colors"
            >
              CANCEL
            </button>
            <button
              onClick={commit}
              className="flex-1 py-2 bg-brutal-neon text-brutal-black font-mono text-[10px] uppercase font-bold"
            >
              SAVE
            </button>
          </div>

          {/* Only offered once there is a nickname to remove. */}
          {hasAlias(path) && (
            <button
              onClick={reset}
              title={`Show the real folder name again (${real})`}
              className="w-full py-1.5 border-2 border-brutal-white/20 hover:border-brutal-neon font-mono text-[9px] uppercase text-brutal-white/60 hover:text-brutal-white flex items-center justify-center gap-2 transition-colors"
            >
              <RotateCcw size={11} /> RESET_TO_{real}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
