/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { motion } from 'framer-motion';
import { cn } from '@renderer/utils';

export function PremiumBackground({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 overflow-hidden',
        className,
      )}
    >
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:68px_68px] opacity-35 [mask-image:linear-gradient(to_bottom,black,transparent_88%)]" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/45 to-transparent" />
      <div className="absolute inset-x-0 top-0 h-64 bg-[linear-gradient(110deg,rgba(20,184,166,0.12),transparent_34%,rgba(244,114,182,0.08)_58%,transparent)]" />
    </div>
  );
}

export function AnimatedGradientBorder({
  children,
  className,
  innerClassName,
}: {
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
}) {
  return (
    <div
      className={cn(
        'relative rounded-[30px] p-px shadow-[0_24px_90px_rgba(0,0,0,0.42)]',
        'before:absolute before:inset-0 before:rounded-[inherit] before:bg-[conic-gradient(from_180deg_at_50%_50%,rgba(34,211,238,0.12),rgba(16,185,129,0.42),rgba(244,114,182,0.26),rgba(34,211,238,0.12))] before:opacity-80',
        className,
      )}
    >
      <div
        className={cn(
          'relative rounded-[29px] border border-white/10 bg-[#111214]/95 backdrop-blur-xl',
          innerClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export const MotionPanel = motion.div;

export const panelMotion = {
  initial: { opacity: 0, y: 14, scale: 0.985 },
  animate: { opacity: 1, y: 0, scale: 1 },
  transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] },
};
