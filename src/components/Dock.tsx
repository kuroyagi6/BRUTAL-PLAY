import React from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface DockItem {
  id: string;
  title: string;
  icon: React.ReactNode;
  isMinimized: boolean;
}

interface DockProps {
  items: DockItem[];
  onRestore: (id: string) => void;
}

export const Dock: React.FC<DockProps> = ({ items, onRestore }) => {
  const minimizedItems = items.filter(item => item.isMinimized);

  return (
    <div className="fixed bottom-0 left-1/2 -translate-x-1/2 z-[9999] mb-4">
      <AnimatePresence>
        {minimizedItems.length > 0 && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="bg-brutal-black border-4 border-brutal-white shadow-[8px_8px_0px_0px_var(--brutal-shadow-color)] p-2 flex gap-2"
          >
            {minimizedItems.map((item) => (
              <motion.button
                key={item.id}
                whileHover={{ y: -5, scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => onRestore(item.id)}
                className="group relative bg-brutal-white text-brutal-black p-3 border-2 border-brutal-black hover:bg-brutal-neon transition-all"
                title={`RESTORE_${item.title}`}
              >
                {item.icon}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-brutal-black text-brutal-white text-[10px] font-mono border border-brutal-white opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap">
                  {item.title}
                </div>
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
